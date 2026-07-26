import { promises as fs } from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./fileStorage";
import { fromPortablePath, toPortablePath } from "./workspaceCache";

export type ExecutionStatus = "running" | "succeeded" | "failed";
export type ExecutionLogStream = "system" | "stdout" | "stderr";

export interface ExecutionLogEntry {
  timestamp: string;
  stream: ExecutionLogStream;
  text: string;
}

export interface ExecutionSession {
  id: string;
  operation: string;
  projectPath: string;
  dbContextName: string;
  startedAt: string;
  finishedAt?: string;
  status: ExecutionStatus;
  entries: ExecutionLogEntry[];
}

export interface ExecutionSessionSummary extends Omit<ExecutionSession, "entries"> {
  fileName: string;
}

export interface HistoryCleanupResult {
  deleted: number;
  retained: number;
  failed: number;
}

export class ExecutionHistoryStore {
  private readonly legacyIndexFileName = "history-index.json";
  private readonly millisecondsPerDay = 24 * 60 * 60 * 1000;

  constructor(private readonly directory: string, private readonly workspaceRoot?: string) {}

  async save(session: ExecutionSession): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const gitIgnore = path.join(this.directory, ".gitignore");
    try {
      await fs.access(gitIgnore);
    } catch {
      await atomicWriteFile(gitIgnore, "*\n");
    }
    const fileName = this.fileName(session);
    await atomicWriteFile(path.join(this.directory, fileName), JSON.stringify(this.toPortableSession(session), null, 2));
  }

  async list(): Promise<ExecutionSessionSummary[]> {
    try {
      const files = await fs.readdir(this.directory);
      await this.migrateHistoryFiles(files);
      const sessions = await Promise.all(this.sessionFiles(files).map(async file => {
        const session = await this.read(file);
        return session && { ...withoutEntries(session), fileName: file };
      }));
      const valid = sessions.filter((session): session is ExecutionSessionSummary => Boolean(session));
      return valid.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<ExecutionSession | undefined> {
    try {
      const summary = (await this.list()).find(item => item.id === id);
      return summary ? await this.read(summary.fileName) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    const sessions = await this.list();
    const summary = sessions.find(item => item.id === id);
    if (summary) await fs.rm(path.join(this.directory, summary.fileName), { force: true });
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.directory);
      await Promise.all(files.filter(file => file.endsWith(".json")).map(file => fs.rm(path.join(this.directory, file), { force: true })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async cleanup(retentionDays: number, now = new Date()): Promise<HistoryCleanupResult> {
    await this.deleteLegacyIndex();
    const days = Math.max(1, Math.floor(retentionDays));
    const cutoff = now.getTime() - days * this.millisecondsPerDay;
    const sessions = await this.list();
    const retained: ExecutionSessionSummary[] = [];
    let deleted = 0;
    let failed = 0;

    for (const session of sessions) {
      const startedAt = Date.parse(session.startedAt);
      if (!Number.isFinite(startedAt) || startedAt >= cutoff) {
        retained.push(session);
        continue;
      }

      try {
        await fs.rm(path.join(this.directory, session.fileName), { force: true });
        deleted += 1;
      } catch {
        retained.push(session);
        failed += 1;
      }
    }

    return { deleted, retained: retained.length, failed };
  }

  private async read(fileName: string): Promise<ExecutionSession | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, fileName), "utf8")) as ExecutionSession;
      return value.id && value.entries && value.startedAt ? this.fromPortableSession(value) : undefined;
    } catch {
      return undefined;
    }
  }

  private fileName(session: ExecutionSession): string {
    return `${session.startedAt.replace(/[:.]/g, "-")}-${session.operation}-${session.id}.json`;
  }

  private async migrateHistoryFiles(files: string[]): Promise<void> {
    if (!this.workspaceRoot) return;
    await Promise.all(this.sessionFiles(files).map(async file => {
      const filePath = path.join(this.directory, file);
      try {
        const value = JSON.parse(await fs.readFile(filePath, "utf8")) as ExecutionSession;
        if (!value.id || !value.entries || !value.startedAt || typeof value.projectPath !== "string") return;
        const portable = this.toPortableSession(value);
        if (portable.projectPath !== value.projectPath) {
          await atomicWriteFile(filePath, JSON.stringify(portable, null, 2));
        }
      } catch {
        return;
      }
    }));
  }

  private sessionFiles(files: string[]): string[] {
    return files.filter(file => file.endsWith(".json") && file !== this.legacyIndexFileName);
  }

  private async deleteLegacyIndex(): Promise<void> {
    await fs.rm(path.join(this.directory, this.legacyIndexFileName), { force: true }).catch(() => undefined);
  }

  private toPortableSession(session: ExecutionSession): ExecutionSession {
    return { ...session, projectPath: toPortablePath(session.projectPath, this.workspaceRoot) };
  }

  private fromPortableSession(session: ExecutionSession): ExecutionSession {
    return { ...session, projectPath: this.workspaceRoot ? fromPortablePath(session.projectPath, this.workspaceRoot) : session.projectPath };
  }

}

export function redactSensitiveData(value: string): string {
  return value
    .replace(/(\b(?:password|pwd|clientsecret|access[_ ]?token|token|api[_ ]?key)\s*=\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^;\s"']*)/gi, "$1***")
    .replace(/\b(bearer)\s+(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s;]+)/gi, "$1 ***");
}

export function createExecutionSession(operation: string, projectPath: string, dbContextName: string): ExecutionSession {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, operation, projectPath, dbContextName, startedAt: new Date().toISOString(), status: "running", entries: [] };
}

function withoutEntries(session: ExecutionSession): Omit<ExecutionSession, "entries"> {
  const { entries: _entries, ...summary } = session;
  return summary;
}
