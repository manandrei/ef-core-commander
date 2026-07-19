# Release guide

1. Update the extension version in `src/ef-core-commander/package.json` and `package-lock.json`.
2. Run `npm test` from the repository root.
3. Run the SQLite fixture build and vulnerability check.
4. Generate and inspect the VSIX with `npm run package:vsix`.
5. Create a Git tag matching the extension version, for example `v1.0.0`.
6. Push the tag. GitHub Actions will package the VSIX as an artifact.
7. Publish to the VS Code Marketplace only after the publisher identity, repository URL and release notes have been reviewed.

Do not commit generated VSIX files to the repository.
