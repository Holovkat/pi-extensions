import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pif/core/development_environment.dart';
import 'package:pif/core/development_toolchain.dart';

void main() {
  late Directory temporary;
  late String root;
  late DevelopmentEnvironmentService environments;

  setUp(() {
    temporary = Directory.systemTemp.createTempSync('pif-environment-test-');
    root = temporary.resolveSymbolicLinksSync();
    environments = DevelopmentEnvironmentService(
      builderRoot: '$root/missing-kit',
    );
  });
  tearDown(() => temporary.deleteSync(recursive: true));

  File identityFile(String path) => File('$path/.pi/pif/environment.json');

  test(
    'local identity persists independently of tools and stores only relative resources',
    () async {
      final identity = await EnvironmentIdentity.ensure(root);
      expect(
        identity.id,
        matches(
          RegExp(
            r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
          ),
        ),
      );
      expect(identity.builderVersion, 'unprovisioned');
      expect(identity.workspacePath, root);
      final raw = identityFile(root).readAsStringSync();
      final saved = jsonDecode(raw) as Map;
      expect(saved['resources'], {'app': 'pif', 'kit': '.pif/builder'});
      expect(raw, isNot(contains(root)));
      expect(saved.keys.toSet(), {
        'schemaVersion',
        'id',
        'builderVersion',
        'resources',
      });
      final reopened = await EnvironmentIdentity.ensure(
        root,
        builderVersion: 'different-version',
      );
      expect(reopened.id, identity.id);
      expect(reopened.builderVersion, 'unprovisioned');
      expect(identityFile(root).readAsStringSync(), raw);
    },
  );

  test(
    'repeated identity allocation preserves gitignore content and avoids duplicate runtime rules',
    () async {
      final ignore = File('$root/.gitignore')
        ..writeAsStringSync('# user rules\nassets/private');
      await EnvironmentIdentity.ensure(root);
      final once = ignore.readAsStringSync();
      await EnvironmentIdentity.ensure(root);
      expect(ignore.readAsStringSync(), once);
      expect(once, startsWith('# user rules\nassets/private\n'));
      expect(once.split('\n').where((line) => line == '/.pi/'), hasLength(1));
      expect(
        once.split('\n').where((line) => line == '/.pif/builder/'),
        hasLength(1),
      );
    },
  );

  test(
    'simultaneous identity allocation elects one UUID without leaving staging directories',
    () async {
      final identities = await Future.wait(
        List.generate(4, (_) => EnvironmentIdentity.ensure(root)),
      );
      expect(identities.map((identity) => identity.id).toSet(), hasLength(1));
      expect(EnvironmentIdentity.read(root)!.id, identities.first.id);
      expect(
        Directory(
          '$root/.pi/pif',
        ).listSync().map((entry) => entry.uri.pathSegments.last).toList(),
        ['environment.json'],
      );
    },
  );

  test(
    'child environments receive independent identities without parent state or credentials',
    () async {
      final parent = await EnvironmentIdentity.ensure(root);
      File(
        '${parent.stateDir}/sessions.json',
      ).writeAsStringSync('synthetic parent session');
      File(
        '${parent.stateDir}/profile.json',
      ).writeAsStringSync('synthetic parent profile');
      File('$root/parent-source.txt').writeAsStringSync('parent source');
      final first = await environments.create(
        parentPath: root,
        name: 'First child',
      );
      final second = await environments.create(
        parentPath: first.workspacePath,
        name: 'Grandchild',
      );
      expect({parent.id, first.id, second.id}, hasLength(3));
      expect(EnvironmentIdentity.read(first.workspacePath)!.id, first.id);
      expect(EnvironmentIdentity.read(second.workspacePath)!.id, second.id);
      for (final child in [first, second]) {
        expect(File('${child.stateDir}/sessions.json').existsSync(), isFalse);
        expect(File('${child.stateDir}/profile.json').existsSync(), isFalse);
        expect(
          File('${child.workspacePath}/parent-source.txt').existsSync(),
          isFalse,
        );
        expect(Directory(child.kitDir).existsSync(), isFalse);
        expect(Directory(child.appDir).existsSync(), isFalse);
      }
      expect(
        File('${parent.stateDir}/sessions.json').readAsStringSync(),
        'synthetic parent session',
      );
    },
  );

  test(
    'new environment rejects existing folders, files and invalid names without changing them',
    () async {
      final folder = Directory('$root/existing')..createSync();
      final marker = File('${folder.path}/keep.txt')
        ..writeAsStringSync('unchanged');
      final file = File('$root/occupied')..writeAsStringSync('unchanged file');
      for (final name in ['existing', 'occupied']) {
        await expectLater(
          environments.create(parentPath: root, name: name),
          throwsA(isA<FileSystemException>()),
        );
      }
      for (final name in [
        '',
        '..',
        '../escape',
        'nested/child',
        '.hidden',
        'trailing.',
        'trailing ',
        'a' * 81,
      ]) {
        await expectLater(
          environments.create(parentPath: root, name: name),
          throwsArgumentError,
        );
      }
      expect(marker.readAsStringSync(), 'unchanged');
      expect(file.readAsStringSync(), 'unchanged file');
      expect(Directory('$root/escape').existsSync(), isFalse);
      expect(identityFile(folder.path).existsSync(), isFalse);
    },
  );

  test('malformed identity is never replaced by a new UUID', () async {
    final file = identityFile(root);
    file.parent.createSync(recursive: true);
    for (final contents in [
      'not json',
      jsonEncode({'schemaVersion': 99}),
      jsonEncode({
        'schemaVersion': 1,
        'id': 'not-a-uuid',
        'builderVersion': 'v1',
        'resources': {'app': 'pif', 'kit': '.pif/builder'},
      }),
      jsonEncode({
        'schemaVersion': 1,
        'id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'builderVersion': 'v1',
        'resources': {'app': '../another-app', 'kit': '.pif/builder'},
      }),
    ]) {
      file.writeAsStringSync(contents);
      await expectLater(
        EnvironmentIdentity.ensure(root),
        throwsA(isA<FileSystemException>()),
      );
      expect(file.readAsStringSync(), contents);
    }
    expect(File('$root/.gitignore').existsSync(), isFalse);
  });

  test(
    'workspace and runtime symlinks cannot redirect identity or ignore writes',
    () async {
      final actual = Directory('$root/actual')..createSync();
      final alias = Link('$root/alias')..createSync(actual.path);
      await expectLater(
        EnvironmentIdentity.ensure(alias.path),
        throwsA(isA<FileSystemException>()),
      );
      expect(identityFile(actual.path).existsSync(), isFalse);

      for (final relative in [
        '.pi',
        '.gitignore',
        '.pi/pif/environment.json',
      ]) {
        final workspace = Directory(
          '$root/case-${relative.replaceAll('/', '-').replaceAll('.', '')}',
        )..createSync();
        final destination =
            '$root/target-${workspace.uri.pathSegments.where((part) => part.isNotEmpty).last}';
        final linkPath = '${workspace.path}/$relative';
        Directory(linkPath).parent.createSync(recursive: true);
        if (relative == '.pi') {
          Directory(destination).createSync();
        } else {
          File(destination).writeAsStringSync('preserve target');
        }
        Link(linkPath).createSync(destination);
        await expectLater(
          EnvironmentIdentity.ensure(workspace.path),
          throwsA(isA<FileSystemException>()),
        );
        if (relative == '.pi') {
          expect(Directory(destination).listSync(), isEmpty);
        } else {
          expect(File(destination).readAsStringSync(), 'preserve target');
        }
      }
    },
  );

  test(
    'signed bundle destinations are rejected even through an ancestor alias',
    () async {
      final contents = Directory('$root/Fixture.app/Contents')
        ..createSync(recursive: true);
      final alias = Link('$root/bundle-alias')..createSync(contents.path);
      for (final parent in [contents.path, alias.path]) {
        await expectLater(
          environments.create(parentPath: parent, name: 'Child'),
          throwsA(anyOf(isA<ArgumentError>(), isA<FileSystemException>())),
        );
      }
      expect(Directory('${contents.path}/Child').existsSync(), isFalse);
    },
  );

  test(
    'read-only environment fails without changing its existing identity',
    () async {
      final identity = await EnvironmentIdentity.ensure(root);
      final contents = identityFile(root).readAsStringSync();
      final changed = Process.runSync('/bin/chmod', ['a-w', identity.stateDir]);
      expect(changed.exitCode, 0);
      try {
        await expectLater(
          EnvironmentIdentity.ensure(root),
          throwsA(
            isA<FileSystemException>().having(
              (error) => error.message,
              'message',
              contains('not writable'),
            ),
          ),
        );
        expect(identityFile(root).readAsStringSync(), contents);
      } finally {
        expect(
          Process.runSync('/bin/chmod', ['u+w', identity.stateDir]).exitCode,
          0,
        );
      }
    },
  );

  test(
    'missing builder and unprepared SDK leave a usable saved local identity',
    () async {
      final identity = await EnvironmentIdentity.ensure(root);
      final original = identityFile(root).readAsStringSync();
      await expectLater(environments.provision(identity), throwsStateError);
      final incompleteSdk = Directory('$root/incomplete-sdk/bin')
        ..createSync(recursive: true);
      File('${incompleteSdk.path}/flutter').writeAsStringSync('not executed');
      await expectLater(
        DevelopmentToolchain.selectFlutterSdk(root, incompleteSdk.parent.path),
        throwsArgumentError,
      );
      expect(identityFile(root).readAsStringSync(), original);
      expect(
        File('${identity.stateDir}/toolchains.json').existsSync(),
        isFalse,
      );
      // The inode stays; failure must release its OS lock so retry reaches
      // the missing-kit check rather than becoming permanently blocked.
      await expectLater(
        environments.provision(identity),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            contains('Builder kit is unavailable'),
          ),
        ),
      );
      expect(Directory(identity.appDir).existsSync(), isFalse);
    },
  );
}
