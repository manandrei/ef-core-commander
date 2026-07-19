import { promises as fs } from "node:fs";
import * as path from "node:path";
import { WorkspaceModel } from "./types";
import { atomicWriteFile } from "./fileStorage";

export type FormState = Record<string, string | boolean>;

export class WorkspaceCache {
  constructor(private readonly directory: string) {}

  async loadForm(): Promise<FormState> { return this.read<FormState>("form-state.json", {}); }
  async saveForm(state: FormState): Promise<void> { await this.write("form-state.json", sanitizeFormState(state)); }
  async loadModel(): Promise<WorkspaceModel | undefined> { return this.read<WorkspaceModel | undefined>("workspace-model.json", undefined); }
  async saveModel(model: WorkspaceModel): Promise<void> { await this.write("workspace-model.json", sanitizeModel(model)); }

  private async write(file: string, value: unknown): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const ignore = path.join(this.directory, ".gitignore");
    try { await fs.access(ignore); } catch { await atomicWriteFile(ignore, "*\n"); }
    await atomicWriteFile(path.join(this.directory, file), JSON.stringify(value, null, 2));
  }
  private async read<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, file), "utf8")) as T; } catch { return fallback; }
  }
}

export function sanitizeFormState(state: FormState): FormState {
  const safe = { ...state };
  const selectedConnection = safe.connection;
  delete safe.connection;
  delete safe.connectionCustom;
  if (safe.useDefaultConnection === true) delete safe.connectionMode;
  else safe.connectionMode = safe.connectionName ? "detected" : "custom";
  if (safe.connectionMode === "custom") delete safe.connectionName;
  return safe;
}

export function sanitizeModel(model: WorkspaceModel): WorkspaceModel {
  const projects = model.projects.map(project => ({ ...project, connectionStrings: project.connectionStrings.map(connection => ({ ...connection, value: "" })) }));
  const byPath = new Map(projects.map(project => [project.path, project]));
  return { projects, migrationProjects: model.migrationProjects.map(project => byPath.get(project.path)!), startupProjects: model.startupProjects.map(project => byPath.get(project.path)!), dbContexts: model.dbContexts };
}
