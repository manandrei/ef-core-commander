# Architecture

## Extension package

The VS Code extension lives under `src/ef-core-commander`. `extension.ts` registers the commands and webview provider. `webviewProvider.ts` owns the webview UI, EF CLI execution flow, execution output, history and restored view state.

Supporting modules provide workspace scanning, command construction, migration status parsing, local cache, execution history and MariaDB-compatible SQL post-processing.

## Runtime flow

1. VS Code activates the extension and registers the EF Core Commander Activity Bar view.
2. The workspace scanner finds projects, DbContexts, migrations and connection strings.
3. The webview sends a command request with the selected options.
4. The extension host starts `dotnet ef`, streams output to the webview and stores the completed execution in local history.
5. The webview can restore the last execution without rerunning the command.

## Test fixture

`test/fixtures/ef-core-commander-sqlite-test` is intentionally independent from the extension runtime. It gives contributors a deterministic Console .NET 10 project with one DbContext and SQLite migrations for fast manual checks.
