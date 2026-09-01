"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const nut_js_1 = require("@nut-tree-fork/nut-js");
const hooks_1 = require("./hooks");
function cfg() {
    return vscode.workspace.getConfiguration("autoReview");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function focusCursorWindow() {
    const windows = await (0, nut_js_1.getWindows)();
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
async function triggerChatReview() {
    const prompt = cfg().get("reviewPrompt", "/review");
    const shortcutKey = cfg().get("chatShortcut", "l").toUpperCase();
    const delayMs = cfg().get("activationDelayMs", 600);
    const modifier = process.platform === "darwin" ? nut_js_1.Key.LeftCmd : nut_js_1.Key.LeftControl;
    const letterKey = nut_js_1.Key[shortcutKey];
    try {
        const focused = await focusCursorWindow();
        if (!focused) {
            vscode.window.showWarningMessage("Auto Review: Cursor window not found, sending keys anyway.");
        }
        await sleep(delayMs);
        if (letterKey !== undefined) {
            await nut_js_1.keyboard.pressKey(modifier, letterKey);
            await nut_js_1.keyboard.releaseKey(modifier, letterKey);
        }
        await sleep(150);
        await nut_js_1.keyboard.type(prompt);
        await sleep(100);
        await nut_js_1.keyboard.type(nut_js_1.Key.Return);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Auto Review: failed to trigger chat (${err.message})`);
    }
}
async function installHooksForWorkspace() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const c = cfg();
    const doPreCommit = c.get("enablePreCommit", false);
    const doPrePush = c.get("enablePrePush", true);
    const opts = {
        mode: c.get("mode", "notify"),
        blockTimeoutSec: c.get("blockTimeoutSec", 300),
        blockOnTimeoutAllow: c.get("blockOnTimeoutAllow", true),
    };
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        if (doPreCommit)
            (0, hooks_1.installHook)(root, "pre-commit", opts);
        else
            (0, hooks_1.uninstallHook)(root, "pre-commit");
        if (doPrePush)
            (0, hooks_1.installHook)(root, "pre-push", opts);
        else
            (0, hooks_1.uninstallHook)(root, "pre-push");
    }
    vscode.window.showInformationMessage("Auto Review: git hooks synced with settings.");
}
async function uninstallHooksForWorkspace() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        (0, hooks_1.uninstallHook)(root, "pre-commit");
        (0, hooks_1.uninstallHook)(root, "pre-push");
    }
    vscode.window.showInformationMessage("Auto Review: git hooks removed.");
}
function activate(context) {
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri(uri) {
            if (uri.path !== "/review")
                return;
            const params = new URLSearchParams(uri.query);
            const event = params.get("event");
            const mode = params.get("mode");
            const c = cfg();
            if (event === "pre-commit" && !c.get("enablePreCommit", false))
                return;
            if (event === "pre-push" && !c.get("enablePrePush", true))
                return;
            void (async () => {
                await triggerChatReview();
                if (mode === "block") {
                    const resultFile = params.get("resultFile");
                    if (!resultFile)
                        return;
                    const choice = await vscode.window.showWarningMessage(`Auto Review (${event}): review the chat, then confirm.`, { modal: true }, "Allow", "Block");
                    // Undefined (dialog dismissed) leaves no result file — the hook
                    // falls back to its configured blockOnTimeoutAllow behavior.
                    if (choice === "Allow")
                        fs.writeFileSync(resultFile, "0");
                    else if (choice === "Block")
                        fs.writeFileSync(resultFile, "1");
                }
            })();
        },
    }));
    context.subscriptions.push(vscode.commands.registerCommand("autoReview.installHooks", installHooksForWorkspace), vscode.commands.registerCommand("autoReview.uninstallHooks", uninstallHooksForWorkspace));
    // Keep hooks in sync whenever the user flips the config.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("autoReview.enablePreCommit") ||
            e.affectsConfiguration("autoReview.enablePrePush") ||
            e.affectsConfiguration("autoReview.mode") ||
            e.affectsConfiguration("autoReview.blockTimeoutSec") ||
            e.affectsConfiguration("autoReview.blockOnTimeoutAllow")) {
            void installHooksForWorkspace();
        }
    }));
    void installHooksForWorkspace();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map