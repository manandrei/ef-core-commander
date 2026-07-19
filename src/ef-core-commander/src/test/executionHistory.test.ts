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

test("clear only removes files from the dedicated history directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-core-commander-history-isolation-"));
  const cacheDirectory = path.join(root, ".vscode", "ef-core-commander");
  const store = new ExecutionHistoryStore(path.join(cacheDirectory, "history"));
  try {
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.writeFile(path.join(cacheDirectory, "form-state.json"), "{}", "utf8");
    await store.save(createExecutionSession("checkDatabaseMigrations", "Data.csproj", "AppDbContext"));
    await store.clear();
    assert.equal(await fs.readFile(path.join(cacheDirectory, "form-state.json"), "utf8"), "{}");
    assert.deepEqual(await store.list(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
