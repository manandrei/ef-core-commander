import { CommandOptions } from "./types";

export function normalizeMigrationName(migrationName: string | undefined): string {
  if (!migrationName || migrationName.trim().length === 0) {
    return "";
  }

  const normalized = migrationName.trim();
  if (normalized.toLowerCase().endsWith(".designer.cs")) {
    return normalized.slice(0, -".Designer.cs".length);
  }

  if (normalized.toLowerCase().endsWith(".cs")) {
    return normalized.slice(0, -".cs".length);
  }

  return normalized;
}

export function buildTargetMigrationItems(migrations: string[]): string[] {
  return Array.from(new Set([...migrations, "0"])).sort((left, right) => right.localeCompare(left));
}

export function buildEfCommand(options: CommandOptions): string {
  const parts: string[] = ["ef"];

  switch (options.operation) {
    case "addMigration":
      parts.push("migrations", "add");
      addCommonOptions(parts, options);
      parts.push(sanitizeMigrationName(options.migrationName || "Initial"));
      parts.push("--output-dir", quote(options.outputDir || "Migrations"));
      break;
    case "removeMigration":
      parts.push("migrations", "remove");
      addCommonOptions(parts, options);
      parts.push("--force");
      break;
    case "generateSqlScript":
      parts.push("migrations", "script");
      addCommonOptions(parts, options);
      pushIfPresent(parts, normalizeMigrationName(options.fromMigration));
      pushIfPresent(parts, normalizeMigrationName(options.toMigration));
      if (options.scriptOutput) {
        parts.push("--output", quote(options.scriptOutput));
      }
      if (options.idempotent) {
        parts.push("--idempotent");
      }
      if (options.noTransactions) {
        parts.push("--no-transactions");
      }
      break;
    case "updateDatabase":
      parts.push("database", "update");
      addCommonOptions(parts, options);
      pushIfPresent(parts, normalizeMigrationName(options.toMigration));
      if (!options.useDefaultConnection && options.connection) {
        parts.push("--connection", quote(options.connection));
      }
      break;
    case "dropDatabase":
      parts.push("database", "drop");
      addCommonOptions(parts, options);
      parts.push("--force");
      break;
  }

  if (options.additionalArgs && options.additionalArgs.trim()) {
    parts.push(options.additionalArgs.trim());
  }

  return parts.join(" ").trim();
}

export function buildMigrationListCommand(options: CommandOptions): string {
  const parts: string[] = ["ef", "migrations", "list"];
  addCommonOptions(parts, options);
  if (!options.useDefaultConnection && options.connection) {
    parts.push("--connection", quote(options.connection));
  }
  parts.push("--json", "--no-color");
  return parts.join(" ");
}

function addCommonOptions(parts: string[], options: CommandOptions): void {
  parts.push("--project", quote(options.migrationProjectPath));
  if (options.creationMethod === "StartupProject" && options.startupProjectPath) {
    parts.push("--startup-project", quote(options.startupProjectPath));
  }
  parts.push("--context", options.dbContextName);
  parts.push("--configuration", options.buildConfiguration || "Debug");
  if (options.noBuild) {
    parts.push("--no-build");
  }
  if (options.targetFramework && options.targetFramework !== "<Default>") {
    parts.push("--framework", options.targetFramework);
  }
}

function sanitizeMigrationName(name: string): string {
  return name.replace(/\s+/g, "_").trim();
}

function pushIfPresent(parts: string[], value: string): void {
  if (value) {
    parts.push(value);
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
