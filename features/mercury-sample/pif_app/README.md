# Team Pulse fixture setup

This sample resolves the local `pif` package from the repository checkout
with the repo-relative path in `pubspec.yaml`, so a clean clone does not
need a copied `pif/` directory inside the fixture tree.

Keep the sample portable:

- do not hard-code an absolute workspace path in the fixture
- do not copy the app package into the sample tree
- do not commit a workspace-specific `pubspec.lock` here

If you need to validate the fixture locally, run the normal Flutter pub
workflow from this directory against the repository checkout:

```bash
flutter pub get
dart analyze
```

If Flutter creates an untracked `pubspec.lock` during local validation,
keep it out of the commit; do not remove tracked files from the fixture.
