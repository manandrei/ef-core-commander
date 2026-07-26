# Changelog

All notable changes to EF Core Commander are documented in this file.

## 1.1.0 - 2026-07-26

### Added

- Added workspace-local history retention controls to the History panel.
- Added automatic history cleanup with a default 7-day retention period.
- Added portable workspace-local persistence for history, form state and cached workspace paths.

### Changed

- Stored history retention settings in `.vscode/ef-core-commander/config.json`.
- Kept form selections in `.vscode/ef-core-commander/form-state.json`.
- Limited VS Code Settings to the runtime `ef-core-commander.dotnetPath` dependency setting.
- Removed the `history-index.json` dependency; history is read directly from session files.

### Fixed

- Deleted expired history session files from disk during automatic cleanup.
- Removed legacy `history-index.json` during cleanup when present.
- Reloaded history entries when returning to a restored History panel after switching VS Code views.
- Reset the extension panel to the form after restarting VS Code, while keeping in-session panel navigation.
- Opened History `View` entries in the execution output panel instead of replacing the history list inline.
- Returned from a viewed history entry back to the History list when closing the output panel.
