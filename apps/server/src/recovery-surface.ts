import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { RecoveryLevel, RecoveryState } from "./recovery-state.js";

const MAX_LOG_LINES = 200;
const LOG_FILE_NAME = "waitron.log";

export interface RecoveryDeps {
  state: RecoveryState;
  logDir: string;
  /** Writes the reset counter and exits; Docker's restart policy performs the actual restart —
   * this route never restarts the process itself. */
  onRetry: (level: RecoveryLevel) => Promise<void>;
}

/** Escapes into HTML text/attribute content. This page is served before any authentication exists
 * and both the error code and the log tail are attacker-influenceable in principle, so every
 * interpolated value goes through this — never a raw template literal. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The last `MAX_LOG_LINES` lines of the box's own log file. Absent, unreadable, or empty is a
 * blank tail, never a throw — a box that failed before it ever wrote a log still has to serve this
 * page. */
async function tailLog(logDir: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(logDir, LOG_FILE_NAME), "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").filter((line) => line !== "");
  return lines.slice(-MAX_LOG_LINES);
}

function renderPage(state: RecoveryState, logLines: string[]): string {
  const errorCode = state.lastErrorCode === null ? "none" : escapeHtml(state.lastErrorCode);
  const failureAt = state.lastFailureAt === null ? "never" : escapeHtml(state.lastFailureAt);
  const tail =
    logLines.length === 0 ? "(no log yet)" : logLines.map((line) => escapeHtml(line)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waitron did not start</title>
</head>
<body>
<h1>Waitron did not start</h1>
<p>Level: ${escapeHtml(state.level)}. Failed ${state.failures} times.</p>
<p>Last error: ${errorCode} at ${failureAt}</p>
<h2>Log tail</h2>
<pre>${tail}</pre>
<form method="post" action="/recovery-api/retry">
<button type="submit">Retry a normal boot</button>
</form>
</body>
</html>
`;
}

/**
 * The page a headless box serves instead of trading when boot has failed past the retry threshold
 * (a later task puts this behind the box's own TLS). No safe-mode action: a degraded-but-trading
 * mode cannot be built on this codebase's module tiers (spec §9.1) — the one action is retry.
 */
export function recoveryApp(deps: RecoveryDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const logLines = await tailLog(deps.logDir);
    return c.html(renderPage(deps.state, logLines));
  });

  app.get("/recovery-api/status", (c) => c.json(deps.state));

  app.post("/recovery-api/retry", async (c) => {
    await deps.onRetry("normal");
    return c.json({ ok: true });
  });

  return app;
}
