# EF Core Commander

EF Core Commander is a Visual Studio Code extension for discovering Entity Framework Core projects and running common `dotnet ef` migration and database commands from an Activity Bar panel.

Created and maintained by [ManAndrei.ro](https://manandrei.ro).

## Features

- Discover `.csproj` files, EF Core references, `DbContext` classes, migrations and connection strings.
- Select migration and startup projects, `DbContext`, target framework, build configuration and connection source.
- Add and remove migrations.
- Generate idempotent migration SQL scripts with optional transaction control.
- Update or drop a database.
- Display the latest applied migration and pending migrations when available.
- Stream command output and errors in the extension panel.
- Keep workspace-local execution history, restore the last completed execution and remove expired history automatically.
- Redact connection-string secrets from stored history.
- Generate SQL compatible with MariaDB CLI workflows when selected.

The extension invokes the .NET Entity Framework Core CLI installed in your environment. It does not replace `dotnet ef` and it does not contain a database server.

## Requirements

- Visual Studio Code 1.90 or newer
- .NET SDK with `dotnet ef` available on the PATH

## Configuration

The only VS Code setting is:

- `ef-core-commander.dotnetPath` - path to the `dotnet` executable, defaulting to `dotnet`.

Example `settings.json`:

```json
{
  "ef-core-commander.dotnetPath": "dotnet"
}
```

Build configuration, `--no-build`, command selections and history retention are managed in the EF Core Commander panel and saved inside the workspace.

## History and Data Retention

History is stored in the open workspace, not in a global user folder:

```text
<workspace>/.vscode/ef-core-commander/history
```

Examples:

- Windows: `C:\Users\alex\source\my-api\.vscode\ef-core-commander\history`
- macOS: `/Users/alex/source/my-api/.vscode/ef-core-commander/history`
- Linux: `/home/alex/source/my-api/.vscode/ef-core-commander/history`

History retention settings are saved in:

```text
<workspace>/.vscode/ef-core-commander/config.json
```

Default behavior:

- automatic cleanup is enabled;
- history is kept for 7 days;
- cleanup runs once when the extension initializes for the workspace;
- expired history session files are deleted from disk, not only hidden from the panel.

Use the `History` panel to change `Automatic cleanup`, change `Retention (days)`, delete one entry or use `Clear history` to remove all workspace history.

Example `config.json` for 30-day retention:

```json
{
  "historyAutoCleanupEnabled": true,
  "historyRetentionDays": "30"
}
```

Example `config.json` with automatic cleanup disabled:

```json
{
  "historyAutoCleanupEnabled": false,
  "historyRetentionDays": "30"
}
```

The extension also stores form state in `.vscode/ef-core-commander/form-state.json` and the workspace scan cache in `.vscode/ef-core-commander/workspace-model.json`. Workspace-owned paths are stored relative when possible so local state remains portable if the workspace folder moves. Connection-string secrets are redacted from stored history, and custom connection-string values are not persisted.

## Links

- [Author website](https://manandrei.ro)
- [Source code and issue tracker](https://github.com/manandrei/ef-core-commander)
- [Changelog](CHANGELOG.md)

## License

Released under the [MIT License](LICENSE).
