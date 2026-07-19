import { DatabaseMigrationSelection, DatabaseMigrationStatus } from "./types";

interface EfMigrationListItem {
  id: string;
  applied: boolean | null;
}

export function parseDatabaseMigrationStatus(
  output: string,
  selection: DatabaseMigrationSelection
): DatabaseMigrationStatus {
  let value: unknown;
  try {
    value = extractMigrationJson(output);
  } catch {
    throw new Error("The EF Core migration list did not return valid JSON.");
  }

  if (!Array.isArray(value)) {
    throw new Error("The EF Core migration list JSON must be an array.");
  }

  const migrations = value.map(parseMigration);
  if (migrations.some(migration => migration.applied === null)) {
    return { selection, state: "unknown", pending: [] };
  }

  const applied = migrations.filter(migration => migration.applied).map(migration => migration.id);
  return {
    selection,
    state: "ready",
    latestApplied: applied.at(-1),
    pending: migrations.filter(migration => !migration.applied).map(migration => migration.id)
  };
}

export function formatDatabaseMigrationSummary(status: DatabaseMigrationStatus): string {
  if (status.state === "unknown") return "EF Core could not determine which migrations are applied to this database.";
  if (status.state === "error") return status.error || "Database migration check failed.";
  const lines = [status.latestApplied ? `Latest applied: ${status.latestApplied}` : "No migrations are applied."];
  if (status.pending.length === 0) lines.push("All migrations are applied.");
  else lines.push(`Pending migrations:\n${status.pending.map(migration => `- ${migration}`).join("\n")}`);
  return lines.join("\n");
}

function extractMigrationJson(output: string): unknown[] {
  let emptyArray: unknown[] | undefined;
  for (let start = output.indexOf("["); start >= 0; start = output.indexOf("[", start + 1)) {
    const end = findArrayEnd(output, start);
    if (end < 0) {
      continue;
    }

    try {
      const value = JSON.parse(output.slice(start, end + 1));
      if (Array.isArray(value) && value.length > 0 && value.every(isMigrationListItem)) {
        return value;
      }
      if (Array.isArray(value) && value.length === 0) {
        emptyArray ??= value;
      }
    } catch {
      // The output can contain log lines starting with '[' before the JSON payload.
    }
  }

  if (emptyArray) {
    return emptyArray;
  }

  throw new Error("The EF Core migration list did not return valid JSON.");
}

function findArrayEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "[") {
      depth++;
    } else if (character === "]" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function parseMigration(value: unknown): EfMigrationListItem {
  if (!isMigrationListItem(value)) {
    throw new Error("The EF Core migration list contains an invalid migration entry.");
  }

  const migration = value as Record<string, unknown>;
  return { id: migration.id as string, applied: migration.applied as boolean | null };
}

function isMigrationListItem(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const migration = value as Record<string, unknown>;
  return typeof migration.id === "string" &&
    (migration.applied === true || migration.applied === false || migration.applied === null);
}
