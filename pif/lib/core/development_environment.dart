import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'development_toolchain.dart';
import 'workspace_paths.dart';

/// Local identity is allocated before toolchain or GitHub setup. It contains
/// no credentials or absolute resource paths and is not a portable login.
class EnvironmentIdentity {
  const EnvironmentIdentity({
    required this.id,
    required this.workspacePath,
    required this.builderVersion,
  });

  final String id;
  final String workspacePath;
  final String builderVersion;
  String get appDir => WorkspacePaths.child(workspacePath, 'pif');
  String get kitDir => WorkspacePaths.child(workspacePath, '.pif/builder');
  String get stateDir => WorkspacePaths.child(workspacePath, '.pi/pif');

  Map<String, Object> toJson() => {
    'schemaVersion': 1,
    'id': id,
    'builderVersion': builderVersion,
    'resources': {'app': 'pif', 'kit': '.pif/builder'},
  };

  static final _uuid = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  );

  static String _newId() {
    final bytes = List.generate(16, (_) => Random.secure().nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  static EnvironmentIdentity? read(String workspacePath) {
    final root = _root(workspacePath);
    final file = File(WorkspacePaths.child(root, '.pi/pif/environment.json'));
    final type = FileSystemEntity.typeSync(file.path, followLinks: false);
    if (type == FileSystemEntityType.notFound) return null;
    if (type != FileSystemEntityType.file) {
      throw FileSystemException(
        'Environment identity must be a regular file',
        file.path,
      );
    }
    try {
      final json = jsonDecode(file.readAsStringSync());
      if (json is! Map ||
          json['schemaVersion'] != 1 ||
          json['id'] is! String ||
          !_uuid.hasMatch(json['id'] as String) ||
          json['builderVersion'] is! String ||
          (json['builderVersion'] as String).isEmpty ||
          json['resources'] is! Map ||
          json['resources']['app'] != 'pif' ||
          json['resources']['kit'] != '.pif/builder') {
        throw const FormatException('Unsupported environment identity');
      }
      return EnvironmentIdentity(
        id: json['id'] as String,
        workspacePath: root,
        builderVersion: json['builderVersion'] as String,
      );
    } catch (_) {
      throw FileSystemException(
        'Environment identity is invalid. It was preserved; restore the original '
        'environment.json or choose a new workspace.',
        file.path,
      );
    }
  }

  static String _root(String path) {
    final normalized = WorkspacePaths.normalize(path);
    if (FileSystemEntity.typeSync(normalized, followLinks: false) ==
        FileSystemEntityType.link) {
      throw FileSystemException(
        'Select the real workspace folder, not a symlink',
        path,
      );
    }
    final root = WorkspacePaths.writable(path, role: 'environment');
    if (!Directory(root).existsSync()) {
      throw FileSystemException('Workspace folder does not exist', root);
    }
    return root;
  }

  static Future<EnvironmentIdentity> ensure(
    String workspacePath, {
    String? builderVersion,
  }) async {
    final root = _root(workspacePath);
    final existing = read(root);
    final statePath = WorkspacePaths.child(root, '.pi/pif');
    final probeParent = Directory(statePath).existsSync() ? statePath : root;
    try {
      final probe = await Directory(
        probeParent,
      ).createTemp('.pif-write-check-');
      await probe.delete();
    } on FileSystemException {
      throw FileSystemException(
        'This environment is not writable. Choose a writable project folder.',
        probeParent,
      );
    }
    await _ensureRuntimeIgnores(root);
    if (existing != null) return existing;
    final state = Directory(WorkspacePaths.child(root, '.pi/pif'));
    await state.create(recursive: true);
    WorkspacePaths.child(root, '.pi/pif');
    final identity = EnvironmentIdentity(
      id: _newId(),
      workspacePath: root,
      builderVersion: builderVersion ?? 'unprovisioned',
    );
    final stage = await state.createTemp('.identity-');
    try {
      final file = File('${stage.path}/environment.json');
      await file.writeAsString(
        '${jsonEncode(identity.toJson())}\n',
        flush: true,
      );
      // Hard-link publication is atomic and cannot overwrite a concurrently
      // allocated UUID, a symlink, or an existing malformed identity.
      final destination = WorkspacePaths.child(
        root,
        '.pi/pif/environment.json',
      );
      final result = await Process.run('/bin/link', [file.path, destination]);
      if (result.exitCode != 0) {
        final winner = read(root);
        if (winner != null) return winner;
        throw FileSystemException(
          'Cannot save the environment identity: ${result.stderr}',
          destination,
        );
      }
      return identity;
    } finally {
      await stage.delete(recursive: true);
    }
  }

  static Future<void> _ensureRuntimeIgnores(String root) async {
    final file = File(WorkspacePaths.child(root, '.gitignore'));
    final type = FileSystemEntity.typeSync(file.path, followLinks: false);
    if (type != FileSystemEntityType.notFound &&
        type != FileSystemEntityType.file) {
      throw FileSystemException(
        'The project .gitignore must be a regular file',
        file.path,
      );
    }
    final original = type == FileSystemEntityType.file
        ? await file.readAsString()
        : '';
    final rules = original.split('\n').map((line) => line.trim()).toSet();
    final additions = <String>[
      if (!rules.any(const {'.pi', '.pi/', '/.pi', '/.pi/'}.contains)) '/.pi/',
      if (!rules.any(
        const {
          '.pif',
          '.pif/',
          '/.pif',
          '/.pif/',
          '.pif/builder',
          '.pif/builder/',
          '/.pif/builder',
          '/.pif/builder/',
        }.contains,
      ))
        '/.pif/builder/',
    ];
    if (additions.isEmpty) return;
    WorkspacePaths.child(root, '.gitignore');
    await file.writeAsString(
      '${original.isNotEmpty && !original.endsWith('\n') ? '\n' : ''}'
      '${additions.join('\n')}\n',
      mode: FileMode.append,
      flush: true,
    );
  }

  Future<EnvironmentIdentity> _withBuilderVersion(String version) async {
    final current = read(workspacePath);
    if (current?.id != id)
      throw StateError('Environment identity changed during setup');
    final updated = EnvironmentIdentity(
      id: id,
      workspacePath: workspacePath,
      builderVersion: version,
    );
    final stage = await Directory(stateDir).createTemp('.identity-update-');
    try {
      final file = File('${stage.path}/environment.json');
      await file.writeAsString(
        '${jsonEncode(updated.toJson())}\n',
        flush: true,
      );
      await file.rename(
        WorkspacePaths.child(workspacePath, '.pi/pif/environment.json'),
      );
      return updated;
    } finally {
      await stage.delete(recursive: true);
    }
  }
}

class EnvironmentReadiness {
  const EnvironmentReadiness({
    required this.identity,
    required this.tools,
    required this.issues,
    this.kitRoot,
  });
  final EnvironmentIdentity identity;
  final DevelopmentToolchain tools;
  final List<String> issues;
  final String? kitRoot;
  bool get canBuild => issues.isEmpty && tools.ready && kitRoot != null;
  String get appDir => identity.appDir;
  String get kitDir => identity.kitDir;
  List<String> get allIssues => [...issues, ...tools.issues];
}

/// Provisioning copies only the versioned distribution kit. It never copies
/// the creator's workspace, sessions, profiles, remotes, caches or credentials.
class DevelopmentEnvironmentService {
  static final Set<String> _provisioning = {};
  DevelopmentEnvironmentService({this.builderRoot});
  final String? builderRoot;

  static String? bundledBuilderRoot() {
    final explicit = Platform.environment['PIF_BUILDER_ROOT'];
    if (explicit != null && explicit.isNotEmpty) return explicit;
    final resources =
        '${File(Platform.resolvedExecutable).parent.parent.path}/Resources';
    final path = '$resources/builder';
    return File('$path/manifest.json').existsSync() ? path : null;
  }

  Future<EnvironmentIdentity> create({
    required String parentPath,
    required String name,
  }) async {
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$').hasMatch(name) ||
        name.endsWith('.') ||
        name.endsWith(' ')) {
      throw ArgumentError(
        'Use a project name of 1–80 letters, numbers, spaces, dots, hyphens or underscores.',
      );
    }
    final parent = EnvironmentIdentity._root(parentPath);
    final path = WorkspacePaths.child(parent, name);
    // mkdir without -p rejects all collisions, including an empty folder.
    final result = await Process.run('/bin/mkdir', [path]);
    if (result.exitCode != 0) {
      throw FileSystemException(
        'Cannot create the project. Choose a new name and a writable location. ${result.stderr}',
        path,
      );
    }
    return EnvironmentIdentity.ensure(path);
  }

  String? _availableKit(EnvironmentIdentity identity) {
    if (Directory(identity.kitDir).existsSync()) return identity.kitDir;
    return builderRoot ?? bundledBuilderRoot();
  }

  Future<Map<String, dynamic>> _kitCommand(
    String kit,
    List<String> arguments, {
    bool Function()? isCancelled,
  }) async {
    if (!Directory(kit).existsSync()) {
      throw StateError(
        'Builder kit is unavailable at $kit. Reinstall pif; '
        'the workspace and its identity are preserved.',
      );
    }
    kit = Directory(kit).resolveSymbolicLinksSync();
    final node = '$kit/runtime/node';
    final script = '$kit/scripts/pif-builder-kit.mjs';
    if (!File(node).existsSync() || !File(script).existsSync()) {
      throw StateError(
        'The builder kit is incomplete. Reinstall pif with its versioned builder resources.',
      );
    }
    if (isCancelled?.call() == true)
      throw StateError('Environment setup cancelled');
    final process = await Process.start(
      node,
      [script, ...arguments],
      environment: DevelopmentToolchain.cleanEnvironment(),
      includeParentEnvironment: false,
    );
    final stdout = process.stdout.transform(utf8.decoder).join();
    final stderr = process.stderr.transform(utf8.decoder).join();
    var cancelled = false;
    final timer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (isCancelled?.call() == true) {
        cancelled = true;
        process.kill(ProcessSignal.sigterm);
      }
    });
    try {
      final code = await process.exitCode.timeout(
        const Duration(minutes: 2),
        onTimeout: () {
          process.kill(ProcessSignal.sigkill);
          throw TimeoutException(
            'Builder kit setup timed out. The workspace is preserved.',
          );
        },
      );
      final output = await stdout;
      final error = await stderr;
      if (cancelled) throw StateError('Environment setup cancelled');
      if (code != 0) throw StateError('Builder kit setup failed: $error');
      return jsonDecode(output) as Map<String, dynamic>;
    } finally {
      timer.cancel();
    }
  }

  Future<void> _publishDirectory(String source, String destination) async {
    if (Directory(
          source,
        ).uri.pathSegments.where((part) => part.isNotEmpty).last !=
        Directory(
          destination,
        ).uri.pathSegments.where((part) => part.isNotEmpty).last) {
      throw StateError('Staging and published resource names must match');
    }
    // Passing the parent keeps mv from nesting a source inside a colliding
    // destination. -n leaves any colliding file or directory untouched.
    final result = await Process.run('/bin/mv', [
      '-n',
      source,
      Directory(destination).parent.path,
    ]);
    if (result.exitCode != 0 || await Directory(source).exists()) {
      throw FileSystemException(
        'A destination appeared during setup; existing files were preserved.',
        destination,
      );
    }
  }

  Future<EnvironmentIdentity> provision(
    EnvironmentIdentity identity, {
    void Function(String)? onProgress,
    bool Function()? isCancelled,
  }) async {
    final kit = _availableKit(identity);
    if (kit == null) {
      throw StateError(
        'No builder kit is available. Reinstall the current pif.app; '
        'your environment identity has been saved and can be reopened.',
      );
    }
    final state = Directory(identity.stateDir);
    final lock = File(
      WorkspacePaths.child(identity.workspacePath, '.pi/pif/provision.lock'),
    );
    if (!_provisioning.add(identity.workspacePath)) {
      throw StateError(
        'Another setup owns this environment. Retry when it finishes.',
      );
    }
    RandomAccessFile? handle;
    try {
      if (FileSystemEntity.typeSync(lock.path, followLinks: false) ==
          FileSystemEntityType.notFound) {
        try {
          await lock.create(exclusive: true);
        } on FileSystemException {
          /* Concurrent lock creation. */
        }
      }
      if (FileSystemEntity.typeSync(lock.path, followLinks: false) !=
          FileSystemEntityType.file) {
        throw StateError('Environment setup lock must be a regular file.');
      }
      handle = await lock.open(mode: FileMode.append);
      await handle.lock(FileLock.exclusive);
    } catch (_) {
      await handle?.close();
      _provisioning.remove(identity.workspacePath);
      throw StateError(
        'Another setup owns this environment, or its lock is unavailable. Check folder permissions and retry.',
      );
    }
    Directory? stage;
    try {
      onProgress?.call('Checking the versioned builder kit…');
      final manifest = await _kitCommand(kit, [
        'validate',
        kit,
      ], isCancelled: isCancelled);
      final version = manifest['builderVersion'] as String;
      final existingApp = Directory(identity.appDir).existsSync();
      final existingKit = Directory(identity.kitDir).existsSync();
      if (existingApp && existingKit) {
        if (identity.builderVersion != 'unprovisioned' &&
            identity.builderVersion != version) {
          throw StateError(
            'This workspace requires builder ${identity.builderVersion}; existing files were preserved.',
          );
        }
        if (!File('${identity.appDir}/pubspec.yaml').existsSync() ||
            !Directory('${identity.appDir}/macos').existsSync()) {
          throw StateError(
            'The editable app source is incomplete. Restore its files; setup will not overwrite your edits.',
          );
        }
        return identity._withBuilderVersion(version);
      }
      if (existingApp ||
          existingKit ||
          FileSystemEntity.typeSync(identity.appDir, followLinks: false) !=
              FileSystemEntityType.notFound ||
          FileSystemEntity.typeSync(identity.kitDir, followLinks: false) !=
              FileSystemEntityType.notFound) {
        throw StateError(
          'A pif source folder or builder kit already occupies this location. Existing files were preserved; choose a fresh project folder.',
        );
      }
      stage = await state.createTemp('.provision-');
      onProgress?.call('Copying the private builder kit…');
      await _kitCommand(kit, [
        'copy-kit',
        kit,
        '${stage.path}/builder',
      ], isCancelled: isCancelled);
      onProgress?.call('Creating the editable Flutter workspace…');
      await _kitCommand(kit, [
        'copy-template',
        kit,
        '${stage.path}/pif',
      ], isCancelled: isCancelled);
      if (isCancelled?.call() == true)
        throw StateError('Environment setup cancelled');
      final kitParent = Directory(
        WorkspacePaths.child(identity.workspacePath, '.pif'),
      );
      await kitParent.create();
      if (FileSystemEntity.typeSync(identity.kitDir, followLinks: false) !=
              FileSystemEntityType.notFound ||
          FileSystemEntity.typeSync(identity.appDir, followLinks: false) !=
              FileSystemEntityType.notFound) {
        throw StateError(
          'Project files appeared during setup. No files were overwritten.',
        );
      }
      // Publication is serialized by the environment lock. These are new,
      // task-owned paths; no existing application or source is replaced.
      // macOS requires write permission on a moved directory to update its
      // parent link. Thaw only the unpublished root, then immediately reseal.
      final movable = await Process.run('/bin/chmod', [
        'u+w',
        '${stage.path}/builder',
      ]);
      if (movable.exitCode != 0)
        throw StateError('Cannot publish the builder kit');
      await _publishDirectory('${stage.path}/builder', identity.kitDir);
      try {
        await _publishDirectory('${stage.path}/pif', identity.appDir);
      } catch (_) {
        await Directory(identity.kitDir).rename('${stage.path}/builder');
        rethrow;
      }
      final sealed = await Process.run('/bin/chmod', ['a-w', identity.kitDir]);
      if (sealed.exitCode != 0)
        throw StateError('Cannot seal the private builder kit');
      final updated = await identity._withBuilderVersion(version);
      onProgress?.call('Workspace created. Checking build prerequisites…');
      return updated;
    } finally {
      try {
        if (stage != null && await stage.exists()) {
          // Kit copies are immutable; only this invocation's unpublished
          // staging tree may be made writable for cleanup.
          final writable = await Process.run('/bin/chmod', [
            '-R',
            'u+w',
            stage.path,
          ]);
          if (writable.exitCode != 0) {
            throw FileSystemException(
              'Could not clean owned staging directory',
              stage.path,
            );
          }
          await stage.delete(recursive: true);
        }
      } finally {
        try {
          await handle.unlock();
        } finally {
          await handle.close();
          _provisioning.remove(identity.workspacePath);
        }
      }
    }
  }

  Future<EnvironmentReadiness> inspect(EnvironmentIdentity identity) async {
    final issues = <String>[];
    String? kitRoot;
    final candidate = _availableKit(identity);
    if (candidate == null) {
      issues.add(
        'The versioned builder kit is missing. Reinstall the current pif.app.',
      );
    } else {
      try {
        await _kitCommand(candidate, [
          'validate',
          candidate,
          if (identity.builderVersion != 'unprovisioned')
            identity.builderVersion,
        ]);
        kitRoot = candidate;
      } catch (error) {
        issues.add(error.toString());
      }
    }
    if (!File('${identity.appDir}/pubspec.yaml').existsSync() ||
        !Directory('${identity.appDir}/macos').existsSync()) {
      issues.add(
        'Create the editable workspace from the builder kit before previewing or building.',
      );
    }
    return EnvironmentReadiness(
      identity: identity,
      kitRoot: kitRoot,
      tools: await DevelopmentToolchain.discover(identity.workspacePath),
      issues: issues,
    );
  }
}
