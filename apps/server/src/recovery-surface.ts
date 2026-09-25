import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ErrorCode } from "@waitron/shared";
import { LOG_FILE_NAME, type VenueHolderKind } from "@waitron/db";
import type { RecoveryLevel, RecoveryState } from "./recovery-state.js";

const MAX_LOG_LINES = 200;

export interface RecoveryDeps {
  state: RecoveryState;
  logDir: string;
  /** Called only after the response has been written — see `outgoingOf`. */
  onRetry: (level: RecoveryLevel) => Promise<void>;
}

/** The page is served before any authentication exists; see `OPERATOR_TEXT` for what reaches it. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Never throws: a box that failed before it ever wrote a log still has to serve this page. */
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
 * So the retry's process exit can wait for `'finish'`: exiting before the socket has flushed
 * returns an empty body to the operator who pressed the button. Absent under `app.request()`.
 */
function outgoingOf(c: Context): ServerResponse | undefined {
  return (c.env as { outgoing?: ServerResponse } | undefined)?.outgoing;
}

export interface OperatorText {
  /** What is wrong, in the operator's terms. */
  title: string;
  /** What they should do about it. */
  action: string;
  /** The same two, in Spanish. Only `HOLDER_STALLED`'s text has them. */
  es?: { title: string; action: string };
}

/** Each kind's name on the page. `script` and an unknown holder share the last row. */
const HOLDER_NAMES: Readonly<Record<VenueHolderKind, { en: string; es: string }>> = {
  server: { en: "the Waitron server", es: "el servidor de Waitron" },
  restore: {
    en: "a restore from a backup",
    es: "una restauración desde una copia de seguridad",
  },
  rejoin: {
    en: "a rejoin of this box to its venue",
    es: "la reincorporación de este equipo a su local",
  },
  provisioning: {
    en: "the Waitron setup command",
    es: "el comando de configuración de Waitron",
  },
  script: { en: "another Waitron program", es: "otro programa de Waitron" },
};

/**
 * "Two minutes" is the holder's watchdog bound (`WATCHDOG_KILL_MS`,
 * `packages/store/src/venue-liveness.ts`).
 */
function holderStalledText(kind: VenueHolderKind | undefined): OperatorText {
  const name = HOLDER_NAMES[kind ?? "script"];
  return {
    title: `The box's database is held by ${name.en}, which appears to have stopped responding.`,
    action:
      "Wait two minutes, then press Retry: Waitron normally ends a program of its own that stops responding within that time. If it fails again, ask whoever installed this box to look at it.",
    es: {
      title: `La base de datos de este equipo está ocupada por ${name.es}, que parece haber dejado de responder.`,
      action:
        "Espera dos minutos y pulsa «Retry a normal boot»: Waitron normalmente cierra en ese tiempo un programa propio que deja de responder. Si vuelve a fallar, pide ayuda a quien instaló este equipo.",
    },
  };
}

/**
 * Recorded before the server starts, so a boot that hangs still leaves the page something true to
 * say. Not an `AppError` code: nothing throws it.
 *
 * It lives here, not in `node-entry.ts` which writes it: exported from there it closes an import
 * cycle, and in the esbuild bundle the computed key below then evaluates to `undefined`.
 */
export const BOOT_INCOMPLETE = "server.boot_incomplete";

/** Like `BOOT_INCOMPLETE`: nothing throws it, and it lives here for the same reason. */
export const HOLDER_STALLED = "provisioning.database_holder_stalled";

/** Typed so a misspelled code below fails the typecheck rather than rendering the generic line. */
type RecoveryCode = ErrorCode | typeof BOOT_INCOMPLETE | typeof HOLDER_STALLED;

