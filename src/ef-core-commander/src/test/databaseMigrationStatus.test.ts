import test from "node:test";
import assert from "node:assert/strict";
import { formatDatabaseMigrationSummary, parseDatabaseMigrationStatus } from "../databaseMigrationStatus";
import { DatabaseMigrationSelection } from "../types";

const selection: DatabaseMigrationSelection = {
  migrationProjectPath: "Data.csproj",
  startupProjectPath: "Web.csproj",
  dbContextName: "AppDbContext",
  buildConfiguration: "Debug",
  noBuild: false,
  creationMethod: "StartupProject",
  useDefaultConnection: true
};

test("returns the latest applied migration and pending migrations", () => {
  const status = parseDatabaseMigrationStatus(JSON.stringify([
    { id: "20240101_Initial", applied: true },
    { id: "20240201_AddOrders", applied: true },
    { id: "20240301_AddInvoices", applied: false }
  ]), selection);

  assert.equal(status.state, "ready");
  assert.equal(status.latestApplied, "20240201_AddOrders");
  assert.deepEqual(status.pending, ["20240301_AddInvoices"]);
});

test("formats a check result for the execution output", () => {
  const status = parseDatabaseMigrationStatus('[{"id":"202401_Initial","applied":true},{"id":"202402_AddOrders","applied":false}]', selection);
  assert.equal(formatDatabaseMigrationSummary(status), "Latest applied: 202401_Initial\nPending migrations:\n- 202402_AddOrders");
});

test("extracts the migration JSON after EF Core build and application logs", () => {
  const status = parseDatabaseMigrationStatus(`Build started...
Build succeeded.
[22:03:01 INF] Executed DbCommand [Parameters=[]]
[
  { "id": "20240101_Initial", "applied": true },
  { "id": "20240201_AddOrders", "applied": false }
]`, selection);

  assert.equal(status.state, "ready");
  assert.equal(status.latestApplied, "20240101_Initial");
  assert.deepEqual(status.pending, ["20240201_AddOrders"]);
});

test("handles a database with no applied migrations", () => {
  const status = parseDatabaseMigrationStatus(JSON.stringify([
    { id: "20240101_Initial", applied: false }
  ]), selection);

  assert.equal(status.state, "ready");
  assert.equal(status.latestApplied, undefined);
  assert.deepEqual(status.pending, ["20240101_Initial"]);
});

test("handles a database where all migrations are applied", () => {
  const status = parseDatabaseMigrationStatus(JSON.stringify([
    { id: "20240101_Initial", applied: true },
    { id: "20240201_AddOrders", applied: true }
  ]), selection);

  assert.equal(status.state, "ready");
  assert.equal(status.latestApplied, "20240201_AddOrders");
  assert.deepEqual(status.pending, []);
});

test("keeps the status unknown when EF Core cannot determine application state", () => {
  const status = parseDatabaseMigrationStatus(JSON.stringify([
    { id: "20240101_Initial", applied: null }
  ]), selection);

  assert.equal(status.state, "unknown");
  assert.deepEqual(status.pending, []);
});

test("rejects invalid JSON", () => {
  assert.throws(() => parseDatabaseMigrationStatus("not json", selection), /valid JSON/);
});
