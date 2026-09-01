import * as fs from "fs";
import * as path from "path";

const EXT_ID = "local.cursor-auto-review";
const MARKER = "# managed-by:cursor-auto-review";

export type Mode = "notify" | "block";

export interface HookOptions {
  mode: Mode;
  blockTimeoutSec: number;
  blockOnTimeoutAllow: boolean;
}

function openUriSnippet(uriVar: string): string {
  return `case "$(uname -s 2>/dev/null)" in
  Darwin) open "${uriVar}" >/dev/null 2>&1 ;;
  MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "${uriVar}" >/dev/null 2>&1 ;;
  *) xdg-open "${uriVar}" >/dev/null 2>&1 ;;
esac`;
}

function hookScript(event: "pre-commit" | "pre-push", opts: HookOptions): string {
  const chain = `# Chain to a pre-existing hook of the same name, if one was here before us.
if [ -x "$(dirname "$0")/${event}.local" ]; then
  "$(dirname "$0")/${event}.local" "$@" || exit $?
fi`;

  if (opts.mode === "notify") {
    return `#!/bin/sh
${MARKER}
${chain}

URI="cursor://${EXT_ID}/review?event=${event}&mode=notify"
${openUriSnippet("$URI")}
exit 0
`;
  }

  const timeoutExit = opts.blockOnTimeoutAllow ? 0 : 1;
  return `#!/bin/sh
${MARKER}
${chain}

RESULT_FILE="$(mktemp "${"${TMPDIR:-/tmp}"}/autoreview-result.XXXXXX")"
rm -f "$RESULT_FILE"
ENC_RESULT_FILE=$(printf '%s' "$RESULT_FILE" | sed 's/ /%20/g')
URI="cursor://${EXT_ID}/review?event=${event}&mode=block&resultFile=$ENC_RESULT_FILE"
${openUriSnippet("$URI")}

echo "Auto Review: waiting for review confirmation in Cursor chat (up to ${opts.blockTimeoutSec}s)..." >&2
i=0
while [ ! -f "$RESULT_FILE" ] && [ "$i" -lt "${opts.blockTimeoutSec}" ]; do
  sleep 1
  i=$((i + 1))
done

if [ -f "$RESULT_FILE" ]; then
  CODE="$(cat "$RESULT_FILE")"
  rm -f "$RESULT_FILE"
  if [ "$CODE" = "0" ]; then
    exit 0
  fi
  echo "Auto Review: blocked (reviewer chose Block)." >&2
  exit 1
fi

echo "Auto Review: timed out waiting for confirmation, ${opts.blockOnTimeoutAllow ? "allowing" : "blocking"} by default." >&2
exit ${timeoutExit}
`;
}

function hooksDir(repoRoot: string): string {
  return path.join(repoRoot, ".git", "hooks");
}

export function installHook(repoRoot: string, event: "pre-commit" | "pre-push", opts: HookOptions): void {
  const dir = hooksDir(repoRoot);
  if (!fs.existsSync(dir)) return; // not a git repo (or worktree with external gitdir) — skip
  const target = path.join(dir, event);
  const backup = path.join(dir, `${event}.local`);

  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, "utf8");
    if (content.includes(MARKER)) {
      // already ours, just rewrite in case config changed
      fs.writeFileSync(target, hookScript(event, opts), { mode: 0o755 });
      return;
    }
    // preserve the user's existing hook so we can chain to it
    fs.copyFileSync(target, backup);
    fs.chmodSync(backup, 0o755);
  }

  fs.writeFileSync(target, hookScript(event, opts), { mode: 0o755 });
}

export function uninstallHook(repoRoot: string, event: "pre-commit" | "pre-push"): void {
  const dir = hooksDir(repoRoot);
  const target = path.join(dir, event);
  const backup = path.join(dir, `${event}.local`);

  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, "utf8");
    if (content.includes(MARKER)) {
      fs.unlinkSync(target);
    }
  }
  if (fs.existsSync(backup)) {
    fs.renameSync(backup, target);
  }
}
