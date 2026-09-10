import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ErrorCode } from "@waitron/shared";
import type { RecoveryLevel, RecoveryState } from "./recovery-state.js";

const MAX_LOG_LINES = 200;
const LOG_FILE_NAME = "waitron.log";

export interface RecoveryDeps {
  state: RecoveryState;
  logDir: string;
  /** Writes the reset counter and exits; Docker's restart policy performs the actual restart —
   * this route never restarts the process itself. Run AFTER the response has been written, not
   * before — see `outgoingOf`. */
  onRetry: (level: RecoveryLevel) => Promise<void>;
}

/** Escapes into HTML text/attribute content. This page is served before any authentication exists
 * and both the error code and the log tail are attacker-influenceable — the tail demonstrably so,
 * see `OPERATOR_TEXT` — so every interpolated value goes through this, never a raw template literal. Exported so the suite asserts
 * the page's exact rendered bytes against this rule rather than against a second copy of it. */
export function escapeHtml(value: string): string {
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

/**
 * The Node response this request will be written to. `@hono/node-server` puts it on `c.env`
 * (`{ incoming, outgoing }`); it is absent when the app is exercised through `app.request()`, which
 * has no Node response at all — hence the guard rather than a cast alone.
 *
 * It exists so the retry's process exit can wait for the `'finish'` EVENT instead of a delay: the
 * exit happens inside this handler's own request, and taking the process down before the socket has
 * flushed returns an empty body to the operator who just pressed the button.
 */
function outgoingOf(c: Context): ServerResponse | undefined {
  return (c.env as { outgoing?: ServerResponse } | undefined)?.outgoing;
}

export interface OperatorText {
  /** What is wrong, in the operator's terms. */
  title: string;
  /** What they should do about it. */
  action: string;
}

/**
 * The recovery-state marker for an attempt whose outcome is not known YET — `node-entry.ts` writes it
 * before the server starts, so a boot that HANGS (and therefore never produces a real code) still
 * leaves the page something true to say. Not an `AppError` code: nothing throws it, and it is in no
 * registry. A boot that does throw overwrites it with `classifyBootFailure`'s answer.
 *
 * It lives HERE, in the page's own module, and `node-entry.ts` imports it — not the other way round,
 * though the entrypoint is what writes it. node-entry already imports this module for `recoveryApp`,
 * so exporting it from there closes a cycle, and the cycle is not a crash but a silent wrong answer:
 * esbuild bundles the container's entry (`dist/node-entry.js`) with recovery-surface's body ahead of
 * node-entry's `var`, so the computed key below evaluated to `undefined`. Measured on that bundle —
 * `Object.keys(OPERATOR_TEXT)` printed `"undefined"` in place of `server.boot_incomplete`, while
 * every unit test passed, because vitest evaluates the two modules in the other order.
 */
export const BOOT_INCOMPLETE = "server.boot_incomplete";

/**
 * A code the recovery state can carry. `ErrorCode` is the shared registry's own union, so a typo in
 * a thrown code below is a typecheck failure rather than a page that silently renders the generic
 * line; `BOOT_INCOMPLETE` is added by hand because it is in no registry.
 */
type RecoveryCode = ErrorCode | typeof BOOT_INCOMPLETE;

/**
 * What the page says, keyed by error code.
 *
 * EVERY string here is fixed and chosen by code, and the caught error's own message and stack never
 * reach the page — a failure of the boot sequence itself sends them to the container's stdout,
 * scrubbed, which is the installer's channel (the limit is on `GENERIC_TEXT`).
 * Exactly two values on this page come from outside the image, and spec §5 names both: the error
 * CODE and the log TAIL, each HTML-escaped and each treated as attacker-influenceable.
 *
 * The TAIL is worth stating plainly, because it is a wider channel than the code. It is the server's
 * own `waitron.log`, and the shared error boundary writes an `AppError`'s params into that file
 * (`packages/server-kit/src/error-boundary.ts`), so a param CAN be read off this page by anyone on
 * the venue's LAN, with no login. What keeps that safe is not this page: it is the repo's convention
 * that an `AppError`'s params never carry a secret — the rule `apps/server/src/errors.ts` states for
 * `server.config_invalid` and its siblings. This page is why that convention matters beyond a log
 * file. Pinned by `recovery-surface.test.ts` → "the log tail as a second channel out of the image".
 *
 * The wording never suggests wiping or resetting anything: a real venue's database holds fiscal
 * records that cannot be re-created, so the action is always restore or reinstall (owner decision,
 * 2026-09-10).
 *
 * Every restore-or-reinstall action also names whoever installed the box: the reader has no
 * terminal, and often no backup and no installer either, so that person is their only real next
 * step.
 */
export const OPERATOR_TEXT: Readonly<Partial<Record<RecoveryCode, OperatorText>>> = {
  "provisioning.database_ahead": {
    title:
      "This box's database was set up by a different version of Waitron than the one installed.",
    action:
      "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
  },
  "provisioning.schema_mismatch": {
    title: "The box's database does not match the installed software.",
    action:
      "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
  },
  "provisioning.database_unreachable": {
    // Three causes wear this one code: the bounded connection wait timing out, and the SQLSTATEs
    // `28P01` (wrong password) and `3D000` (no such database) — `boot-failure.ts`. Hence "could not
    // connect" rather than "is not responding" (a refusal IS a response), and an escalation the
    // operator can walk down: the retry fixes the first cause, and only a person can fix the other
    // two, which is why the action says a restart cannot.
    title: "Waitron could not connect to the box's database.",
    action:
      "Wait a minute and press Retry — the database may still be starting up. If that does not help, restart the box. If it still fails, ask whoever installed this box to check its database settings: a restart cannot fix a wrong password or a missing database.",
  },
  "provisioning.database_not_owned": {
    title: "The box's database belongs to another program.",
    action:
      "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
  },
  "provisioning.admin_uri_not_a_url": {
    title: "The box's database address is not a valid address.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "migrations.incomplete": {
    // The one entry that deliberately does NOT offer the restore. A cold restore runs the migrations
    // itself (`restore.ts` → `applyMigrations`), so a restore is one of the things that raises this
    // code — and an operator whose backup is from the failing release point would be sent round that
    // loop with no exit and no other instruction.
    title: "The box's database was only partly updated.",
    action:
      "Ask whoever installed this box to look at it. Restoring a backup may not help: a restore runs the same update, and it can stop in the same place.",
  },
  "deployment.environment_mismatch": {
    // Configuration, not a broken database — so no restore and no reinstall: neither changes which
    // database this box points at, and a restore onto the wrong one is the worse outcome. Named
    // rather than left to the generic line because it is a CLAUDE.md §5 case: the environments do
    // not share a series, and a sale filed from the wrong one leaves a permanent hole in the other.
    title:
      "This box and its database do not belong to the same system: one is set up for real sales, the other for testing.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "server.config_missing": {
    title: "The box's configuration is incomplete.",
    action: "Ask whoever installed this box to check its settings.",
  },
  "server.config_invalid": {
    title: "The box's configuration is invalid.",
    action: "Ask whoever installed this box to check its settings.",
  },
  [BOOT_INCOMPLETE]: {
    title: "Waitron did not finish starting.",
    action: "Press Retry. If it keeps failing, ask whoever installed this box to look at it.",
  },
  "migrations.set_missing": {
    title: "The installed software is incomplete.",
    action: "Reinstall Waitron on this box.",
  },
};

/**
 * The fallback, and what `unknown` renders: the classifier could not name this one. An unrecognised
 * code renders this and never throws — a box that failed before it ever wrote a log still has to
 * serve this page.
 *
 * The action names a person rather than promising the reason is written down somewhere. `runEntry`
 * reports the scrubbed error for every failure of the BOOT SEQUENCE — but `readRecoveryState` and
 * the pre-boot counter write both run before that try/catch, and the counter write is deliberately
 * allowed to throw, so a failed state volume reaches the outer handler, which logs
 * `server.boot_failed { errorCode }` and no detail at all. Naming the person is true in every case;
 * naming the detail was not.
 */
export const GENERIC_TEXT: OperatorText = {
  title: "Waitron could not start.",
  action: "Ask whoever installed this box to look at it.",
};

/**
 * The curated text for a recorded code, or the generic line.
 *
 * `Object.hasOwn`, not a plain lookup with `??`: the code is read from a file on the box and treated
 * as attacker-influenceable, and an object literal inherits `Object.prototype`, so a code of
 * `toString` or `constructor` would find a FUNCTION — which `??` does not replace and whose `title`
 * is `undefined`, crashing the one page a failed box can still serve.
 */
function operatorText(lastErrorCode: string | null): OperatorText {
  if (lastErrorCode === null) return GENERIC_TEXT;
  if (!Object.hasOwn(OPERATOR_TEXT, lastErrorCode)) return GENERIC_TEXT;
  const entries: Readonly<Record<string, OperatorText | undefined>> = OPERATOR_TEXT;
  return entries[lastErrorCode] ?? GENERIC_TEXT;
}

function renderPage(state: RecoveryState, logLines: string[]): string {
  const errorCode = state.lastErrorCode === null ? "none" : escapeHtml(state.lastErrorCode);
  const failureAt = state.lastFailureAt === null ? "never" : escapeHtml(state.lastFailureAt);
  const text = operatorText(state.lastErrorCode);
  const tail =
    logLines.length === 0 ? "(no log yet)" : logLines.map((line) => escapeHtml(line)).join("\n");
  // The curated strings go through `escapeHtml` too. They are fixed and safe, but routing every
  // interpolation through the one escape keeps "never a raw template literal" true without an
  // exception a reader has to check. The retry form sits ABOVE the installer detail: the operator's
  // action is the point of the page, and the block below it is for someone else.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waitron did not start</title>
</head>
<body>
<h1>Waitron did not start</h1>
<p>${escapeHtml(text.title)}</p>
<p>${escapeHtml(text.action)}</p>
<form method="post" action="/recovery-api/retry">
<button type="submit">Retry a normal boot</button>
</form>
<h2>For whoever installed this box</h2>
<p>Level: ${escapeHtml(state.level)}. Failed ${state.failures} times.</p>
<p>Last error: ${errorCode} at ${failureAt}</p>
<h2>Log tail</h2>
<pre>${tail}</pre>
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

  app.post("/recovery-api/retry", (c) => {
    const outgoing = outgoingOf(c);
    if (outgoing === undefined) {
      // No Node response to wait on (`app.request()`): nothing can be racing the flush either.
      void deps.onRetry("normal");
    } else {
      outgoing.once("finish", () => void deps.onRetry("normal"));
    }
    return c.json({ ok: true });
  });

  return app;
}
