import * as vscode from "vscode";
import * as fs from "fs";
import { installHook, uninstallHook, HookOptions } from "./hooks";

const log = vscode.window.createOutputChannel("Auto Review");

function cfg() {
  return vscode.workspace.getConfiguration("autoReview");
}

// Cursor's built-in "cursor-deeplink" extension routes cursor://.../prompt to
// this exact command (see deeplink.prompt.prefill in workbench.desktop.main.js).
// It's a normal VS Code command — no keystroke automation, no OS permissions.
async function triggerChatReview(): Promise<void> {
  const prompt = cfg().get<string>("reviewPrompt", "/review");
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", prompt);
    log.appendLine(`Prefilled chat with: ${prompt}`);
  } catch (err) {
    log.appendLine(`Error: ${(err as Error).message}`);
    vscode.window.showErrorMessage(`Auto Review: failed to open chat (${(err as Error).message})`);
  }
}

async function installHooksForWorkspace(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const c = cfg();
  const doPreCommit = c.get<boolean>("enablePreCommit", false);
  const doPrePush = c.get<boolean>("enablePrePush", true);
  const opts: HookOptions = {
    mode: c.get<"notify" | "block">("mode", "notify"),
    blockTimeoutSec: c.get<number>("blockTimeoutSec", 300),
    blockOnTimeoutAllow: c.get<boolean>("blockOnTimeoutAllow", true),
  };

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (doPreCommit) installHook(root, "pre-commit", opts);
    else uninstallHook(root, "pre-commit");
    if (doPrePush) installHook(root, "pre-push", opts);
    else uninstallHook(root, "pre-push");
  }
  vscode.window.showInformationMessage("Auto Review: git hooks synced with settings.");
}

async function uninstallHooksForWorkspace(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const root = folder.uri.fsPath;
    uninstallHook(root, "pre-commit");
    uninstallHook(root, "pre-push");
  }
  vscode.window.showInformationMessage("Auto Review: git hooks removed.");
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path !== "/review") return;
        const params = new URLSearchParams(uri.query);
        const event = params.get("event");
        const mode = params.get("mode");
        const c = cfg();
        if (event === "pre-commit" && !c.get<boolean>("enablePreCommit", false)) return;
        if (event === "pre-push" && !c.get<boolean>("enablePrePush", true)) return;

        void (async () => {
          await triggerChatReview();
          if (mode === "block") {
            const resultFile = params.get("resultFile");
            if (!resultFile) return;
            const choice = await vscode.window.showWarningMessage(
              `Auto Review (${event}): review the chat, then confirm.`,
              { modal: true },
              "Allow",
              "Block"
            );
            // Undefined (dialog dismissed) leaves no result file — the hook
            // falls back to its configured blockOnTimeoutAllow behavior.
            if (choice === "Allow") fs.writeFileSync(resultFile, "0");
            else if (choice === "Block") fs.writeFileSync(resultFile, "1");
          }
        })();
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoReview.installHooks", installHooksForWorkspace),
    vscode.commands.registerCommand("autoReview.uninstallHooks", uninstallHooksForWorkspace),
    vscode.commands.registerCommand("autoReview.testTrigger", async () => {
      log.show(true);
      log.appendLine("--- manual test trigger ---");
      await triggerChatReview();
    })
  );

  // Keep hooks in sync whenever the user flips the config.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("autoReview.enablePreCommit") ||
          e.affectsConfiguration("autoReview.enablePrePush") ||
          e.affectsConfiguration("autoReview.mode") ||
          e.affectsConfiguration("autoReview.blockTimeoutSec") ||
          e.affectsConfiguration("autoReview.blockOnTimeoutAllow")) {
        void installHooksForWorkspace();
      }
    })
  );

  void installHooksForWorkspace();
}

export function deactivate(): void {}
