import { promises as fs } from "node:fs";
import * as path from "node:path";
import { WorkspaceModel } from "./types";
import { atomicWriteFile } from "./fileStorage";

export type FormState = Record<string, string | boolean>;
const workspaceConfigKeys = new Set(["historyAutoCleanupEnabled", "historyRetentionDays"]);

export class WorkspaceCache {
  private readonly directory: string;

  constructor(private readonly workspaceRoot: string) {
    this.directory = path.join(workspaceRoot, ".vscode", "ef-core-commander");
  }

  async loadForm(): Promise<FormState> {
    const storedForm = await this.read<FormState>("form-state.json");
    const config = await this.read<FormState>("config.json");
    if (!storedForm && !config) return {};

    const formSplit = splitFormAndConfig(storedForm || {});
    const configSplit = splitFormAndConfig(config || {});
    const restoredForm = restoreFormState({ ...configSplit.form, ...formSplit.form }, this.workspaceRoot);
    const restoredConfig = sanitizeWorkspaceConfig({ ...formSplit.config, ...configSplit.config });

    await this.saveSplitState(
      restoredForm,
      restoredConfig,
      Boolean(storedForm) || Object.keys(configSplit.form).length > 0,
      Boolean(config) || Object.keys(formSplit.config).length > 0
    );
    return { ...restoredForm, ...restoredConfig };
  }

  async saveForm(state: FormState): Promise<void> {
    const split = splitFormAndConfig(state);
    await this.saveSplitState(split.form, split.config, true, Object.keys(split.config).length > 0);
  }
  async loadModel(): Promise<WorkspaceModel | undefined> {
    const model = await this.read<WorkspaceModel>("workspace-model.json");
    if (!model) return undefined;
    const restored = restoreModel(model, this.workspaceRoot);
    await this.saveModel(restored);
    return restored;
  }
  async saveModel(model: WorkspaceModel): Promise<void> { await this.write("workspace-model.json", sanitizeModel(model, this.workspaceRoot)); }

  private async write(file: string, value: unknown): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const ignore = path.join(this.directory, ".gitignore");
    try { await fs.access(ignore); } catch { await atomicWriteFile(ignore, "*\n"); }
    await atomicWriteFile(path.join(this.directory, file), JSON.stringify(value, null, 2));
  }
  private async read<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, file), "utf8")) as T; } catch { return undefined; }
  }

  private async saveSplitState(form: FormState, config: FormState, writeForm: boolean, writeConfig: boolean): Promise<void> {
    if (writeForm) await this.write("form-state.json", sanitizeFormState(form, this.workspaceRoot));
    const safeConfig = sanitizeWorkspaceConfig(config);
    if (writeConfig || Object.keys(safeConfig).length > 0) await this.write("config.json", safeConfig);
  }
}

export function sanitizeFormState(state: FormState, workspaceRoot?: string): FormState {
  const safe = splitFormAndConfig(state).form;
  delete safe.connection;
  delete safe.connectionCustom;
  for (const key of ["migrationProjectPath", "startupProjectPath"]) {
    if (typeof safe[key] === "string") safe[key] = toPortablePath(safe[key], workspaceRoot);
  }
  if (safe.useDefaultConnection === true) delete safe.connectionMode;
  else safe.connectionMode = safe.connectionName ? "detected" : "custom";
  if (safe.connectionMode === "custom") delete safe.connectionName;
  return safe;
}

function sanitizeWorkspaceConfig(state: FormState): FormState {
  return splitFormAndConfig(state).config;
}

