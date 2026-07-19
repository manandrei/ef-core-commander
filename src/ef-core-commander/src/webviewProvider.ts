import * as path from "path";
import * as vscode from "vscode";
import { formatDatabaseMigrationSummary, parseDatabaseMigrationStatus } from "./databaseMigrationStatus";
import { buildEfCommand, buildMigrationListCommand, buildTargetMigrationItems } from "./efCommandBuilder";
import { processMariaDbCliScript, withTemporarySqlScript } from "./mariaDbCliScript";
import { createExecutionSession, ExecutionHistoryStore, ExecutionLogStream, ExecutionSession, redactSensitiveData } from "./executionHistory";
import { FormState, WorkspaceCache } from "./workspaceCache";
import { CommandOptions, DatabaseMigrationSelection, DatabaseMigrationStatus, EfOperation, WorkspaceModel } from "./types";

type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh"; payload?: Partial<CommandOptions> }
  | { type: "checkDatabaseMigrations"; payload: Partial<CommandOptions> }
  | { type: "run"; payload: Partial<CommandOptions> }
  | { type: "history" }
  | { type: "historyEntry"; id: string }
  | { type: "deleteHistory"; id: string }
  | { type: "clearHistory" }
  | { type: "restoreLastExecution" }
  | { type: "persist"; payload: Record<string, string | boolean | undefined> };

