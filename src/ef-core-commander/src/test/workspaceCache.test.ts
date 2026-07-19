import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFormState } from "../workspaceCache";

test("does not persist custom connection values", () => {
  assert.deepEqual(sanitizeFormState({ migrationProjectPath: "Data.csproj", connection: "Password=secret", connectionCustom: "Password=secret", useDefaultConnection: false }), { migrationProjectPath: "Data.csproj", useDefaultConnection: false, connectionMode: "custom" });
});

test("records detected versus custom connection mode without the connection value", () => {
  assert.deepEqual(sanitizeFormState({ connection: "Server=db;Password=secret", connectionName: "Development", useDefaultConnection: false }), { connectionName: "Development", useDefaultConnection: false, connectionMode: "detected" });
});