export function sanitizeModel(model: WorkspaceModel, workspaceRoot?: string): WorkspaceModel {
  const projects = model.projects.map(project => ({
    ...project,
    path: toPortablePath(project.path, workspaceRoot),
    directory: toPortablePath(project.directory, workspaceRoot),
    dbContexts: project.dbContexts.map(context => ({ ...context, projectPath: toPortablePath(context.projectPath, workspaceRoot) })),
    migrations: project.migrations.map(migration => ({ ...migration, filePath: toPortablePath(migration.filePath, workspaceRoot) })),
    connectionStrings: project.connectionStrings.map(connection => ({ ...connection, value: "", filePath: toPortablePath(connection.filePath, workspaceRoot) }))
  }));
  const byPath = new Map(model.projects.map((project, index) => [project.path, projects[index]]));
  return {
    projects,
    migrationProjects: model.migrationProjects.map(project => byPath.get(project.path)!).filter(Boolean),
    startupProjects: model.startupProjects.map(project => byPath.get(project.path)!).filter(Boolean),
    dbContexts: model.dbContexts.map(context => ({ ...context, projectPath: toPortablePath(context.projectPath, workspaceRoot) }))
  };
}

function restoreFormState(state: FormState, workspaceRoot: string): FormState {
  const restored = { ...state };
  for (const key of ["migrationProjectPath", "startupProjectPath"]) {
    if (typeof restored[key] === "string") restored[key] = fromPortablePath(restored[key], workspaceRoot);
  }
  return restored;
}

function splitFormAndConfig(state: FormState): { form: FormState; config: FormState } {
  const form: FormState = {};
  const config: FormState = {};
  for (const [key, value] of Object.entries(state)) {
    if (workspaceConfigKeys.has(key)) config[key] = value;
    else form[key] = value;
  }
  return { form, config };
}

function restoreModel(model: WorkspaceModel, workspaceRoot: string): WorkspaceModel {
  const projects = model.projects.map(project => ({
    ...project,
    path: fromPortablePath(project.path, workspaceRoot),
    directory: fromPortablePath(project.directory, workspaceRoot),
    dbContexts: project.dbContexts.map(context => ({ ...context, projectPath: fromPortablePath(context.projectPath, workspaceRoot) })),
    migrations: project.migrations.map(migration => ({ ...migration, filePath: fromPortablePath(migration.filePath, workspaceRoot) })),
    connectionStrings: project.connectionStrings.map(connection => ({ ...connection, filePath: fromPortablePath(connection.filePath, workspaceRoot) }))
  }));
  const byPath = new Map(projects.map(project => [normalizePath(project.path), project]));
  return {
    projects,
    migrationProjects: model.migrationProjects.map(project => byPath.get(normalizePath(fromPortablePath(project.path, workspaceRoot)))!).filter(Boolean),
    startupProjects: model.startupProjects.map(project => byPath.get(normalizePath(fromPortablePath(project.path, workspaceRoot)))!).filter(Boolean),
    dbContexts: model.dbContexts.map(context => ({ ...context, projectPath: fromPortablePath(context.projectPath, workspaceRoot) }))
  };
}

export function toPortablePath(value: string, workspaceRoot?: string): string {
  if (!workspaceRoot || !path.isAbsolute(value)) return value;
  const workspacePath = rebaseMovedWorkspacePath(value, workspaceRoot);
  if (!isPathInside(workspacePath, workspaceRoot)) return value;
  return path.relative(workspaceRoot, workspacePath).replace(/\\/g, "/") || ".";
}

export function fromPortablePath(value: string, workspaceRoot: string): string {
  if (path.isAbsolute(value)) return rebaseMovedWorkspacePath(value, workspaceRoot);
  return path.resolve(workspaceRoot, value);
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePath(value: string): string {
  return path.normalize(value).toLowerCase();
}

function rebaseMovedWorkspacePath(value: string, workspaceRoot: string): string {
  if (isPathInside(value, workspaceRoot)) return value;
  const rootName = path.basename(workspaceRoot).toLowerCase();
  const parts = path.normalize(value).split(path.sep).filter(Boolean);
  const rootIndex = parts.map(part => part.toLowerCase()).lastIndexOf(rootName);
  if (rootIndex < 0 || rootIndex === parts.length - 1) return value;
  return path.resolve(workspaceRoot, ...parts.slice(rootIndex + 1));
}