export class EfCoreWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private model?: WorkspaceModel;
  private databaseMigrationStatus?: DatabaseMigrationStatus;
  private activeSession?: ExecutionSession;
  private lastExecution?: ExecutionSession;
  private historyStore?: ExecutionHistoryStore;
  private persisted: FormState = {};
  private cache?: WorkspaceCache;
  private persistTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private workspaceWatcher?: vscode.FileSystemWatcher;
  private refreshQueue: Promise<void> = Promise.resolve();
  private initializePromise?: Promise<void>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly refreshModel: () => Promise<WorkspaceModel>,
    private readonly runCommand: (command: string, workingDirectory: string, onOutput?: (stream: ExecutionLogStream, text: string) => void) => Promise<string>
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = this.render(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message as WebviewMessage));
    this.initializePromise ??= this.initialize();
    void this.initializePromise;
  }

  async refresh(checkDatabase = true, payload?: Partial<CommandOptions>): Promise<void> {
    const work = this.refreshQueue.then(() => this.performRefresh(checkDatabase, payload));
    this.refreshQueue = work.catch(() => undefined);
    return work;
  }

  private async performRefresh(checkDatabase = true, payload?: Partial<CommandOptions>): Promise<void> {
    this.model = await this.refreshModel();
    this.selectCacheForProject(payload?.migrationProjectPath || this.getPersistedValue("migrationProjectPath"));
    await this.cache?.saveModel(this.model);
    this.databaseMigrationStatus = undefined;
    this.postState();
    if (checkDatabase) {
      await this.checkDatabaseMigrations(payload);
    }
  }

  async runOperation(operation: EfOperation): Promise<void> {
    await vscode.commands.executeCommand("ef-core-commander.panel.focus");
    this.post({ type: "selectOperation", operation });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === "ready") {
      this.postState();
      return;
    }

    if (message.type === "refresh") {
      await this.refresh(true, message.payload);
      return;
    }

    if (message.type === "checkDatabaseMigrations") {
      await this.checkDatabaseMigrations(message.payload);
      return;
    }

    if (message.type === "persist") {
      await this.persist(message.payload);
      return;
    }

    if (message.type === "history") { await this.postHistory(); return; }
    if (message.type === "historyEntry") { await this.postHistoryEntry(message.id); return; }
    if (message.type === "deleteHistory") { await this.historyStoreForCurrentWorkspace().delete(message.id); await this.postHistory(); return; }
    if (message.type === "clearHistory") {
      await this.historyStoreForCurrentWorkspace().clear();
      this.lastExecution = undefined;
      this.postState();
      await this.postHistory();
      return;
    }
    if (message.type === "restoreLastExecution") {
      const session = this.activeSession || this.lastExecution;
      if (session) this.post({ type: "executionRestored", session });
      return;
    }

    if (message.type === "run") {
      await this.execute(message.payload);
    }
  }

  private async initialize(): Promise<void> {
    const roots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [process.cwd()];
    const candidates = await Promise.all(roots.map(async root => {
      const cache = new WorkspaceCache(path.join(root, ".vscode", "ef-core-commander"));
      return { root, cache, form: await cache.loadForm(), model: await cache.loadModel() };
    }));
    const selected = candidates.find(candidate => {
      const project = candidate.form.migrationProjectPath;
      return typeof project === "string" && this.isPathInside(project, candidate.root);
    }) || candidates.find(candidate => Object.keys(candidate.form).length > 0) || candidates[0];
    this.cache = selected.cache;
    const cachedModel = selected.model;
    this.persisted = selected.form;
    if (Object.keys(this.persisted).length === 0) this.persisted = this.context.workspaceState.get<FormState>("ef-core-commander.persisted", {});
    this.watchWorkspace();
    try { await this.refresh(false); }
    catch (error) {
      this.model = cachedModel;
      this.postState();
      const message = redactSensitiveData(error instanceof Error ? error.message : String(error));
      this.output.appendLine(`Workspace refresh failed: ${message}`);
      void vscode.window.showErrorMessage(`EF Core Commander workspace refresh failed: ${message}`);
    }
  }

  private watchWorkspace(): void {
    if (this.workspaceWatcher) return;
    const watcher = vscode.workspace.createFileSystemWatcher("**/{*.cs,*.csproj,appsettings*.json}");
    const schedule = (uri: vscode.Uri) => {
      const normalized = uri.fsPath.replace(/\\/g, "/").toLowerCase();
      if (["/bin/", "/obj/", "/node_modules/", "/.git/"].some(part => normalized.includes(part))) return;
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refresh(false).catch(error => this.output.appendLine(`Background refresh failed: ${redactSensitiveData(String(error))}`)), 500);
    };
    watcher.onDidCreate(schedule); watcher.onDidChange(schedule); watcher.onDidDelete(schedule);
    this.context.subscriptions.push(watcher);
    this.workspaceWatcher = watcher;
  }

  private async execute(payload: Partial<CommandOptions>): Promise<void> {
    const model = this.model || await this.refreshModel();
    const migrationProject = model.projects.find(project => project.path === payload.migrationProjectPath);
    if (!migrationProject) {
      void vscode.window.showErrorMessage("Select a migration project before running an EF Core command.");
      return;
    }

    const options = this.toCommandOptions(payload, migrationProject.path);

    if (!options.dbContextName) {
      void vscode.window.showErrorMessage("Select a DbContext before running an EF Core command.");
      return;
    }

    const session = createExecutionSession(options.operation, migrationProject.path, options.dbContextName);
    this.historyStore = this.historyStoreForProject(migrationProject.path, migrationProject.directory);
    this.activeSession = session;
    this.post({ type: "executionStarted", operation: options.operation });
    try {
      if (options.operation === "generateSqlScript" && options.mariaDbCliCompatible) {
        await this.executeMariaDbCliScript(options, migrationProject.directory);
      } else {
        const command = buildEfCommand(options);
        await this.runLoggedCommand(command, migrationProject.directory);
      }
      if (options.operation === "updateDatabase") {
        await this.checkDatabaseMigrations({ ...options, noBuild: true }, session);
      }
      session.status = "succeeded";
    } catch (error) {
      const message = redactSensitiveData(error instanceof Error ? error.message : String(error));
      this.appendLog("stderr", message);
      session.status = "failed";
      void vscode.window.showErrorMessage(`EF Core Commander command failed: ${message}`);
    } finally {
      session.finishedAt = new Date().toISOString();
      await this.historyStore.save(session);
      this.lastExecution = session;
      this.activeSession = undefined;
      this.post({ type: "executionCompleted", status: session.status });
      this.postState();
      await this.postHistory();
    }
  }

  private async executeMariaDbCliScript(options: CommandOptions, workingDirectory: string): Promise<void> {
    this.appendLog("system", "MariaDB CLI compatibility enabled; generating a temporary EF Core SQL script.");
    await withTemporarySqlScript(async temporaryScriptPath => {
      const command = buildEfCommand({ ...options, scriptOutput: temporaryScriptPath });
      await this.runLoggedCommand(command, workingDirectory);

      const outputPath = options.scriptOutput
        ? path.resolve(workingDirectory, options.scriptOutput)
        : undefined;
      const script = await processMariaDbCliScript(temporaryScriptPath, outputPath);
      if (outputPath) {
        this.appendLog("system", `MariaDB CLI-compatible SQL script written to ${outputPath}`);
      } else if (script !== undefined) {
        this.appendLog("system", "MariaDB CLI-compatible SQL script:");
        this.appendLog("system", script);
      }
    });
  }

  private async checkDatabaseMigrations(payload?: Partial<CommandOptions>, existingSession?: ExecutionSession): Promise<void> {
    const model = this.model || await this.refreshModel();
    this.model = model;
    const migrationProjectPath = payload?.migrationProjectPath || this.getPersistedValue("migrationProjectPath") || model.migrationProjects[0]?.path;
    const migrationProject = model.projects.find(project => project.path === migrationProjectPath);
    const dbContextName = payload?.dbContextName || this.getPersistedValue("dbContextName") || model.dbContexts[0]?.name;
    if (!migrationProject || !dbContextName) {
      this.databaseMigrationStatus = {
        selection: this.toSelection(payload, migrationProjectPath || "", dbContextName || ""),
        state: "error",
        pending: [],
        error: "Select a migration project and DbContext before checking database migrations."
      };
      this.postState();
      return;
    }

    const options = this.toCommandOptions(payload, migrationProject.path, dbContextName);
    const selection = this.toSelection(options, migrationProject.path, dbContextName);
    const command = buildMigrationListCommand(options);
    const ownsSession = !existingSession;
    const session = existingSession || createExecutionSession("checkDatabaseMigrations", migrationProject.path, dbContextName);
    if (ownsSession) { this.historyStore = this.historyStoreForProject(migrationProject.path, migrationProject.directory); this.activeSession = session; this.post({ type: "executionStarted", operation: "checkDatabaseMigrations" }); }
    try {
      const output = await this.runLoggedCommand(command, migrationProject.directory);
      this.databaseMigrationStatus = parseDatabaseMigrationStatus(output, selection);
      this.appendLog("system", formatDatabaseMigrationSummary(this.databaseMigrationStatus));
      if (ownsSession) session.status = "succeeded";
    } catch (error) {
      const message = redactSensitiveData(error instanceof Error ? error.message : String(error));
      this.databaseMigrationStatus = { selection, state: "error", pending: [], error: message };
      session.status = "failed";
      if (ownsSession) {
        this.appendLog("stderr", message);
        void vscode.window.showErrorMessage(`EF Core Commander database migration check failed: ${message}`);
      } else {
        throw error;
      }
    } finally {
      if (ownsSession) {
        session.finishedAt = new Date().toISOString();
        await this.historyStore!.save(session);
        this.lastExecution = session;
        this.activeSession = undefined;
        this.post({ type: "executionCompleted", status: session.status });
        this.postState();
        await this.postHistory();
      }
      this.postState();
    }
  }

  private async runLoggedCommand(command: string, workingDirectory: string): Promise<string> {
    this.appendLog("system", `> dotnet ${redactSensitiveData(command)}`);
    return this.runCommand(command, workingDirectory, (stream, text) => this.appendLog(stream, text));
  }

  private appendLog(stream: ExecutionLogStream, text: string): void {
    const safeText = redactSensitiveData(text);
    this.output.append(safeText.endsWith("\n") ? safeText : `${safeText}\n`);
    this.activeSession?.entries.push({ timestamp: new Date().toISOString(), stream, text: safeText });
    this.post({ type: "executionLog", stream, text: safeText });
  }

  private historyStoreForProject(projectPath: string, fallbackDirectory: string): ExecutionHistoryStore {
    const workspaceDirectory = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectPath))?.uri.fsPath || fallbackDirectory;
    return new ExecutionHistoryStore(path.join(workspaceDirectory, ".vscode", "ef-core-commander", "history"));
  }

  private selectCacheForProject(projectPath?: string): void {
    if (!projectPath) return;
    const workspaceDirectory = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectPath))?.uri.fsPath;
    if (workspaceDirectory) this.cache = new WorkspaceCache(path.join(workspaceDirectory, ".vscode", "ef-core-commander"));
  }

  private isPathInside(candidatePath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private historyStoreForCurrentWorkspace(): ExecutionHistoryStore {
    const selectedPath = this.getPersistedValue("migrationProjectPath");
    const project = this.model?.projects.find(item => item.path === selectedPath) || this.model?.projects[0];
    return this.historyStoreForProject(project?.path || "", project?.directory || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd());
  }

  private async postHistory(): Promise<void> {
    this.post({ type: "historyData", sessions: await this.historyStoreForCurrentWorkspace().list() });
  }

  private async postHistoryEntry(id: string): Promise<void> {
    this.post({ type: "historyEntryData", session: await this.historyStoreForCurrentWorkspace().get(id) });
  }

  private toCommandOptions(payload: Partial<CommandOptions> | undefined, migrationProjectPath: string, dbContextName?: string): CommandOptions {
    const defaults = this.getDefaults();
    return {
      operation: payload?.operation || "addMigration",
      migrationProjectPath,
      startupProjectPath: payload?.startupProjectPath || this.getPersistedValue("startupProjectPath"),
      dbContextName: dbContextName || payload?.dbContextName || this.getPersistedValue("dbContextName") || "",
      buildConfiguration: payload?.buildConfiguration || this.getPersistedValue("buildConfiguration") || defaults.buildConfiguration,
      noBuild: payload?.noBuild ?? this.getPersistedBoolean("noBuild", defaults.noBuild),
      targetFramework: payload?.targetFramework || this.getPersistedValue("targetFramework"),
      creationMethod: payload?.creationMethod || this.getPersistedValue("creationMethod") as CommandOptions["creationMethod"] || "StartupProject",
      migrationName: payload?.migrationName,
      outputDir: payload?.outputDir,
      fromMigration: payload?.fromMigration,
      toMigration: payload?.toMigration,
      scriptOutput: payload?.scriptOutput,
      idempotent: payload?.idempotent,
      noTransactions: payload?.noTransactions,
      mariaDbCliCompatible: payload?.mariaDbCliCompatible,
      connection: payload?.connection || this.getPersistedValue("connection"),
      useDefaultConnection: payload?.useDefaultConnection ?? this.getPersistedBoolean("useDefaultConnection", true),
      additionalArgs: payload?.additionalArgs
    };
  }

  private toSelection(payload: Partial<CommandOptions> | undefined, migrationProjectPath: string, dbContextName: string): DatabaseMigrationSelection {
    const options = this.toCommandOptions(payload, migrationProjectPath, dbContextName);
    return {
      migrationProjectPath: options.migrationProjectPath,
      startupProjectPath: options.startupProjectPath,
      dbContextName: options.dbContextName,
      buildConfiguration: options.buildConfiguration,
      noBuild: options.noBuild,
      targetFramework: options.targetFramework,
      creationMethod: options.creationMethod,
      connection: options.connection,
      useDefaultConnection: options.useDefaultConnection ?? true
    };
  }

  private getPersistedValue(key: string): string | undefined {
    const value = this.persisted[key];
    return typeof value === "string" ? value : undefined;
  }

  private getPersistedBoolean(key: string, fallback: boolean): boolean {
    const value = this.persisted[key];
    return typeof value === "boolean" ? value : fallback;
  }

  private postState(): void {
    if (!this.view || !this.model) {
      return;
    }

    this.post({
      type: "state",
      model: this.model,
      defaults: this.getDefaults(),
      persisted: this.persisted,
      lastExecution: this.activeSession || this.lastExecution,
      databaseMigrationStatus: this.databaseMigrationStatus,
      targetMigrations: Object.fromEntries(this.model.projects.map(project => [
        project.path,
        buildTargetMigrationItems(project.migrations.map(migration => migration.name))
      ]))
    });
  }

  private async persist(values: Record<string, string | boolean | undefined>): Promise<void> {
    const next = { ...this.persisted };
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    this.persisted = next;
    this.selectCacheForProject(typeof next.migrationProjectPath === "string" ? next.migrationProjectPath : undefined);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.cache?.saveForm(this.persisted).catch(error => {
      const message = redactSensitiveData(error instanceof Error ? error.message : String(error));
      this.output.appendLine(`Form cache save failed: ${message}`);
      void vscode.window.showErrorMessage(`EF Core Commander could not save form state: ${message}`);
    }), 250);
  }

  private getDefaults(): { buildConfiguration: string; noBuild: boolean } {
    const config = vscode.workspace.getConfiguration("ef-core-commander");
    return {
      buildConfiguration: config.get<string>("defaultBuildConfiguration", "Debug"),
      noBuild: config.get<boolean>("useNoBuildByDefault", false)
    };
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private render(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const script = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, "media", "panel.js")));
    void script;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EF Core Commander</title>
  <style>
    body { box-sizing: border-box; display: flex; flex-direction: column; height: 100vh; margin: 0; padding: 12px; overflow: hidden; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    #form { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    #form.hidden { display: none; }
    #formFields { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px; }
    label { display: block; margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    select, input, textarea, button { width: 100%; box-sizing: border-box; margin-top: 4px; }
    select, input, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; padding: 7px 10px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit; }
    button:hover { filter: brightness(1.08); border-color: var(--vscode-focusBorder); }
    button:disabled { opacity: .6; cursor: default; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .hidden { display: none; }
    .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
    .check { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .check input { width: auto; margin: 0; }
    .bottom-panel { flex: 0 0 auto; margin-top: 10px; padding-top: 8px; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-input-border); }
    .status { max-height: 30vh; margin: 0 0 8px; padding: 10px; overflow-y: auto; border: 1px solid var(--vscode-input-border); background: var(--vscode-editor-inactiveSelectionBackground); }
    .status.error { border-color: var(--vscode-inputValidation-errorBorder); }
    .status.unknown { border-color: var(--vscode-inputValidation-warningBorder); }
    .status-title { font-weight: 600; margin-bottom: 6px; }
    .status ul { margin: 6px 0 0; padding-left: 20px; }
    .action-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    .action-bar button { width: auto; min-height: 34px; margin-top: 0; white-space: nowrap; box-shadow: 0 1px 2px var(--vscode-widget-shadow); }
    .button-icon { display: inline-flex; width: 15px; justify-content: center; font-size: 15px; line-height: 1; }
    .extension-version { margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 11px; text-align: center; }
    .execution-panel, .history-panel { display: flex; flex: 1; width: 100%; min-width: 0; min-height: 0; flex-direction: column; }
    .execution-panel.hidden, .history-panel.hidden { display: none; }
    .execution-log { box-sizing: border-box; flex: 1; min-width: 0; min-height: 0; overflow: auto; margin: 12px 0; padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-input-border); }
    .execution-log.no-wrap { white-space: pre; overflow-wrap: normal; word-break: normal; }
    .execution-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .execution-header .check { margin: 0; font-size: 12px; white-space: nowrap; }
    .spinner { display: inline-block; width: 12px; height: 12px; margin-right: 7px; border: 2px solid var(--vscode-descriptionForeground); border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
    .spinner.hidden { display: none; }
    .history-list { overflow-y: auto; }
    .history-row { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--vscode-input-border); }
    .history-row button, .history-actions button { width: auto; margin: 0; padding: 5px 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="empty" class="empty">Scanning workspace...</div>
  <form id="form" class="hidden">
    <div id="formFields">
    <label>Operation<select id="operation"></select></label>
    <label>Migration project<select id="migrationProject"></select></label>
    <label>Startup project<select id="startupProject"></select></label>
    <label>DbContext<select id="dbContext"></select></label>
    <div class="row">
      <label>Configuration<select id="buildConfigurationPreset"><option>Debug</option><option>Release</option><option value="Custom">Custom</option></select></label>
      <label>Target framework<select id="targetFramework"></select></label>
    </div>
    <label id="customConfigurationField" class="hidden">Custom configuration<input id="buildConfigurationCustom" placeholder="Configuration name"></label>
    <label>Creation method<select id="creationMethod"><option>StartupProject</option><option>DesignTimeFactory</option></select></label>
    <div class="check"><input id="noBuild" type="checkbox"><span>Use --no-build</span></div>
    <div id="databaseConnectionFields">
      <div class="check"><input id="useDefaultConnection" type="checkbox" checked><span>Use default connection</span></div>
      <div id="connectionFields">
        <label>Connection<select id="connection"></select></label>
        <label id="customConnectionField" class="hidden">Custom connection<input id="connectionCustom" placeholder="Server=...;Database=...;"></label>
      </div>
    </div>
    <div id="addFields">
      <label>Migration name<input id="migrationName" value="Initial"></label>
      <label>Output directory<input id="outputDir" value="Migrations"></label>
    </div>
    <div id="scriptFields">
      <label>From migration<select id="fromMigration"></select></label>
      <label>To migration<select id="toMigration"></select></label>
      <label>Output SQL file<input id="scriptOutput" placeholder="migration.sql"></label>
      <div class="check"><input id="idempotent" type="checkbox"><span>Idempotent script</span></div>
      <div class="check"><input id="noTransactions" type="checkbox"><span>No transactions</span></div>
      <div class="check"><input id="mariaDbCliCompatible" type="checkbox"><span>MariaDB CLI compatible (add delimiters)</span></div>
    </div>
    <div id="updateFields">
      <label>Target migration<select id="targetMigration"></select></label>
    </div>
    <label>Additional arguments<textarea id="additionalArgs" rows="2"></textarea></label>
    </div>
    <div class="bottom-panel">
      <section id="databaseMigrationStatus" class="status hidden" aria-live="polite"></section>
      <div class="action-bar">
        <button type="submit" title="Run the selected EF Core command"><span class="button-icon" aria-hidden="true">▶</span>Run</button>
        <button id="checkDatabaseMigrations" class="secondary" type="button" title="Check the latest applied and pending database migrations"><span class="button-icon" aria-hidden="true">✓</span>Check</button>
        <button id="refresh" class="secondary" type="button" title="Rescan the workspace and refresh database status"><span class="button-icon" aria-hidden="true">↻</span>Refresh</button>
        <button id="lastResult" class="secondary" type="button" title="Restore the last execution result" disabled><span class="button-icon" aria-hidden="true">↶</span>Last result</button>
      </div>
        <footer class="extension-version">EF Core Commander v${this.context.extension.packageJSON.version}</footer>
    </div>
  </form>
  <section id="execution" class="execution-panel hidden" aria-live="polite">
    <div class="execution-header"><div><span id="executionSpinner" class="spinner"></span><strong id="executionTitle">Processing...</strong></div><label class="check"><input id="wrapOutput" type="checkbox" checked><span>Wrap output</span></label></div>
    <pre id="executionLog" class="execution-log"></pre>
    <button id="closeExecution" class="secondary" type="button" disabled><span class="button-icon" aria-hidden="true">×</span>Close</button>
  </section>
  <section id="historyPanel" class="history-panel hidden">
    <div class="history-actions"><button id="closeHistory" class="secondary" type="button"><span class="button-icon" aria-hidden="true">×</span>Close</button><button id="clearHistory" class="secondary" type="button"><span class="button-icon" aria-hidden="true">⌫</span>Clear history</button></div>
    <h3 id="historyTitle">History</h3>
    <div id="historyList" class="history-list"></div>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const operations = [
      ["addMigration", "Add Migration"],
      ["removeMigration", "Remove Last Migration"],
      ["generateSqlScript", "Generate SQL Script"],
      ["updateDatabase", "Update Database"],
      ["dropDatabase", "Drop Database"]
    ];
    let state = undefined;
    let screen = vscode.getState()?.screen || "form";
    let historySessions = [];
    const ids = ["operation","migrationProject","startupProject","dbContext","buildConfigurationPreset","buildConfigurationCustom","targetFramework","creationMethod","noBuild","migrationName","outputDir","fromMigration","toMigration","scriptOutput","idempotent","noTransactions","mariaDbCliCompatible","targetMigration","useDefaultConnection","connection","connectionCustom","additionalArgs","wrapOutput"];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    Object.values(el).forEach(control => {
      control.addEventListener("change", persist);
      if (control.tagName === "INPUT" || control.tagName === "TEXTAREA") control.addEventListener("input", persist);
    });
    window.addEventListener("message", event => {
      if (event.data.type === "state") { state = event.data; render(); }
      if (event.data.type === "selectOperation") { el.operation.value = event.data.operation; updateVisibility(); }
      if (event.data.type === "executionStarted") { document.getElementById("lastResult").disabled = false; screen = "execution"; saveViewState(); document.getElementById("executionLog").textContent = ""; document.getElementById("executionTitle").textContent = "Processing " + event.data.operation + "..."; document.getElementById("executionSpinner").classList.remove("hidden"); document.getElementById("closeExecution").disabled = true; applyScreen(); }
      if (event.data.type === "executionLog") { const log = document.getElementById("executionLog"); log.textContent += event.data.text + (event.data.text.endsWith("\\n") ? "" : "\\n"); log.scrollTop = log.scrollHeight; }
      if (event.data.type === "executionCompleted") { document.getElementById("executionTitle").textContent = event.data.status === "succeeded" ? "Completed" : "Completed with errors"; document.getElementById("executionSpinner").classList.add("hidden"); document.getElementById("closeExecution").disabled = false; }
      if (event.data.type === "executionRestored") { restoreExecution(event.data.session); }
      if (event.data.type === "historyData") { historySessions = event.data.sessions; renderHistoryList(); }
      if (event.data.type === "historyEntryData") { renderHistoryEntry(event.data.session); }
    });
    document.getElementById("refresh").addEventListener("click", () => { persist(); vscode.postMessage({ type: "refresh", payload: collect() }); });
    document.getElementById("checkDatabaseMigrations").addEventListener("click", () => { persist(); vscode.postMessage({ type: "checkDatabaseMigrations", payload: collect() }); });
    document.getElementById("form").addEventListener("submit", event => {
      event.preventDefault();
      persist();
      vscode.postMessage({ type: "run", payload: collect() });
    });
    document.getElementById("closeExecution").addEventListener("click", () => { screen = "form"; saveViewState(); applyScreen(); });
    document.getElementById("closeHistory").addEventListener("click", () => { screen = "form"; saveViewState(); applyScreen(); });
    document.getElementById("clearHistory").addEventListener("click", () => vscode.postMessage({ type: "clearHistory" }));
    document.getElementById("lastResult").addEventListener("click", () => vscode.postMessage({ type: "restoreLastExecution" }));
    const historyButton = document.createElement("button");
    historyButton.id = "history"; historyButton.className = "secondary"; historyButton.type = "button"; historyButton.innerHTML = '<span class="button-icon" aria-hidden="true">◷</span>History';
    historyButton.addEventListener("click", () => { screen = "history"; saveViewState(); applyScreen(); vscode.postMessage({ type: "history" }); });
    document.querySelector(".action-bar").appendChild(historyButton);
    ["migrationProject","startupProject","dbContext","buildConfigurationPreset","buildConfigurationCustom","targetFramework","creationMethod","noBuild","useDefaultConnection","connection","connectionCustom","additionalArgs"].forEach(id => {
      el[id].addEventListener("change", () => { persist(); renderDatabaseMigrationStatus(); });
    });
    el.connectionCustom.addEventListener("input", persist);
    el.buildConfigurationPreset.addEventListener("change", updateConfigurationVisibility);
    el.connection.addEventListener("change", updateConnectionVisibility);
    el.useDefaultConnection.addEventListener("change", updateConnectionVisibility);
    el.wrapOutput.addEventListener("change", updateOutputWrapping);
    el.operation.addEventListener("change", updateVisibility);
    el.migrationProject.addEventListener("change", () => { fillDependentFields(); persist(); renderDatabaseMigrationStatus(); });
    el.startupProject.addEventListener("change", () => { fillDependentFields(); persist(); renderDatabaseMigrationStatus(); });
    function render() {
      const model = state.model;
      document.getElementById("empty").classList.toggle("hidden", model.projects.length > 0);
      document.getElementById("form").classList.toggle("hidden", model.projects.length === 0);
      if (model.projects.length === 0) {
        document.getElementById("empty").textContent = "No .csproj files found in this workspace.";
        return;
      }
      fillOptions(el.operation, operations, state.persisted.operation || "addMigration");
      fillOptions(el.migrationProject, model.migrationProjects.map(p => [p.path, p.name]), state.persisted.migrationProjectPath);
      fillOptions(el.startupProject, model.startupProjects.map(p => [p.path, p.name]), state.persisted.startupProjectPath);
      fillOptions(el.dbContext, model.dbContexts.map(c => [c.name, c.name + " (" + c.projectName + ")"]), state.persisted.dbContextName);
      setBuildConfiguration(state.persisted.buildConfiguration || state.defaults.buildConfiguration);
      el.creationMethod.value = state.persisted.creationMethod || "StartupProject";
      el.noBuild.checked = Boolean(state.persisted.noBuild ?? state.defaults.noBuild);
      el.useDefaultConnection.checked = state.persisted.useDefaultConnection !== false;
      el.mariaDbCliCompatible.checked = Boolean(state.persisted.mariaDbCliCompatible);
      el.scriptOutput.value = state.persisted.scriptOutput || "migration.sql";
      el.migrationName.value = state.persisted.migrationName || "Initial";
      el.outputDir.value = state.persisted.outputDir || "Migrations";
      el.idempotent.checked = Boolean(state.persisted.idempotent);
      el.noTransactions.checked = Boolean(state.persisted.noTransactions);
      el.wrapOutput.checked = state.persisted.wrapOutput !== false;
      document.getElementById("lastResult").disabled = !state.lastExecution;
      el.additionalArgs.value = state.persisted.additionalArgs || "";
      fillDependentFields();
      if (state.persisted.connectionMode === "custom") { el.connection.value = "Custom"; el.connectionCustom.value = ""; }
      updateVisibility();
      updateConfigurationVisibility();
      updateConnectionVisibility();
      updateOutputWrapping();
      renderDatabaseMigrationStatus();
      if (screen === "execution" && !state.lastExecution) screen = "form";
      if (screen === "execution" && state.lastExecution) restoreExecution(state.lastExecution);
      else applyScreen();
    }
    function fillDependentFields() {
      const project = state.model.projects.find(p => p.path === el.migrationProject.value);
      const frameworks = ["<Default>"].concat(project?.targetFrameworks || []);
      const migrations = state.targetMigrations[el.migrationProject.value] || ["0"];
      const status = currentDatabaseMigrationStatus();
      const migrationOptions = migrations.map(migration => [migration, status?.state === "ready" && status.latestApplied === migration ? "[db] " + migration : migration]);
      const connections = selectedStartupProject()?.connectionStrings || [];
      fillOptions(el.targetFramework, frameworks.map(f => [f, f]), state.persisted.targetFramework);
      fillOptions(el.fromMigration, migrationOptions, state.persisted.fromMigration);
      fillOptions(el.toMigration, migrationOptions, state.persisted.toMigration);
      fillOptions(el.targetMigration, migrationOptions, state.persisted.toMigration);
      fillConnectionOptions(connections, state.persisted.connectionName || state.persisted.connection);
    }
    function selectedStartupProject() {
      return state.model.projects.find(p => p.path === el.startupProject.value);
    }
    function updateVisibility() {
      const op = el.operation.value;
      document.getElementById("addFields").classList.toggle("hidden", op !== "addMigration");
      document.getElementById("scriptFields").classList.toggle("hidden", op !== "generateSqlScript");
      document.getElementById("updateFields").classList.toggle("hidden", op !== "updateDatabase");
    }
    function updateOutputWrapping() {
      document.getElementById("executionLog").classList.toggle("no-wrap", !el.wrapOutput.checked);
    }
    function applyScreen() {
      const hasProjects = state?.model?.projects?.length > 0;
      document.getElementById("form").classList.toggle("hidden", !hasProjects || screen !== "form");
      document.getElementById("execution").classList.toggle("hidden", screen !== "execution");
      document.getElementById("historyPanel").classList.toggle("hidden", screen !== "history");
    }
    function saveViewState() {
      vscode.setState({ screen, wrapOutput: el.wrapOutput.checked });
    }
    function restoreExecution(session) {
      if (!session) return;
      screen = "execution";
      document.getElementById("lastResult").disabled = false;
      document.getElementById("executionLog").textContent = session.entries.map(entry => entry.text).join("\\n");
      document.getElementById("executionTitle").textContent = session.status === "running" ? "Processing " + session.operation + "..." : session.status === "succeeded" ? "Completed" : "Completed with errors";
      document.getElementById("executionSpinner").classList.toggle("hidden", session.status !== "running");
      document.getElementById("closeExecution").disabled = session.status === "running";
      updateOutputWrapping();
      saveViewState();
      applyScreen();
      const log = document.getElementById("executionLog"); log.scrollTop = log.scrollHeight;
    }
    function renderHistoryList() {
      const list = document.getElementById("historyList"); list.textContent = "";
      document.getElementById("historyTitle").textContent = "History";
      if (!historySessions.length) { list.textContent = "No execution history."; return; }
      for (const session of historySessions) {
        const row = document.createElement("div"); row.className = "history-row";
        const label = document.createElement("span"); label.textContent = new Date(session.startedAt).toLocaleString() + " — " + session.operation + " (" + session.status + ")";
        const view = document.createElement("button"); view.type = "button"; view.innerHTML = '<span class="button-icon" aria-hidden="true">◉</span>View'; view.addEventListener("click", () => vscode.postMessage({ type: "historyEntry", id: session.id }));
        const remove = document.createElement("button"); remove.type = "button"; remove.innerHTML = '<span class="button-icon" aria-hidden="true">⌫</span>Delete'; remove.addEventListener("click", () => vscode.postMessage({ type: "deleteHistory", id: session.id }));
        row.append(label, view, remove); list.appendChild(row);
      }
    }
    function renderHistoryEntry(session) {
      const list = document.getElementById("historyList"); list.textContent = "";
      document.getElementById("historyTitle").textContent = session ? "History: " + session.operation : "History entry not found";
      if (!session) return;
      const log = document.createElement("pre"); log.className = "execution-log";
      log.textContent = session.entries.map(entry => "[" + entry.timestamp + "] " + entry.text).join("\\n"); list.appendChild(log);
    }
    function setBuildConfiguration(value) {
      if (value === "Debug" || value === "Release") {
        el.buildConfigurationPreset.value = value;
        el.buildConfigurationCustom.value = "";
      } else {
        el.buildConfigurationPreset.value = "Custom";
        el.buildConfigurationCustom.value = value || "";
      }
    }
    function getBuildConfiguration() {
      if (el.buildConfigurationPreset.value === "Custom") {
        return el.buildConfigurationCustom.value.trim();
      }
      return el.buildConfigurationPreset.value;
    }
    function updateConfigurationVisibility() {
      document.getElementById("customConfigurationField").classList.toggle("hidden", el.buildConfigurationPreset.value !== "Custom");
    }
    function fillConnectionOptions(connections, selectedConnection) {
      const detected = connections.map(c => [c.value, c.name]);
      const detectedSelection = detected.find(([value, name]) => value === selectedConnection || name === selectedConnection)?.[0];
      const hasSelectedDetected = Boolean(detectedSelection);
      const shouldUseCustom = selectedConnection && !hasSelectedDetected;
      fillOptions(el.connection, detected.concat([["Custom", "Custom"]]), shouldUseCustom ? "Custom" : detectedSelection);
      el.connectionCustom.value = shouldUseCustom ? selectedConnection : "";
      updateConnectionVisibility();
    }
    function getConnection() {
      if (el.useDefaultConnection.checked) {
        return "";
      }
      if (el.connection.value === "Custom") {
        return el.connectionCustom.value.trim();
      }
      return el.connection.value;
    }
    function updateConnectionVisibility() {
      const useCustom = !el.useDefaultConnection.checked && el.connection.value === "Custom";
      document.getElementById("connectionFields").classList.toggle("hidden", el.useDefaultConnection.checked);
      document.getElementById("customConnectionField").classList.toggle("hidden", !useCustom);
    }
    function currentDatabaseMigrationStatus() {
      const status = state?.databaseMigrationStatus;
      if (!status) return undefined;
      const selection = status.selection;
      if (selection.migrationProjectPath !== el.migrationProject.value ||
          selection.startupProjectPath !== el.startupProject.value ||
          selection.dbContextName !== el.dbContext.value ||
          selection.buildConfiguration !== getBuildConfiguration() ||
          selection.targetFramework !== el.targetFramework.value ||
          selection.creationMethod !== el.creationMethod.value ||
          selection.useDefaultConnection !== el.useDefaultConnection.checked ||
          (!selection.useDefaultConnection && selection.connection !== getConnection())) return undefined;
      return status;
    }
    function renderDatabaseMigrationStatus() {
      const card = document.getElementById("databaseMigrationStatus");
      const status = currentDatabaseMigrationStatus();
      card.textContent = "";
      card.className = "status";
      if (!status || status.state !== "error") {
        card.classList.add("hidden");
        return;
      }
      card.classList.remove("hidden");
      card.classList.add("error");
      card.textContent = status.error || "Database migration check failed.";
    }
    function collect() {
      return {
        operation: el.operation.value,
        migrationProjectPath: el.migrationProject.value,
        startupProjectPath: el.startupProject.value,
        dbContextName: el.dbContext.value,
        buildConfiguration: getBuildConfiguration(),
        noBuild: el.noBuild.checked,
        targetFramework: el.targetFramework.value,
        creationMethod: el.creationMethod.value,
        migrationName: el.migrationName.value,
        outputDir: el.outputDir.value,
        fromMigration: el.fromMigration.value,
        toMigration: el.operation.value === "updateDatabase" ? el.targetMigration.value : el.toMigration.value,
        scriptOutput: el.scriptOutput.value,
        idempotent: el.idempotent.checked,
        noTransactions: el.noTransactions.checked,
        mariaDbCliCompatible: el.mariaDbCliCompatible.checked,
        wrapOutput: el.wrapOutput.checked,
        connection: getConnection(),
        connectionName: !el.useDefaultConnection.checked && el.connection.value !== "Custom" ? el.connection.options[el.connection.selectedIndex]?.text : "",
        useDefaultConnection: el.useDefaultConnection.checked,
        additionalArgs: el.additionalArgs.value
      };
    }
    function persist() {
      const payload = collect();
      payload.operation = el.operation.value;
      vscode.postMessage({ type: "persist", payload });
    }
    function fillOptions(select, entries, selected) {
      select.textContent = "";
      for (const [value, label] of entries) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
      if (selected && entries.some(([value]) => value === selected)) {
        select.value = selected;
      }
    }
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
