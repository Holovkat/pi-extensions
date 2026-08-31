import 'dart:io';

/// Shared destination checks for the launcher and development provisioning.
class WorkspacePaths {
  static String normalize(String path) =>
      Uri.file(Directory(path).absolute.path).normalizePath().toFilePath();

  static bool isInsideAppContents(String path) => RegExp(
    r'(^|/)[^/]+\.app/Contents(/|$)',
  ).hasMatch(normalize(path).replaceAll('\\', '/'));

  static String? canonical(String path) {
    var absolute = Directory(path).absolute.path;
    final seen = <String>{};
    while (seen.add(absolute)) {
      var ancestor = absolute;
      while (FileSystemEntity.typeSync(ancestor, followLinks: false) ==
          FileSystemEntityType.notFound) {
        final parent = Directory(ancestor).parent.path;
        if (parent == ancestor) return null;
        ancestor = parent;
      }
      try {
        final resolved = Directory(ancestor).resolveSymbolicLinksSync();
        final suffix = absolute
            .substring(ancestor.length)
            .replaceFirst(RegExp(r'^/+'), '');
        final next = suffix.isEmpty
            ? resolved
            : Uri.directory(resolved).resolveUri(Uri.file(suffix)).toFilePath();
        if (next == absolute) return next;
        absolute = next;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  static String writable(String path, {required String role}) {
    final resolved = canonical(path);
    if (isInsideAppContents(path) ||
        (resolved != null && isInsideAppContents(resolved))) {
      throw ArgumentError.value(
        path,
        role,
        'Choose a writable location outside the signed .app/Contents bundle.',
      );
    }
    if (resolved == null) {
      throw ArgumentError.value(
        path,
        role,
        'An existing ancestor could not be resolved safely.',
      );
    }
    return resolved;
  }

  /// Relative owned paths may never redirect outside a verified workspace.
  static String child(String root, String relative) {
    final parts = relative.split('/');
    if (parts.any((part) => part.isEmpty || part == '.' || part == '..') ||
        relative.contains('\\')) {
      throw ArgumentError.value(relative, 'relative', 'Unsafe workspace path');
    }
    var current = root;
    for (final part in parts) {
      current = '$current/$part';
      if (FileSystemEntity.typeSync(current, followLinks: false) ==
          FileSystemEntityType.link) {
        throw FileSystemException(
          'Workspace paths cannot contain symlinks',
          current,
        );
      }
    }
    final resolved = writable(current, role: 'workspace resource');
    if (!resolved.startsWith('$root/')) {
      throw FileSystemException(
        'Workspace resource escapes its location',
        current,
      );
    }
    return resolved;
  }
}
