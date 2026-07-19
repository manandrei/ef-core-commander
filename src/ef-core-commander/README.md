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
- Keep local execution history and restore the last completed execution.
- Redact connection-string secrets from stored history.
- Generate SQL compatible with MariaDB CLI workflows when selected.

The extension invokes the .NET Entity Framework Core CLI installed in your environment. It does not replace `dotnet ef` and it does not contain a database server.

## Requirements

- Visual Studio Code 1.90 or newer
- .NET SDK with `dotnet ef` available on the PATH

## Configuration

- `ef-core-commander.dotnetPath` — path to the `dotnet` executable, defaulting to `dotnet`.
- `ef-core-commander.defaultBuildConfiguration` — default build configuration, defaulting to `Debug`.
- `ef-core-commander.useNoBuildByDefault` — use `--no-build` by default for generated commands.

## Links

- [Author website](https://manandrei.ro)
- [Source code and issue tracker](https://github.com/manandrei/ef-core-commander)

## License

Released under the [MIT License](LICENSE).
