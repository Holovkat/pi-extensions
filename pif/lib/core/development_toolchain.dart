import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'workspace_paths.dart';

/// Read-only discovery for Finder launches, which do not inherit shell setup.
/// No command in this class installs tools, upgrades an SDK or accepts licenses.
class DevelopmentToolchain {
  const DevelopmentToolchain({
    this.flutter,
    this.dart,
    this.git,
    this.pod,
    required this.issues,
    this.versions = const {},
  });
  final String? flutter;
  final String? dart;
  final String? git;
  final String? pod;
  final List<String> issues;
  final Map<String, String> versions;
  bool get ready => issues.isEmpty;

  Map<String, String> get environment {
    final paths = <String>{
      for (final tool in [flutter, dart, git, pod])
        if (tool != null) File(tool).parent.path,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      ...?Platform.environment['PATH']?.split(':'),
    };
    return {
      ...cleanEnvironment(),
      'PATH': paths.where((path) => path.startsWith('/')).join(':'),
      'PIF_FLUTTER_BIN': ?flutter,
      'PIF_DART_BIN': ?dart,
      'PIF_GIT_BIN': ?git,
      'PIF_POD_BIN': ?pod,
      'FLUTTER_SUPPRESS_ANALYTICS': 'true',
      'DART_SUPPRESS_ANALYTICS': 'true',
    };
  }

  static Map<String, String> cleanEnvironment() => {
    for (final entry in Platform.environment.entries)
      if (!entry.key.startsWith('PIF_') &&
          !const {
            'GH_TOKEN',
            'GITHUB_TOKEN',
            'GH_ENTERPRISE_TOKEN',
            'GITHUB_ENTERPRISE_TOKEN',
            'GH_CONFIG_DIR',
          }.contains(entry.key))
        entry.key: entry.value,
  };

  static Future<void> selectFlutterSdk(String workspace, String sdkPath) async {
    final sdk = Directory(sdkPath).resolveSymbolicLinksSync();
    if (!File('$sdk/bin/flutter').existsSync() ||
        !File('$sdk/bin/cache/dart-sdk/bin/dart').existsSync()) {
      throw ArgumentError(
        'Select a prepared Flutter SDK containing bin/flutter '
        'and bin/cache/dart-sdk/bin/dart. Complete Flutter setup explicitly first.',
      );
    }
    final root = WorkspacePaths.writable(workspace, role: 'workspace');
    final file = File(WorkspacePaths.child(root, '.pi/pif/toolchains.json'));
    await file.parent.create(recursive: true);
    await file.writeAsString(
      '${jsonEncode({'flutterSdk': sdk})}\n',
      flush: true,
    );
  }

  static List<String> _candidates(String tool) => [
    '/opt/homebrew/bin/$tool',
    '/usr/local/bin/$tool',
    '/usr/bin/$tool',
    for (final path in Platform.environment['PATH']?.split(':') ?? <String>[])
      if (path.startsWith('/')) '$path/$tool',
  ];

  static String? _find(Iterable<String> paths) {
    for (final path in paths.toSet()) {
      try {
        if (File(path).existsSync())
          return File(path).resolveSymbolicLinksSync();
      } catch (_) {
        /* Continue to the next explicit candidate. */
      }
    }
    return null;
  }

