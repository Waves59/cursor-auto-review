import * as vscode from "vscode";
import * as fs from "fs";
import { keyboard, Key, getWindows } from "@nut-tree-fork/nut-js";
import { installHook, uninstallHook, HookOptions } from "./hooks";

function cfg() {
  return vscode.workspace.getConfiguration("autoReview");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function focusCursorWindow(): Promise<boolean> {
  const windows = await getWindows();
  for (const w of windows) {
    const title = await w.getTitle();
    if (title.includes("Cursor")) {
      await w.focus();
      return true;
    }
  }
  return false;
}

// ponytail: keystroke automation via nut-js, no public Cursor chat API exists
// on any platform. Breaks if Cursor changes its chat shortcut or window
// model. Swap for a real extension API the day Cursor ships one.
async function triggerChatReview(): Promise<void> {
  const prompt = cfg().get<string>("reviewPrompt", "/review");
  const shortcutKey = cfg().get<string>("chatShortcut", "l").toUpperCase();
  const delayMs = cfg().get<number>("activationDelayMs", 600);
  const modifier = process.platform === "darwin" ? Key.LeftCmd : Key.LeftControl;
  const letterKey = (Key as unknown as Record<string, Key>)[shortcutKey];

  try {
    const focused = await focusCursorWindow();
    if (!focused) {
      vscode.window.showWarningMessage("Auto Review: Cursor window not found, sending keys anyway.");
    }
    await sleep(delayMs);
    if (letterKey !== undefined) {
      await keyboard.pressKey(modifier, letterKey);
      await keyboard.releaseKey(modifier, letterKey);
    }
    await sleep(150);
    await keyboard.type(prompt);
    await sleep(100);
    await keyboard.type(Key.Return);
  } catch (err) {
    vscode.window.showErrorMessage(`Auto Review: failed to trigger chat (${(err as Error).message})`);
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
    vscode.commands.registerCommand("autoReview.uninstallHooks", uninstallHooksForWorkspace)
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
