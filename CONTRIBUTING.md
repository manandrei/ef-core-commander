# Contributing to EF Core Commander

## Development flow

1. Create a feature branch from the default branch.
2. Keep changes focused on one behavior or maintenance goal.
3. Run `npm test` from the repository root.
4. Run the SQLite fixture checks when changing EF command generation, project scanning or execution behavior.
5. Update the relevant documentation for user-visible or contributor-facing changes.
6. Open a pull request using the repository template.

## Pull requests

Pull requests should explain the problem, the behavior changed and the verification performed. Include screenshots or command output when the change affects the webview or packaging flow.

Do not commit `node_modules`, `out`, `bin`, `obj`, SQLite database files or generated VSIX artifacts.