  static Future<String> _query(String executable, List<String> args) async {
    final process = await Process.start(
      executable,
      args,
      environment: {
        ...cleanEnvironment(),
        'CI': 'true',
        'FLUTTER_SUPPRESS_ANALYTICS': 'true',
        'DART_SUPPRESS_ANALYTICS': 'true',
        'PATH':
            '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      },
      includeParentEnvironment: false,
    );
    final output = process.stdout.transform(utf8.decoder).join();
    final errors = process.stderr.transform(utf8.decoder).join();
    final code = await process.exitCode.timeout(
      const Duration(seconds: 15),
      onTimeout: () {
        process.kill(ProcessSignal.sigkill);
        throw TimeoutException(
          '$executable did not answer. Finish its setup explicitly and retry.',
        );
      },
    );
    final text = '${await output}\n${await errors}'.trim();
    if (code != 0)
      throw StateError(text.isEmpty ? '$executable exited $code' : text);
    return text;
  }

  static bool _atLeast(String value, List<int> minimum, {int? belowMajor}) {
    final match = RegExp(r'(\d+)\.(\d+)(?:\.(\d+))?').firstMatch(value);
    if (match == null) return false;
    final parts = [
      int.parse(match[1]!),
      int.parse(match[2]!),
      int.parse(match[3] ?? '0'),
    ];
    if (belowMajor != null && parts[0] >= belowMajor) return false;
    for (var i = 0; i < minimum.length; i++) {
      if (parts[i] != minimum[i]) return parts[i] > minimum[i];
    }
    return true;
  }

  static Future<DevelopmentToolchain> discover(String workspace) async {
    final issues = <String>[];
    final versions = <String, String>{};
    final home = Platform.environment['HOME'];
    String? selectedSdk;
    try {
      final file = File(
        WorkspacePaths.child(
          WorkspacePaths.writable(workspace, role: 'workspace'),
          '.pi/pif/toolchains.json',
        ),
      );
      if (file.existsSync()) {
        final config = jsonDecode(file.readAsStringSync());
        selectedSdk = config['flutterSdk'] as String;
      }
    } catch (_) {
      issues.add(
        'The saved Flutter SDK location is invalid. Select the SDK folder again.',
      );
    }
    final configuredSdk =
        selectedSdk ?? Platform.environment['PIF_FLUTTER_SDK'];
    final sdkCandidates = configuredSdk != null
        ? ['$configuredSdk/bin/flutter']
        : [
            if (home != null) ...[
              '$home/development/flutter/bin/flutter',
              '$home/flutter/bin/flutter',
              '$home/fvm/default/bin/flutter',
              '$home/sdks/flutter/bin/flutter',
            ],
            ..._candidates('flutter'),
          ];
    String? flutter;
    String? dart;
    final checked = <String>{};
    final sdkErrors = <String>[];
    for (final candidate in sdkCandidates) {
      final binary = _find([candidate]);
      if (binary == null || !checked.add(binary)) continue;
      final dartBinary = _find([
        '${File(binary).parent.path}/cache/dart-sdk/bin/dart',
      ]);
      if (dartBinary == null) {
        sdkErrors.add('$binary has no prepared Dart SDK cache.');
        continue;
      }
      try {
        final version = await _query(binary, ['--version', '--machine']);
        final data =
            jsonDecode(
                  version.substring(
                    version.indexOf('{'),
                    version.lastIndexOf('}') + 1,
                  ),
                )
                as Map;
        final flutterVersion = data['frameworkVersion'] as String;
        final dartVersion = await _query(dartBinary, ['--version']);
        if (!_atLeast(flutterVersion, [3, 44, 0], belowMajor: 4) ||
            !_atLeast(dartVersion, [3, 12, 2], belowMajor: 4)) {
          sdkErrors.add(
            '$binary reports incompatible Flutter $flutterVersion / $dartVersion.',
          );
          continue;
        }
        flutter = binary;
        dart = dartBinary;
        versions['flutter'] = flutterVersion;
        versions['dart'] = dartVersion;
        break;
      } catch (error) {
        sdkErrors.add('$binary: $error');
      }
    }
    final git = _find(_candidates('git'));
    final pod = _find(_candidates('pod'));
    if (!Platform.isMacOS)
      issues.add('Editable pif preview and macOS app builds require macOS.');
    if (flutter == null || dart == null) {
      issues.add(
        'Flutter is unavailable, incompatible or not prepared. Install Flutter '
        '3.44 or newer below 4 (Dart 3.12.2 or newer below 4), complete its setup, '
        'then select its SDK folder. pif will not install or upgrade it.'
        '${sdkErrors.isEmpty ? '' : '\n${sdkErrors.join('\n')}'}',
      );
    }
    if (git == null) {
      issues.add(
        'Git 2 or newer is missing. Install Git explicitly before repository setup.',
      );
    } else {
      try {
        versions['git'] = await _query(git, ['--version']);
        if (!_atLeast(versions['git']!, [2, 0, 0]))
          issues.add('Git 2 or newer is required.');
      } catch (error) {
        issues.add('Git is unavailable: $error');
      }
    }
    if (pod == null) {
      issues.add(
        'CocoaPods 1.15 or newer is missing. Install it explicitly for the native Flutter plugins.',
      );
    } else {
      try {
        versions['pod'] = await _query(pod, ['--version']);
        if (!_atLeast(versions['pod']!, [1, 15, 0]))
          issues.add('CocoaPods 1.15 or newer is required.');
      } catch (error) {
        issues.add('CocoaPods is unavailable: $error');
      }
    }
    if (Platform.isMacOS) {
      try {
        final selected = await _query('/usr/bin/xcode-select', ['-p']);
        if (!selected.contains('.app/Contents/Developer')) {
          throw StateError(
            'Full Xcode must be selected, not only Command Line Tools.',
          );
        }
        versions['xcode'] = await _query('/usr/bin/xcodebuild', ['-version']);
        await _query('/usr/bin/xcrun', ['--find', 'clang']);
      } catch (error) {
        issues.add(
          'Xcode is not ready: $error Open Xcode and complete its setup '
          'and license prompts yourself, then retry.',
        );
      }
    }
    return DevelopmentToolchain(
      flutter: flutter,
      dart: dart,
      git: git,
      pod: pod,
      issues: issues,
      versions: versions,
    );
  }
}
