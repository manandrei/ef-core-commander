import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { ConnectionStringInfo, EfProject, WorkspaceModel } from "./types";
import { findDbContextsInSource, findMigrationsInSource } from "./sourceParser";

const excludedFolders = "{**/bin/**,**/obj/**,**/node_modules/**,**/.git/**}";

export async function scanWorkspace(): Promise<WorkspaceModel> {
  const projectUris = await vscode.workspace.findFiles("**/*.csproj", excludedFolders);
  const projects = await Promise.all(projectUris.map(uri => readProject(uri.fsPath)));
  const sortedProjects = projects.sort((left, right) => right.directory.length - left.directory.length);

  const sourceUris = await vscode.workspace.findFiles("**/*.cs", excludedFolders);
  const sourceFiles = await Promise.all(sourceUris.map(async uri => ({
    path: uri.fsPath,
    text: await readText(uri.fsPath)
  })));

  const jsonUris = await vscode.workspace.findFiles("**/appsettings*.json", excludedFolders);
  const jsonFiles = await Promise.all(jsonUris.map(async uri => ({
    path: uri.fsPath,
    text: await readText(uri.fsPath)
  })));

  for (const file of sourceFiles) {
    const project = findOwningProject(file.path, sortedProjects);
    if (!project) {
      continue;
    }

    project.dbContexts.push(...findDbContextsInSource(file.text, project));
    project.migrations.push(...findMigrationsInSource(file.text, file.path));
  }

  for (const file of jsonFiles) {
    const project = findOwningProject(file.path, sortedProjects);
    if (project) {
      project.connectionStrings.push(...findConnectionStrings(file.text, file.path));
    }
  }

  const allDbContexts = projects.flatMap(project => project.dbContexts);
  const migrationProjects = projects.filter(project =>
    project.hasEfCoreReference || project.dbContexts.length > 0 || project.migrations.length > 0);
  const startupProjects = projects.filter(isRunnableProject);

  return {
    projects: projects.sort((left, right) => left.name.localeCompare(right.name)),
    migrationProjects: migrationProjects.sort((left, right) => left.name.localeCompare(right.name)),
    startupProjects: startupProjects.sort((left, right) => left.name.localeCompare(right.name)),
    dbContexts: allDbContexts.sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function readProject(projectPath: string): Promise<EfProject> {
  const xml = await readText(projectPath);
  const sdk = matchFirst(xml, /<Project\s+Sdk="([^"]+)"/i);
  const targetFrameworks = readTargetFrameworks(xml);
  const packageReferences = Array.from(xml.matchAll(/<PackageReference\b[^>]*Include="([^"]+)"/gi))
    .map(match => match[1]);

  return {
    name: path.basename(projectPath, ".csproj"),
    path: projectPath,
    directory: path.dirname(projectPath),
    sdk,
    outputType: matchFirst(xml, /<OutputType>([^<]+)<\/OutputType>/i),
    targetFrameworks,
    packageReferences,
    hasEfCoreReference: packageReferences.some(reference => reference.startsWith("Microsoft.EntityFrameworkCore")),
    dbContexts: [],
    migrations: [],
    connectionStrings: []
  };
}

function readTargetFrameworks(xml: string): string[] {
  const single = matchFirst(xml, /<TargetFramework>([^<]+)<\/TargetFramework>/i);
  const multiple = matchFirst(xml, /<TargetFrameworks>([^<]+)<\/TargetFrameworks>/i);
  return (multiple || single)
    .split(";")
    .map(value => value.trim())
    .filter(Boolean);
}

function findConnectionStrings(text: string, filePath: string): ConnectionStringInfo[] {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const section = parsed.ConnectionStrings;
    if (!section || typeof section !== "object") {
      return [];
    }

    return Object.entries(section as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, value]) => ({ name, value, filePath }));
  } catch {
    return [];
  }
}

function findOwningProject(filePath: string, projects: EfProject[]): EfProject | undefined {
  const normalized = normalizePath(filePath);
  return projects.find(project => normalized.startsWith(normalizePath(project.directory) + "/"));
}

function isRunnableProject(project: EfProject): boolean {
  const outputType = project.outputType.toLowerCase();
  return project.sdk.includes("Microsoft.NET.Sdk.Web")
    || outputType === "exe"
    || outputType === "winexe";
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function matchFirst(text: string, regex: RegExp): string {
  return regex.exec(text)?.[1]?.trim() || "";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}
