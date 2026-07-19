import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

async function source(): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "../../src/webviewProvider.ts"), "utf8");
}

test("form, output and history are mutually exclusive full-panel pages", async () => {
  const value = await source();
  assert.match(value, /#form\.hidden\s*\{\s*display:\s*none/);
  assert.match(value, /\.execution-panel\.hidden,\s*\.history-panel\.hidden\s*\{\s*display:\s*none/);
  assert.match(value, /\.execution-panel,\s*\.history-panel\s*\{[^}]*flex:\s*1/);
});

test("output wrapping and completed spinner state are represented in the webview", async () => {
  const value = await source();
  assert.match(value, /id="wrapOutput"[^>]*checked/);
  assert.match(value, /state\.persisted\.wrapOutput !== false/);
  assert.match(value, /executionSpinner"\)\.classList\.add\("hidden"\)/);
});

test("last result restores the latest execution and survives webview recreation", async () => {
  const value = await source();
  assert.match(value, /id="lastResult"[^>]*disabled/);
  assert.match(value, /type: "restoreLastExecution"/);
  assert.match(value, /type: "executionRestored"/);
  assert.match(value, /vscode\.getState\(\)\?\.screen/);
  assert.match(value, /vscode\.setState\(\{ screen, wrapOutput:/);
  assert.match(value, /lastExecution: this\.activeSession \|\| this\.lastExecution/);
  assert.match(value, /this\.lastExecution = session/);
  assert.match(value, /restoreExecution\(state\.lastExecution\)/);
});

test("clearing history removes the restorable last execution", async () => {
  const value = await source();
  assert.match(value, /if \(message\.type === "clearHistory"\)[\s\S]*this\.lastExecution = undefined[\s\S]*this\.postState\(\)/);
});
