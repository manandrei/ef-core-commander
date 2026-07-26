import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeFormState, WorkspaceCache } from "../workspaceCache";
import { WorkspaceModel } from "../types";

test("does not persist custom connection values", () => {
  assert.deepEqual(sanitizeFormState({ migrationProjectPath: "Data.csproj", connection: "Password=secret", connectionCustom: "Password=secret", useDefaultConnection: false }), { migrationProjectPath: "Data.csproj", useDefaultConnection: false, connectionMode: "custom" });
});

test("records detected versus custom connection mode without the connection value", () => {
  assert.deepEqual(sanitizeFormState({ connection: "Server=db;Password=secret", connectionName: "Development", useDefaultConnection: false }), { connectionName: "Development", useDefaultConnection: false, connectionMode: "detected" });
});

test("writes form state and workspace config to separate files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-cache-config-"));
  const cache = new WorkspaceCache(root);
  const migrationProjectPath = path.join(root, "Data", "Data.csproj");
  const startupProjectPath = path.join(root, "Web", "Web.csproj");
  try {
    await cache.saveForm({ migrationProjectPath, startupProjectPath, historyAutoCleanupEnabled: true, historyRetentionDays: "14", connection: "Password=secret", useDefaultConnection: false });
    const directory = path.join(root, ".vscode", "ef-core-commander");
    const formState = JSON.parse(await fs.readFile(path.join(directory, "form-state.json"), "utf8"));
    const config = JSON.parse(await fs.readFile(path.join(directory, "config.json"), "utf8"));
    assert.equal(formState.migrationProjectPath, "Data/Data.csproj");
    assert.equal(formState.startupProjectPath, "Web/Web.csproj");
    assert.equal(formState.historyRetentionDays, undefined);
    assert.equal(formState.connection, undefined);
    assert.equal(config.historyRetentionDays, "14");
    assert.equal(config.historyAutoCleanupEnabled, true);
    assert.equal(config.migrationProjectPath, undefined);
    assert.deepEqual(await cache.loadForm(), { migrationProjectPath, startupProjectPath, historyAutoCleanupEnabled: true, historyRetentionDays: "14", useDefaultConnection: false, connectionMode: "custom" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("migrates legacy mixed form-state to portable split files on load", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-cache-legacy-"));
  const directory = path.join(root, ".vscode", "ef-core-commander");
  const migrationProjectPath = path.join(root, "Data", "Data.csproj");
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "form-state.json"), JSON.stringify({ migrationProjectPath, noBuild: true, historyRetentionDays: "30" }, null, 2), "utf8");
    const loaded = await new WorkspaceCache(root).loadForm();
    const formState = JSON.parse(await fs.readFile(path.join(directory, "form-state.json"), "utf8"));
    const config = JSON.parse(await fs.readFile(path.join(directory, "config.json"), "utf8"));
    assert.equal(formState.migrationProjectPath, "Data/Data.csproj");
    assert.equal(formState.historyRetentionDays, undefined);
    assert.equal(config.historyRetentionDays, "30");
    assert.equal(config.migrationProjectPath, undefined);
    assert.equal(loaded.migrationProjectPath, migrationProjectPath);
    assert.equal(loaded.historyRetentionDays, "30");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("migrates mixed config paths to current workspace form state on load", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-cache-moved-"));
  const root = path.join(base, "current", "repo");
  const oldRoot = path.join(base, "previous", "repo");
  const directory = path.join(root, ".vscode", "ef-core-commander");
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "config.json"), JSON.stringify({ migrationProjectPath: path.join(oldRoot, "Data", "Data.csproj"), historyRetentionDays: "21" }, null, 2), "utf8");
    const loaded = await new WorkspaceCache(root).loadForm();
    const formState = JSON.parse(await fs.readFile(path.join(directory, "form-state.json"), "utf8"));
    const config = JSON.parse(await fs.readFile(path.join(directory, "config.json"), "utf8"));
    assert.equal(loaded.migrationProjectPath, path.join(root, "Data", "Data.csproj"));
    assert.equal(loaded.historyRetentionDays, "21");
    assert.equal(formState.migrationProjectPath, "Data/Data.csproj");
    assert.equal(config.historyRetentionDays, "21");
    assert.equal(config.migrationProjectPath, undefined);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("stores workspace model paths as relative and restores absolute runtime paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-cache-model-"));
  const cache = new WorkspaceCache(root);
  const projectPath = path.join(root, "Data", "Data.csproj");
  const projectDirectory = path.join(root, "Data");
  const model: WorkspaceModel = {
    projects: [{
      name: "Data",
      path: projectPath,
      directory: projectDirectory,
      sdk: "Microsoft.NET.Sdk",
      outputType: "Library",
      targetFrameworks: ["net9.0"],
      packageReferences: ["Microsoft.EntityFrameworkCore"],
      hasEfCoreReference: true,
      dbContexts: [{ name: "AppDbContext", fullName: "Data.AppDbContext", projectName: "Data", projectPath }],
      migrations: [{ name: "Initial", contextName: "AppDbContext", filePath: path.join(root, "Data", "Migrations", "Initial.cs") }],
      connectionStrings: [{ name: "Default", value: "Password=secret", filePath: path.join(root, "Web", "appsettings.json") }]
    }],
    migrationProjects: [],
    startupProjects: [],
    dbContexts: [{ name: "AppDbContext", fullName: "Data.AppDbContext", projectName: "Data", projectPath }]
  };
  model.migrationProjects = [model.projects[0]];
  model.startupProjects = [model.projects[0]];
  try {
    await cache.saveModel(model);
    const stored = JSON.parse(await fs.readFile(path.join(root, ".vscode", "ef-core-commander", "workspace-model.json"), "utf8")) as WorkspaceModel;
    assert.equal(stored.projects[0].path, "Data/Data.csproj");
    assert.equal(stored.projects[0].directory, "Data");
    assert.equal(stored.projects[0].dbContexts[0].projectPath, "Data/Data.csproj");
    assert.equal(stored.projects[0].migrations[0].filePath, "Data/Migrations/Initial.cs");
    assert.equal(stored.projects[0].connectionStrings[0].filePath, "Web/appsettings.json");
    assert.equal(stored.projects[0].connectionStrings[0].value, "");
    const loaded = await cache.loadModel();
    assert.equal(loaded?.projects[0].path, projectPath);
    assert.equal(loaded?.projects[0].directory, projectDirectory);
    assert.equal(loaded?.dbContexts[0].projectPath, projectPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rebases moved absolute workspace model paths to portable paths on load", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-cache-moved-model-"));
  const root = path.join(base, "current", "repo");
  const oldRoot = path.join(base, "previous", "repo");
  const directory = path.join(root, ".vscode", "ef-core-commander");
  const oldProjectPath = path.join(oldRoot, "Data", "Data.csproj");
  const currentProjectPath = path.join(root, "Data", "Data.csproj");
  const model: WorkspaceModel = {
    projects: [{
      name: "Data",
      path: oldProjectPath,
      directory: path.join(oldRoot, "Data"),
      sdk: "Microsoft.NET.Sdk",
      outputType: "Library",
      targetFrameworks: ["net9.0"],
      packageReferences: ["Microsoft.EntityFrameworkCore"],
      hasEfCoreReference: true,
      dbContexts: [{ name: "AppDbContext", fullName: "Data.AppDbContext", projectName: "Data", projectPath: oldProjectPath }],
      migrations: [{ name: "Initial", contextName: "AppDbContext", filePath: path.join(oldRoot, "Data", "Migrations", "Initial.cs") }],
      connectionStrings: [{ name: "Default", value: "", filePath: path.join(oldRoot, "Web", "appsettings.json") }]
    }],
    migrationProjects: [],
    startupProjects: [],
    dbContexts: [{ name: "AppDbContext", fullName: "Data.AppDbContext", projectName: "Data", projectPath: oldProjectPath }]
  };
  model.migrationProjects = [model.projects[0]];
  model.startupProjects = [model.projects[0]];
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "workspace-model.json"), JSON.stringify(model, null, 2), "utf8");
    const loaded = await new WorkspaceCache(root).loadModel();
    const stored = JSON.parse(await fs.readFile(path.join(directory, "workspace-model.json"), "utf8")) as WorkspaceModel;
    assert.equal(loaded?.projects[0].path, currentProjectPath);
    assert.equal(loaded?.projects[0].migrations[0].filePath, path.join(root, "Data", "Migrations", "Initial.cs"));
    assert.equal(stored.projects[0].path, "Data/Data.csproj");
    assert.equal(stored.projects[0].migrations[0].filePath, "Data/Migrations/Initial.cs");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
