import { promises as fs } from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./fileStorage";

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

export class ExecutionHistoryStore {
  private readonly indexFileName = "history-index.json";

  constructor(private readonly directory: string) {}

  async save(session: ExecutionSession): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const gitIgnore = path.join(this.directory, ".gitignore");
    try {
      await fs.access(gitIgnore);
    } catch {
      await atomicWriteFile(gitIgnore, "*\n");
    }
    const fileName = this.fileName(session);
    await atomicWriteFile(path.join(this.directory, fileName), JSON.stringify(session, null, 2));
    const sessions = (await this.loadIndex()).filter(item => item.id !== session.id);
    sessions.push({ ...withoutEntries(session), fileName });
    await this.saveIndex(sessions);
  }

  async list(): Promise<ExecutionSessionSummary[]> {
    try {
      const indexed = await this.loadIndex();
      if (indexed.length > 0) return indexed.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      const files = await fs.readdir(this.directory);
      const sessions = await Promise.all(files.filter(file => file.endsWith(".json") && file !== this.indexFileName).map(async file => {
        const session = await this.read(file);
        return session && { ...withoutEntries(session), fileName: file };
      }));
      const valid = sessions.filter((session): session is ExecutionSessionSummary => Boolean(session));
      if (valid.length > 0) await this.saveIndex(valid);
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
    await this.saveIndex(sessions.filter(item => item.id !== id));
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.directory);
      await Promise.all(files.filter(file => file.endsWith(".json")).map(file => fs.rm(path.join(this.directory, file), { force: true })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async read(fileName: string): Promise<ExecutionSession | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, fileName), "utf8")) as ExecutionSession;
      return value.id && value.entries && value.startedAt ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private fileName(session: ExecutionSession): string {
    return `${session.startedAt.replace(/[:.]/g, "-")}-${session.operation}-${session.id}.json`;
  }

  private async loadIndex(): Promise<ExecutionSessionSummary[]> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, this.indexFileName), "utf8"));
      return Array.isArray(value) ? value.filter(item => item?.id && item?.fileName && item?.startedAt) : [];
    } catch {
      return [];
    }
  }

  private async saveIndex(sessions: ExecutionSessionSummary[]): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    await atomicWriteFile(path.join(this.directory, this.indexFileName), JSON.stringify(sessions, null, 2));
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
