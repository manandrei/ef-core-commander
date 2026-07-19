import * as childProcess from "child_process";
import * as vscode from "vscode";
import { EfCoreWebviewProvider } from "./webviewProvider";
import { scanWorkspace } from "./workspaceScanner";
import { splitArguments } from "./processArgs";
import { ExecutionLogStream, redactSensitiveData } from "./executionHistory";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("EF Core Commander");
  const provider = new EfCoreWebviewProvider(
    context,
    output,
    scanWorkspace,
    (command, workingDirectory, onOutput) => runDotnetEfForResult(command, workingDirectory, onOutput)
  );

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider("ef-core-commander.panel", provider),
    vscode.commands.registerCommand("ef-core-commander.refreshWorkspace", () => provider.refresh()),
    vscode.commands.registerCommand("ef-core-commander.addMigration", () => provider.runOperation("addMigration")),
    vscode.commands.registerCommand("ef-core-commander.removeMigration", () => provider.runOperation("removeMigration")),
    vscode.commands.registerCommand("ef-core-commander.generateSqlScript", () => provider.runOperation("generateSqlScript")),
    vscode.commands.registerCommand("ef-core-commander.updateDatabase", () => provider.runOperation("updateDatabase")),
    vscode.commands.registerCommand("ef-core-commander.dropDatabase", () => provider.runOperation("dropDatabase"))
  );
}

export function deactivate(): void {}

async function runDotnetEfForResult(command: string, workingDirectory: string, onOutput?: (stream: ExecutionLogStream, text: string) => void): Promise<string> {
  const dotnetPath = vscode.workspace.getConfiguration("ef-core-commander").get<string>("dotnetPath", "dotnet");
  return new Promise<string>((resolve, reject) => {
    const child = childProcess.spawn(dotnetPath, splitArguments(command), {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    const pending: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
    const emitCompleteLines = (stream: "stdout" | "stderr", text: string) => {
      pending[stream] += text;
      const lastNewline = Math.max(pending[stream].lastIndexOf("\n"), pending[stream].lastIndexOf("\r"));
      if (lastNewline < 0) return;
      const complete = pending[stream].slice(0, lastNewline + 1);
      pending[stream] = pending[stream].slice(lastNewline + 1);
      onOutput?.(stream, redactSensitiveData(complete));
    };
    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      emitCompleteLines("stdout", text);
    });
    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      emitCompleteLines("stderr", text);
    });
    child.on("error", reject);
    child.on("close", code => {
      if (pending.stdout) onOutput?.("stdout", redactSensitiveData(pending.stdout));
      if (pending.stderr) onOutput?.("stderr", redactSensitiveData(pending.stderr));
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(redactSensitiveData(`dotnet ef exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`)));
      }
    });
  });
}
