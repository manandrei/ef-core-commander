import * as path from "path";
import { DbContextInfo, EfProject, MigrationInfo } from "./types";
import { normalizeMigrationName } from "./efCommandBuilder";

export function findDbContextsInSource(text: string, project: EfProject): DbContextInfo[] {
  const namespaceName = matchFirst(text, /namespace\s+([A-Za-z0-9_.]+)/);
  const contexts: DbContextInfo[] = [];
  const classRegex = /class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^)]*\))?\s*:\s*([^{\r\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(text)) !== null) {
    const baseTypes = match[2];
    if (!isDbContextBaseList(baseTypes)) {
      continue;
    }

    const name = match[1];
    contexts.push({
      name,
      fullName: namespaceName ? `${namespaceName}.${name}` : name,
      projectName: project.name,
      projectPath: project.path
    });
  }

  return contexts;
}

export function findMigrationsInSource(text: string, filePath: string): MigrationInfo[] {
  if (!text.includes("[Migration(")) {
    return [];
  }

  const contextName = matchFirst(text, /\[DbContext\(typeof\(([A-Za-z_][A-Za-z0-9_]*)\)\)\]/);
  const migrationName = matchFirst(text, /\[Migration\("([^"]+)"\)\]/) || normalizeMigrationName(path.basename(filePath));
  return [{
    name: normalizeMigrationName(migrationName),
    contextName,
    filePath
  }];
}

function isDbContextBaseList(baseTypes: string): boolean {
  if (/\bI(?:DesignTime)?DbContextFactory\s*</.test(baseTypes)) {
    return false;
  }

  return baseTypes
    .split(",")
    .map(baseType => baseType.trim())
    .some(baseType => {
      const directType = baseType.split("<", 1)[0].split("(", 1)[0].trim();
      const shortName = directType.split(".").pop() || directType;
      return shortName === "DbContext" || shortName.endsWith("DbContext");
    });
}

function matchFirst(text: string, regex: RegExp): string {
  return regex.exec(text)?.[1]?.trim() || "";
}
