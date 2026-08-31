import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/github_connection.dart';

const _environmentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const _environmentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const _channel = MethodChannel('pif/test/github_connection');

Map<String, Object?> _result({
  bool saved = false,
  bool validated = false,
  String? account,
  String code = 'missing_token',
  bool needsAuthorization = false,
}) => {
  'saved': saved,
  'validated': validated,
  'account': account,
  'code': code,
  'message': validated ? 'Token validated.' : 'Connection needs attention.',
  'needsAuthorization': needsAuthorization,
  'canCreateRepository': validated,
};

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  late GithubConnectionService service;
  late List<MethodCall> calls;

  void native(Future<Object?> Function(MethodCall) handler) {
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (call) {
      calls.add(call);
      return handler(call);
    });
  }

  Future<void> selectA() => service.selectEnvironment(
    environmentId: _environmentA,
    workspace: '/isolated/environment-a',
  );

  setUp(() {
    calls = [];
    service = GithubConnectionService(channel: _channel);
  });

  tearDown(() {
    service.dispose();
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null);
  });

  test(
    'credential actions require an environment and never ask native to read a token',
    () async {
      native((_) async => _result());
      await service.saveAndValidate('synthetic-token');
      await service.validate();
      await service.remove();
      expect(calls, isEmpty);
      expect(service.state.code, 'environment_required');
      expect(service.state.saved, isFalse);
    },
  );

  test(
    'save, explicit validate and remove expose metadata only for the selected environment',
    () async {
      native(
        (call) async => switch (call.method) {
          'selectEnvironment' => _result(saved: true, code: 'saved'),
          'saveAndValidate' || 'validate' => _result(
            saved: true,
            validated: true,
            account: 'fixture-account',
            code: 'validated',
          ),
          'remove' => _result(),
          _ => throw StateError('Unexpected native method: ${call.method}'),
        },
      );

      await service.selectEnvironment(
        environmentId: _environmentA.toUpperCase(),
        workspace: '/isolated/environment-a',
      );
      expect(service.environmentId, _environmentA);
      expect(service.state.saved, isTrue);
      expect(service.state.validated, isFalse);
      expect(service.state.canCreateRepository, isFalse);

      await service.saveAndValidate('fixture-only-token');
      expect(service.state.validated, isTrue);
      expect(service.state.account, 'fixture-account');
      expect(service.state.canCreateRepository, isTrue);
      await service.validate();
      await service.remove();
      expect(service.state.saved, isFalse);
      expect(service.state.validated, isFalse);
      expect(service.state.account, isNull);
      expect(service.busy, isFalse);
      expect(calls.map((call) => call.method), [
        'selectEnvironment',
        'saveAndValidate',
        'validate',
        'remove',
      ]);
      for (final call in calls) {
        expect(call.arguments['environmentId'], _environmentA);
        expect(call.arguments['workspace'], '/isolated/environment-a');
        expect(
          (call.arguments as Map).containsKey('token'),
          call.method == 'saveAndValidate',
        );
      }
      expect(calls[1].arguments['token'], 'fixture-only-token');
    },
  );

  test(
    'a rejected removal preserves reported saved state and can be retried',
    () async {
      var removalCount = 0;
      native((call) async {
        if (call.method != 'remove') return _result(saved: true, code: 'saved');
        removalCount++;
        return removalCount == 1
            ? _result(
                saved: true,
                code: 'keychain_denied',
                needsAuthorization: true,
              )
            : _result();
      });
      await selectA();
      await service.remove();
      expect(service.state.saved, isTrue);
      expect(service.state.code, 'keychain_denied');
      expect(service.state.needsAuthorization, isTrue);
      expect(service.busy, isFalse);
      await service.remove();
      expect(service.state.saved, isFalse);
      expect(service.state.needsAuthorization, isFalse);
    },
  );

  test(
    'a late environment status cannot overwrite the newer environment',
    () async {
      final pendingA = Completer<Object?>();
      final enteredA = Completer<void>();
      final pendingB = Completer<Object?>();
      final enteredB = Completer<void>();
      native((call) {
        if (call.arguments['environmentId'] == _environmentA) {
          enteredA.complete();
          return pendingA.future;
        }
        enteredB.complete();
        return pendingB.future;
      });
      final selectingA = selectA();
      await enteredA.future;
      final selectingB = service.selectEnvironment(
        environmentId: _environmentB,
        workspace: '/isolated/environment-b',
      );
      await enteredB.future;
      expect(service.environmentId, _environmentB);
      expect(service.state.saved, isFalse);
      expect(service.state.account, isNull);
      expect(service.busy, isTrue);

      pendingB.complete(_result());
      await selectingB;
      pendingA.complete(
        _result(saved: true, validated: true, account: 'old-account'),
      );
      await selectingA;
      expect(service.environmentId, _environmentB);
      expect(service.workspace, '/isolated/environment-b');
      expect(service.state.saved, isFalse);
      expect(service.state.validated, isFalse);
      expect(service.state.account, isNull);
      expect(service.busy, isFalse);
    },
  );

  test(
    'late save and run results are discarded after switching environments',
    () async {
      final saving = Completer<Object?>();
      final running = Completer<Object?>();
      final enteredSave = Completer<void>();
      final enteredRun = Completer<void>();
      native((call) {
        if (call.method == 'saveAndValidate') {
          enteredSave.complete();
          return saving.future;
        }
        if (call.method == 'run') {
          enteredRun.complete();
          return running.future;
        }
        return Future.value(_result());
      });
      await selectA();
      final save = service.saveAndValidate('old-environment-token');
      final run = service.run(['api', 'user']);
      await Future.wait([enteredSave.future, enteredRun.future]);
      await service.selectEnvironment(
        environmentId: _environmentB,
        workspace: '/isolated/environment-b',
      );
      saving.complete(
        _result(saved: true, validated: true, account: 'old-account'),
      );
      running.complete({'code': 'invalid_token', 'message': 'Old failure'});
      await save;
      expect((await run)['code'], 'environment_changed');
      expect(service.state.saved, isFalse);
      expect(service.state.account, isNull);
      expect(service.state.message, isNot('Old failure'));
    },
  );

  test(
    'busy credential updates do not issue overlapping native mutations',
    () async {
      final pending = Completer<Object?>();
      native(
        (call) => call.method == 'saveAndValidate'
            ? pending.future
            : Future.value(_result()),
      );
      await selectA();
      final save = service.saveAndValidate('fixture-token');
      expect(service.busy, isTrue);
      await service.validate();
      await service.remove();
      await service.saveAndValidate('another-fixture-token');
      expect(calls.map((call) => call.method), [
        'selectEnvironment',
        'saveAndValidate',
      ]);
      pending.complete(_result(saved: true, validated: true));
      await save;
      expect(service.busy, isFalse);
    },
  );

  test(
    'locked Keychain status remains unknown until explicit authorization',
    () async {
      native(
        (call) async => call.method == 'selectEnvironment'
            ? _result(code: 'keychain_locked', needsAuthorization: true)
            : _result(
                saved: true,
                validated: true,
                account: 'unlocked-account',
              ),
      );
      await selectA();
      expect(service.state.saved, isFalse);
      expect(service.state.needsAuthorization, isTrue);
      expect(service.state.validated, isFalse);
      await service.validate();
      expect(service.state.saved, isTrue);
      expect(service.state.validated, isTrue);
      expect(service.state.needsAuthorization, isFalse);
    },
  );

  for (final missingPlugin in [false, true]) {
    test(
      'native ${missingPlugin ? 'absence' : 'exception'} clears busy and redacts raw details',
      () async {
        native((_) async {
          if (missingPlugin)
            throw MissingPluginException('PRIVATE_NATIVE_DETAIL');
          throw PlatformException(
            code: 'denied',
            message: 'PRIVATE_NATIVE_DETAIL',
          );
        });
        await selectA();
        expect(service.busy, isFalse);
        expect(service.state.saved, isFalse);
        expect(service.state.validated, isFalse);
        expect(service.state.message, isNot(contains('PRIVATE_NATIVE_DETAIL')));
        expect(
          service.state.code,
          missingPlugin ? 'native_unavailable' : 'unavailable',
        );

        native((_) async => _result(saved: true, validated: true));
        await service.saveAndValidate('fixture-retry-token');
        expect(service.state.validated, isTrue);
        expect(service.busy, isFalse);
      },
    );
  }
}
