import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExecutionSession, ExecutionHistoryStore, redactSensitiveData } from "../executionHistory";

test("redacts connection-string secrets", () => {
  const safe = redactSensitiveData("dotnet ef database update --connection \"Server=db;User Id=app;Password=secret;Token=abc\"");
  assert.equal(safe, "dotnet ef database update --connection \"Server=db;User Id=app;Password=***;Token=***\"");
});

test("redacts quoted secrets containing spaces", () => {
  assert.equal(
    redactSensitiveData("Password='secret value'; Token=\"abc def\"; ApiKey='key value'; Bearer 'token value'"),
    "Password=***; Token=***; ApiKey=***; Bearer ***"
  );
});

test("creates ignored local history, lists it, and deletes it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-"));
  const store = new ExecutionHistoryStore(path.join(root, ".vscode", "ef-core-commander"));
  const session = createExecutionSession("updateDatabase", "Data.csproj", "AppDbContext");
  session.status = "succeeded";
  session.finishedAt = new Date().toISOString();
  session.entries.push({ timestamp: session.startedAt, stream: "stdout", text: "Done" });
  try {
    await store.save(session);
    assert.equal(await fs.readFile(path.join(root, ".vscode", "ef-core-commander", ".gitignore"), "utf8"), "*\n");
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.get(session.id))?.entries[0].text, "Done");
    await store.delete(session.id);
    assert.equal((await store.list()).length, 0);
    await store.clear();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cleanup deletes expired history files and keeps recent sessions listed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-cleanup-"));
  const store = new ExecutionHistoryStore(path.join(root, ".vscode", "ef-core-commander", "history"));
  const oldSession = createExecutionSession("updateDatabase", "Data.csproj", "AppDbContext");
  oldSession.startedAt = "2026-07-10T00:00:00.000Z";
  oldSession.finishedAt = "2026-07-10T00:00:10.000Z";
  const recentSession = createExecutionSession("generateSqlScript", "Data.csproj", "AppDbContext");
  recentSession.startedAt = "2026-07-25T00:00:00.000Z";
  recentSession.finishedAt = "2026-07-25T00:00:10.000Z";
  try {
    await store.save(oldSession);
    await store.save(recentSession);
    const oldFileName = (await fs.readdir(path.join(root, ".vscode", "ef-core-commander", "history"))).find(file => file.includes(oldSession.id));
    const result = await store.cleanup(7, new Date("2026-07-26T00:00:00.000Z"));
    assert.deepEqual(result, { deleted: 1, retained: 1, failed: 0 });
    assert.ok(oldFileName);
    await assert.rejects(fs.access(path.join(root, ".vscode", "ef-core-commander", "history", oldFileName)));
    assert.equal(await store.get(oldSession.id), undefined);
    assert.deepEqual((await store.list()).map(item => item.id), [recentSession.id]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cleanup ignores missing expired files without stale metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-missing-"));
  const directory = path.join(root, ".vscode", "ef-core-commander", "history");
  const store = new ExecutionHistoryStore(directory);
  const session = createExecutionSession("checkDatabaseMigrations", "Data.csproj", "AppDbContext");
  session.startedAt = "2026-07-10T00:00:00.000Z";
  try {
    await store.save(session);
    const fileName = (await store.list())[0].fileName;
    await fs.rm(path.join(directory, fileName), { force: true });
    assert.deepEqual(await store.cleanup(7, new Date("2026-07-26T00:00:00.000Z")), { deleted: 0, retained: 0, failed: 0 });
    assert.deepEqual(await store.list(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("stores history project paths as relative and returns absolute runtime paths without an index", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-portable-"));
  const directory = path.join(root, ".vscode", "ef-core-commander", "history");
  const store = new ExecutionHistoryStore(directory, root);
  const projectPath = path.join(root, "Data", "Data.csproj");
  const session = createExecutionSession("updateDatabase", projectPath, "AppDbContext");
  try {
    await store.save(session);
    const directoryFiles = await fs.readdir(directory);
    assert.equal(directoryFiles.includes("history-index.json"), false);
    const files = directoryFiles.filter(file => file.endsWith(".json"));
    const storedSession = JSON.parse(await fs.readFile(path.join(directory, files[0]), "utf8"));
    assert.equal(storedSession.projectPath, "Data/Data.csproj");
    assert.equal((await store.list())[0].projectPath, projectPath);
    assert.equal((await store.get(session.id))?.projectPath, projectPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("migrates legacy absolute history paths when listed and ignores legacy index", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-migrate-"));
  const root = path.join(base, "current", "repo");
  const oldRoot = path.join(base, "previous", "repo");
  const directory = path.join(root, ".vscode", "ef-core-commander", "history");
  const store = new ExecutionHistoryStore(directory, root);
  const session = createExecutionSession("checkDatabaseMigrations", path.join(oldRoot, "Data", "Data.csproj"), "AppDbContext");
  const currentProjectPath = path.join(root, "Data", "Data.csproj");
  const fileName = "legacy.json";
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, fileName), JSON.stringify(session, null, 2), "utf8");
    await fs.writeFile(path.join(directory, "history-index.json"), JSON.stringify([{ ...session, fileName }], null, 2), "utf8");
    assert.equal((await store.list())[0].projectPath, currentProjectPath);
    const storedSession = JSON.parse(await fs.readFile(path.join(directory, fileName), "utf8"));
    assert.equal(storedSession.projectPath, "Data/Data.csproj");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("cleanup deletes a legacy history index file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-legacy-index-"));
  const directory = path.join(root, ".vscode", "ef-core-commander", "history");
  const store = new ExecutionHistoryStore(directory, root);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "history-index.json"), "[]", "utf8");
    await store.cleanup(7, new Date("2026-07-26T00:00:00.000Z"));
    await assert.rejects(fs.access(path.join(directory, "history-index.json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("clear only removes files from the dedicated history directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-isolation-"));
  const cacheDirectory = path.join(root, ".vscode", "ef-core-commander");
  const store = new ExecutionHistoryStore(path.join(cacheDirectory, "history"));
  try {
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.writeFile(path.join(cacheDirectory, "config.json"), "{}", "utf8");
    await store.save(createExecutionSession("checkDatabaseMigrations", "Data.csproj", "AppDbContext"));
    await store.clear();
    assert.equal(await fs.readFile(path.join(cacheDirectory, "config.json"), "utf8"), "{}");
    assert.deepEqual(await store.list(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
