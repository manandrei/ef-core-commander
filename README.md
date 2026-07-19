# EF Core Commander

EF Core Commander is a Visual Studio Code extension for discovering Entity Framework Core projects and running common `dotnet ef` migration and database commands from an Activity Bar panel.

Created and maintained by [ManAndrei.ro](https://manandrei.ro).

## Capabilities

EF Core Commander can:

- scan the current workspace for `.csproj` files, EF Core references, `DbContext` classes, migrations and connection strings from `appsettings*.json` files;
- select a migration project, startup project, `DbContext`, target framework, build configuration and connection source;
- add a migration with a configurable migration name and output directory;
- remove the last migration;
- generate migration SQL scripts for a selected migration range, including idempotent and no-transaction script options;
- update a database to the selected migration or to the latest migration;
- drop a database;
- refresh the detected workspace model when project or source files change;
- show the latest applied migration and pending migrations when the database status can be determined;
- stream command output and errors in the extension panel;
- keep local execution history and restore the last completed execution;
- redact connection-string secrets from stored execution history and avoid persisting custom connection-string values;
- generate SQL that is compatible with MariaDB CLI workflows when that option is selected.

The extension invokes the .NET Entity Framework Core CLI installed in the user's environment. It does not replace `dotnet ef` and it does not contain a database server.

## Configuration

The following VS Code settings are available under `EF Core Commander`:

- `ef-core-commander.dotnetPath` — path to the `dotnet` executable, defaulting to `dotnet`;
- `ef-core-commander.defaultBuildConfiguration` — default build configuration, defaulting to `Debug`;
- `ef-core-commander.useNoBuildByDefault` — whether generated commands use `--no-build` by default.

## Repository layout

- `src/ef-core-commander` — VS Code extension package, production TypeScript, webview and extension tests.
- `test/fixtures/ef-core-commander-sqlite-test` — small EF Core 10 + SQLite workspace used to verify EF CLI commands from the extension.
- `docs` — architecture, development, testing and release documentation.
- `.github` — CI, VSIX packaging, dependency updates and contribution templates.

## Requirements

- Node.js 20 or newer
- .NET 10 SDK
- Visual Studio Code 1.90 or newer
- `dotnet ef` 10.x available on the PATH

## Setup

```powershell
npm install --prefix src/ef-core-commander
dotnet restore test/fixtures/ef-core-commander-sqlite-test/EfCoreCommander.SqliteTest.csproj
```

## Validation

```powershell
npm test
dotnet list test/fixtures/ef-core-commander-sqlite-test/EfCoreCommander.SqliteTest.csproj package --vulnerable --include-transitive
```

The SQLite fixture is also available for manual extension checks:

```powershell
dotnet run --project test/fixtures/ef-core-commander-sqlite-test/EfCoreCommander.SqliteTest.csproj
```

## Package the extension

```powershell
npm run package:vsix
```

The generated VSIX is written under `src/ef-core-commander` and is ignored by Git.

## License

EF Core Commander is released under the [MIT License](LICENSE). You may use, copy, modify, distribute and sublicense the software, including for commercial purposes, subject to the license conditions. Contributions are welcome.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Changes should include focused tests and documentation updates when behavior or contributor workflow changes.
