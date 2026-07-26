import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

async function source(): Promise<string> {
  return fs.readFile(path.resolve(__dirname, "../../src/webviewProvider.ts"), "utf8");
}

async function manifest(): Promise<{ contributes: { configuration: { properties: Record<string, unknown> } } }> {
  return JSON.parse(await fs.readFile(path.resolve(__dirname, "../../package.json"), "utf8"));
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
  assert.match(value, /lastExecution: this\.activeSession \|\| this\.viewedHistorySession \|\| this\.lastExecution/);
  assert.match(value, /this\.lastExecution = session/);
  assert.match(value, /restoreExecution\(state\.lastExecution, state\.executionReturnScreen \|\| "form"\)/);
});

test("clearing history removes the restorable last execution", async () => {
  const value = await source();
  assert.match(value, /if \(message\.type === "clearHistory"\)[\s\S]*this\.lastExecution = undefined[\s\S]*this\.postState\(\)/);
});

test("restored history screen reloads history data after webview recreation", async () => {
  const value = await source();
  assert.match(value, /activeScreen: this\.activeScreen/);
  assert.match(value, /screen = state\.activeScreen \|\| "form"/);
  assert.match(value, /let screen = "form"/);
  assert.match(value, /let historyRequested = false/);
  assert.match(value, /if \(screen === "history"\) requestHistory\(\)/);
  assert.match(value, /function requestHistory\(\)[\s\S]*vscode\.postMessage\(\{ type: "history" \}\)/);
  assert.match(value, /historyRequested = false; historySessions = event\.data\.sessions/);
});

test("history entry view opens in the execution panel and closes back to history", async () => {
  const value = await source();
  assert.match(value, /private viewedHistorySession\?: ExecutionSession/);
  assert.match(value, /this\.viewedHistorySession = session;[\s\S]*this\.activeScreen = "execution";/);
  assert.match(value, /executionReturnScreen: this\.activeScreen === "execution" && this\.viewedHistorySession \? "history" : "form"/);
  assert.match(value, /lastExecution: this\.activeSession \|\| this\.viewedHistorySession \|\| this\.lastExecution/);
  assert.match(value, /let executionReturnScreen = "form"/);
  assert.match(value, /if \(event\.data\.type === "historyEntryData"\) \{ if \(event\.data\.session\) restoreExecution\(event\.data\.session, "history"\); \}/);
  assert.match(value, /document\.getElementById\("closeExecution"\)\.addEventListener\("click", \(\) => setScreen\(executionReturnScreen\)\)/);
  assert.doesNotMatch(value, /function renderHistoryEntry/);
});

test("webview screen state is runtime-only and resets to the form after restart", async () => {
  const value = await source();
  assert.match(value, /private activeScreen: WebviewScreen = "form"/);
  assert.match(value, /\| \{ type: "screenChanged"; screen: WebviewScreen \}/);
  assert.match(value, /if \(message\.type === "screenChanged"\) \{[\s\S]*this\.activeScreen = message\.screen;[\s\S]*if \(message\.screen !== "execution"\) this\.viewedHistorySession = undefined;[\s\S]*return;[\s\S]*\}/);
  assert.match(value, /vscode\.postMessage\(\{ type: "screenChanged", screen \}\)/);
  assert.match(value, /if \(this\.currentWorkspaceRoot && path\.normalize\(this\.currentWorkspaceRoot\) !== path\.normalize\(workspaceRoot\)\) \{[\s\S]*this\.activeScreen = "form";/);
  assert.doesNotMatch(value, /vscode\.getState\(/);
  assert.doesNotMatch(value, /vscode\.setState\(/);
});

test("history cleanup settings are in the extension panel and persisted with workspace config", async () => {
  const value = await source();
  assert.match(value, /id="historyAutoCleanupEnabled"[^>]*type="checkbox"[^>]*checked/);
  assert.match(value, /id="historyRetentionDays"[^>]*type="number"/);
  assert.match(value, /<h3>History settings<\/h3>[\s\S]*<h3 id="historyTitle">History<\/h3>/);
  assert.match(value, /class="history-settings"[\s\S]*id="clearHistory"/);
  assert.match(value, /\.history-retention input\s*\{[^}]*width:\s*64px/);
  assert.match(value, /historyAutoCleanupEnabled: el\.historyAutoCleanupEnabled\.checked/);
  assert.match(value, /historyRetentionDays: getHistoryRetentionDays\(\)/);
  assert.match(value, /this\.cache\?\.saveForm\(this\.persisted\)/);
});

test("automatic history cleanup runs once during initialization with a seven-day default", async () => {
  const value = await source();
  assert.match(value, /const defaultHistoryRetentionDays = 7/);
  assert.match(value, /void this\.runHistoryCleanup\(\)/);
  assert.doesNotMatch(value, /setInterval\(/);
  assert.doesNotMatch(value, /historyCleanupIntervalMs/);
  assert.doesNotMatch(value, /await this\.runHistoryCleanup\(this\.historyStore\)/);
});

test("VS Code settings expose only the runtime dotnet path dependency", async () => {
  const properties = (await manifest()).contributes.configuration.properties;
  assert.deepEqual(Object.keys(properties), ["ef-core-commander.dotnetPath"]);
  const value = await source();
  assert.doesNotMatch(value, /defaultBuildConfiguration/);
  assert.doesNotMatch(value, /useNoBuildByDefault/);
});