/**
 * Every string in this table is fixed and chosen by code. Three strings on the page are not — the
 * error code, the log tail and `lastFailureAt` — and all three are HTML-escaped; `failures` is
 * interpolated raw because `readRecoveryState` only keeps a number.
 *
 * The tail can carry a caught error's own words. What bounds it is not this page: the file sink,
 * which masks passwords in a URL (`log-file.ts` → `redactSecrets`) and nothing else, and the
 * convention that an `AppError`'s params never carry a secret (`apps/server/src/errors.ts`),
 * because the error boundary logs them.
 *
 * The wording never suggests wiping or resetting anything: a real venue's database holds fiscal
 * records that cannot be re-created, so the action is always restore or reinstall (owner decision,
 * 2026-09-10). Each such action names whoever installed the box: the reader has no terminal.
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
    // The engine could not open the file (`boot-failure.ts`, SQLITE_CANTOPEN).
    title: "Waitron could not open the box's database.",
    action:
      "Press Retry. If it fails again, restart the box — that can fix a disk or a volume that did not come up. If it still fails, ask whoever installed this box for help: the box's database is a file on its disk, and the software cannot read it.",
  },
  "migrations.incomplete": {
    // Deliberately no restore: a restore runs the migrations itself, so it can raise this code.
    title: "The box's database was only partly updated.",
    action:
      "Ask whoever installed this box to look at it. Restoring a backup may not help: a restore runs the same update, and it can stop in the same place.",
  },
  "deployment.environment_mismatch": {
    // No restore and no reinstall: neither changes which database this box points at. The
    // environments must never share an invoice series (CLAUDE.md §5).
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
  "restore.placement_failed": {
    // Which database was kept is in the params, which reach the installer's channel
    // (`node-entry.ts` → `failureDetail`) and not this page.
    title: "A restore could not put the restored database in place.",
    action:
      "Ask whoever installed this box to look at it before anything else. The server's own output says whether the box's previous database is unchanged or was left in a folder inside its venue folder, which must be moved back before the box is used.",
  },
  "migrations.set_missing": {
    title: "The installed software is incomplete.",
    action: "Reinstall Waitron on this box.",
  },
  // The holder's own name, when `recovery.json` recorded one, replaces this row's in `operatorText`.
  [HOLDER_STALLED]: holderStalledText(undefined),
};

/**
 * Names a person rather than promising the reason is written down: a failure reading or counting
 * the recovery state reaches `node-entry.ts`'s outer handler, which logs its code and no detail.
 */
export const GENERIC_TEXT: OperatorText = {
  title: "Waitron could not start.",
  action: "Ask whoever installed this box to look at it.",
};

/**
 * `Object.hasOwn`: the code comes from a file on the box, and a code of `toString` would otherwise
 * find an inherited function and crash the one page a failed box can still serve.
 */
function operatorText(state: RecoveryState): OperatorText {
  const { lastErrorCode } = state;
  if (lastErrorCode === HOLDER_STALLED) return holderStalledText(state.holderKind);
  if (lastErrorCode === null) return GENERIC_TEXT;
  if (!Object.hasOwn(OPERATOR_TEXT, lastErrorCode)) return GENERIC_TEXT;
  const entries: Readonly<Record<string, OperatorText | undefined>> = OPERATOR_TEXT;
  return entries[lastErrorCode] ?? GENERIC_TEXT;
}

function renderPage(state: RecoveryState, logLines: string[]): string {
  const errorCode = state.lastErrorCode === null ? "none" : escapeHtml(state.lastErrorCode);
  const failureAt = state.lastFailureAt === null ? "never" : escapeHtml(state.lastFailureAt);
  const text = operatorText(state);
  const tail =
    logLines.length === 0 ? "(no log yet)" : logLines.map((line) => escapeHtml(line)).join("\n");
  // The retry form sits above the installer detail: the operator's action is the point of the page.
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
<p>${escapeHtml(text.action)}</p>${
    text.es === undefined
      ? ""
      : `
<p lang="es">${escapeHtml(text.es.title)}</p>
<p lang="es">${escapeHtml(text.es.action)}</p>`
  }
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
 * Served instead of trading once boot has failed past the retry threshold. The one action is retry:
 * there is no degraded-but-trading mode.
 */
export function recoveryApp(deps: RecoveryDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const logLines = await tailLog(deps.logDir);
    return c.html(renderPage(deps.state, logLines));
  });

  // Named one by one, to leave out the clear count.
  app.get("/recovery-api/status", (c) => {
    const { failures, level, lastErrorCode, lastFailureAt, holderKind } = deps.state;
    return c.json({ failures, level, lastErrorCode, lastFailureAt, holderKind });
  });

  app.post("/recovery-api/retry", (c) => {
    const outgoing = outgoingOf(c);
    if (outgoing === undefined) {
      void deps.onRetry("normal");
    } else {
      outgoing.once("finish", () => void deps.onRetry("normal"));
    }
    return c.json({ ok: true });
  });

  return app;
}
