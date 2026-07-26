# History and Settings

EF Core Commander keeps generated state inside the workspace that is currently open in VS Code. It does not store history or retention settings in a user profile directory.

## Storage Locations

The storage root is:

```text
<workspace>/.vscode/ef-core-commander
```

History entries are stored as JSON files under:

```text
<workspace>/.vscode/ef-core-commander/history
```

Examples:

| Operating system | Example history directory |
| --- | --- |
| Windows | `C:\Users\alex\source\my-api\.vscode\ef-core-commander\history` |
| macOS | `/Users/alex/source/my-api/.vscode/ef-core-commander/history` |
| Linux | `/home/alex/source/my-api/.vscode/ef-core-commander/history` |

The extension creates `.vscode/ef-core-commander/.gitignore` with `*` so these local files are not committed by default.

## Local Files

| File or directory | Purpose |
| --- | --- |
| `.vscode/ef-core-commander/history/*.json` | One execution-history file per completed EF command. |
| `.vscode/ef-core-commander/config.json` | Workspace-local extension configuration, including history retention. |
| `.vscode/ef-core-commander/form-state.json` | Last form selections, such as selected projects, DbContext and command options. |
| `.vscode/ef-core-commander/workspace-model.json` | Cached workspace scan result for projects, DbContexts, migrations and connection-string sources. |

Workspace-owned paths in these files are stored relative to the workspace when possible, so the local state can continue to work if the workspace folder is moved. Runtime commands still receive absolute paths after the files are loaded.

`history-index.json` is no longer used. If an old `history-index.json` file is found when cleanup runs, it is removed.

## VS Code Settings

The only VS Code setting exposed by the extension is the runtime dependency path:

```json
{
  "ef-core-commander.dotnetPath": "dotnet"
}
```

Use this only when VS Code cannot find the expected `dotnet` executable or when a workspace must run EF commands through a specific SDK path.

History retention is not a VS Code `settings.json` entry. It is saved in the workspace-local `.vscode/ef-core-commander/config.json` file and is normally edited from the History panel.

## Retention Configuration

Open the EF Core Commander panel, click `History`, then use:

- `Automatic cleanup` to enable or disable cleanup.
- `Retention (days)` to choose how many days of history to keep.
- `Clear history` to delete all stored history files for the workspace.
- `Delete` next to a history entry to remove only that entry.

Default behavior:

- automatic cleanup is enabled;
- the default retention period is 7 days;
- the minimum accepted retention period is 1 day;
- the maximum accepted retention period is 3650 days.

The workspace-local config file uses these keys:

```json
{
  "historyAutoCleanupEnabled": true,
  "historyRetentionDays": "7"
}
```

Example: keep history for 30 days.

```json
{
  "historyAutoCleanupEnabled": true,
  "historyRetentionDays": "30"
}
```

Example: disable automatic cleanup.

```json
{
  "historyAutoCleanupEnabled": false,
  "historyRetentionDays": "30"
}
```

`historyRetentionDays` is stored as a string because it is captured from the webview input. Invalid, missing or values below 1 fall back to the 7-day default at runtime.

## Auto-Cleanup

Automatic cleanup runs once when the extension initializes for the workspace. It does not run every hour or continuously in the background.

During cleanup, EF Core Commander:

1. reads the history session files from `.vscode/ef-core-commander/history`;
2. compares each session's `startedAt` timestamp with the current date;
3. deletes session files older than the configured retention period;
4. keeps recent files and files with timestamps that cannot be parsed safely;
5. removes a legacy `history-index.json` file if one exists.

If you change the retention period today, it is enough for cleanup to run once with the new value. When the extension runs again on a later day, it recalculates expiration relative to that later date.

## Data Retention Notes

History is local to each workspace. Removing the workspace-local `.vscode/ef-core-commander/history` directory removes the stored history for that workspace.

Connection-string secrets are redacted from stored command output, and custom connection-string values are not persisted in form state or workspace cache.
