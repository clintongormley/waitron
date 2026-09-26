import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { Hono } from "hono";
import type { Context } from "hono";
import { FALLBACK_LOCALE, type ErrorCode, type SupportedLocale } from "@waitron/shared";
import { LOG_FILE_NAME, type VenueHolderKind } from "@waitron/db";
import { resolveLoginLocale } from "./login-locale.js";
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

/** Keyed by locale, so an entry with no Spanish fails the typecheck. */
export type OperatorText = Readonly<
  Record<
    SupportedLocale,
    {
      /** What is wrong, in the operator's terms. */
      title: string;
      /** What they should do about it. */
      action: string;
    }
  >
>;

/** Each kind's name on the page. `script` and an unknown holder share the last row. */
const HOLDER_NAMES: Readonly<Record<VenueHolderKind, Readonly<Record<SupportedLocale, string>>>> = {
  server: { "en-GB": "the Waitron server", "es-ES": "el servidor de Waitron" },
  restore: {
    "en-GB": "a restore from a backup",
    "es-ES": "una restauración desde una copia de seguridad",
  },
  rejoin: {
    "en-GB": "a rejoin of this box to its venue",
    "es-ES": "la reincorporación de este equipo a su local",
  },
  provisioning: {
    "en-GB": "the Waitron setup command",
    "es-ES": "el comando de configuración de Waitron",
  },
  script: { "en-GB": "another Waitron program", "es-ES": "otro programa de Waitron" },
};

/**
 * The page's own fixed wording. `code` and `at` come from outside and are shown as recorded;
 * `level` is shown by its internal name. Each line is escaped whole where it is rendered.
 */
const PAGE_TEXT: Readonly<
  Record<
    SupportedLocale,
    {
      heading: string;
      retry: string;
      forInstaller: string;
      logTail: string;
      status: (level: string, failures: number) => string;
      lastError: (code: string, at: string) => string;
      noCode: string;
      noTime: string;
      noLog: string;
    }
  >
> = {
  "en-GB": {
    heading: "Waitron did not start",
    retry: "Retry a normal boot",
    forInstaller: "For whoever installed this box",
    logTail: "Log tail",
    status: (level, failures) => `Level: ${level}. Failed ${failures} times.`,
    lastError: (code, at) => `Last error: ${code} at ${at}`,
    noCode: "none",
    noTime: "never",
    noLog: "(no log yet)",
  },
  "es-ES": {
    heading: "Waitron no ha arrancado",
    retry: "Reintentar un arranque normal",
    forInstaller: "Para quien instaló este equipo",
    logTail: "Final del registro",
    status: (level, failures) => `Nivel: ${level}. Intentos fallidos: ${failures}.`,
    lastError: (code, at) => `Último error: ${code}, fecha: ${at}`,
    noCode: "ninguno",
    noTime: "nunca",
    noLog: "(aún no hay registro)",
  },
};

/**
 * "Two minutes" is the holder's watchdog bound (`WATCHDOG_KILL_MS`,
 * `packages/store/src/venue-liveness.ts`).
 */
function holderStalledText(kind: VenueHolderKind | undefined): OperatorText {
  const name = HOLDER_NAMES[kind ?? "script"];
  return {
    "en-GB": {
      title: `The box's database is held by ${name["en-GB"]}, which appears to have stopped responding.`,
      action:
        "Wait two minutes, then press Retry: Waitron normally ends a program of its own that stops responding within that time. If it fails again, ask whoever installed this box to look at it.",
    },
    "es-ES": {
      title: `La base de datos de este equipo está ocupada por ${name["es-ES"]}, que parece haber dejado de responder.`,
      action:
        "Espera dos minutos y pulsa «Reintentar un arranque normal»: Waitron normalmente cierra en ese tiempo un programa propio que deja de responder. Si vuelve a fallar, pide a quien instaló este equipo que lo revise.",
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
 * error code, the log tail and `lastFailureAt` — and all three are HTML-escaped, in either language,
 * as is the line carrying `level` and `failures`.
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
    "en-GB": {
      title:
        "This box's database was set up by a different version of Waitron than the one installed.",
      action:
        "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
    },
    "es-ES": {
      title:
        "La base de datos de este equipo la configuró una versión de Waitron distinta de la instalada.",
      action:
        "Restáurala desde una copia de seguridad, o reinstala. Si no tienes copia de seguridad, pide ayuda a quien instaló este equipo.",
    },
  },
  "provisioning.schema_mismatch": {
    "en-GB": {
      title: "The box's database does not match the installed software.",
      action:
        "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
    },
    "es-ES": {
      title: "La base de datos del equipo no coincide con el software instalado.",
      action:
        "Restáurala desde una copia de seguridad, o reinstala. Si no tienes copia de seguridad, pide ayuda a quien instaló este equipo.",
    },
  },
  "provisioning.database_unreachable": {
    // The engine could not open the file (`boot-failure.ts`, SQLITE_CANTOPEN).
    "en-GB": {
      title: "Waitron could not open the box's database.",
      action:
        "Press Retry. If it fails again, restart the box — that can fix a disk or a volume that did not come up. If it still fails, ask whoever installed this box for help: the box's database is a file on its disk, and the software cannot read it.",
    },
    "es-ES": {
      title: "Waitron no ha podido abrir la base de datos del equipo.",
      action:
        "Pulsa «Reintentar un arranque normal». Si vuelve a fallar, reinicia el equipo: eso puede arreglar un disco o un volumen que no se activó. Si sigue fallando, pide ayuda a quien instaló este equipo: la base de datos del equipo es un archivo en su disco, y el software no puede leerlo.",
    },
  },
  "migrations.incomplete": {
    // Deliberately no restore: a restore runs the migrations itself, so it can raise this code.
    "en-GB": {
      title: "The box's database was only partly updated.",
      action:
        "Ask whoever installed this box to look at it. Restoring a backup may not help: a restore runs the same update, and it can stop in the same place.",
    },
    "es-ES": {
      title: "La base de datos del equipo solo se actualizó en parte.",
      action:
        "Pide a quien instaló este equipo que lo revise. Restaurar una copia de seguridad puede no servir: una restauración ejecuta la misma actualización, y puede detenerse en el mismo punto.",
    },
  },
  "deployment.environment_mismatch": {
    // No restore and no reinstall: neither changes which database this box points at. The
    // environments must never share an invoice series (CLAUDE.md §5).
    "en-GB": {
      title:
        "This box and its database do not belong to the same system: one is set up for real sales, the other for testing.",
      action: "Ask whoever installed this box to check its settings.",
    },
    "es-ES": {
      title:
        "Este equipo y su base de datos no pertenecen al mismo sistema: uno está configurado para ventas reales y el otro para pruebas.",
      action: "Pide a quien instaló este equipo que revise su configuración.",
    },
  },
  "server.config_missing": {
    "en-GB": {
      title: "The box's configuration is incomplete.",
      action: "Ask whoever installed this box to check its settings.",
    },
    "es-ES": {
      title: "La configuración del equipo está incompleta.",
      action: "Pide a quien instaló este equipo que revise su configuración.",
    },
  },
  "server.config_invalid": {
    "en-GB": {
      title: "The box's configuration is invalid.",
      action: "Ask whoever installed this box to check its settings.",
    },
    "es-ES": {
      title: "La configuración del equipo no es válida.",
      action: "Pide a quien instaló este equipo que revise su configuración.",
    },
  },
  [BOOT_INCOMPLETE]: {
    "en-GB": {
      title: "Waitron did not finish starting.",
      action: "Press Retry. If it keeps failing, ask whoever installed this box to look at it.",
    },
    "es-ES": {
      title: "Waitron no terminó de arrancar.",
      action:
        "Pulsa «Reintentar un arranque normal». Si sigue fallando, pide a quien instaló este equipo que lo revise.",
    },
  },
  "restore.placement_failed": {
    // Shown only if this is the last failure when the box reaches recovery; a failed setup restore
    // is not retried, so one failed placement does not get here. Which database was kept is in the
    // params, which reach the server's own output (`node-entry.ts` → `failureDetail`), not this page.
    "en-GB": {
      title: "A restore could not put the restored database in place.",
      action:
        "Ask whoever installed this box to look at it before anything else. The server's own output says whether the box's previous database is unchanged or was left in a folder inside its venue folder, which must be moved back before the box is used.",
    },
    "es-ES": {
      title: "Una restauración no pudo poner en su sitio la base de datos restaurada.",
      action:
        "Antes de nada, pide a quien instaló este equipo que lo revise. La salida del propio servidor indica si la base de datos anterior del equipo sigue sin cambios o quedó en una carpeta dentro de la carpeta de su local; en ese caso hay que devolverla a su sitio antes de usar el equipo.",
    },
  },
  "restore.database_set_aside": {
    "en-GB": {
      title: "This box's database was moved aside by a restore that did not finish.",
      action:
        "Ask whoever installed this box to look at it before anything else. The database is in a folder inside the venue folder, named in the server's own output. It must be moved back, or the restore run again, before the box can start.",
    },
    "es-ES": {
      title: "La base de datos de este equipo quedó apartada por una restauración que no terminó.",
      action:
        "Antes de nada, pide a quien instaló este equipo que lo revise. La base de datos está en una carpeta dentro de la carpeta del local, cuyo nombre aparece en la salida del propio servidor. Hay que devolverla a su sitio, o volver a hacer la restauración, antes de que el equipo pueda arrancar.",
    },
  },
  "restore.membership_invalid": {
    // No retry: the refusal leaves the copy unchanged, so the next start reads it again.
    "en-GB": {
      title:
        "The list of machines in the restored copy is damaged or does not carry a valid signature, so it may have been changed after it was saved.",
      action:
        "The box will not start from this copy. Ask whoever installed this box to look at it before anything else.",
    },
    "es-ES": {
      title:
        "La lista de equipos de la copia restaurada está dañada o no tiene una firma válida, así que puede haberse cambiado después de guardarse.",
      action:
        "El equipo no arrancará con esta copia. Antes de nada, pide a quien instaló este equipo que lo revise.",
    },
  },
  "migrations.set_missing": {
    "en-GB": {
      title: "The installed software is incomplete.",
      action: "Reinstall Waitron on this box.",
    },
    "es-ES": {
      title: "El software instalado está incompleto.",
      action: "Reinstala Waitron en este equipo.",
    },
  },
  // The holder's own name, when `recovery.json` recorded one, replaces this row's in `operatorText`.
  [HOLDER_STALLED]: holderStalledText(undefined),
};

/**
 * Names a person rather than promising the reason is written down: a failure reading or counting
 * the recovery state reaches `node-entry.ts`'s outer handler, which logs its code and no detail.
 */
export const GENERIC_TEXT: OperatorText = {
  "en-GB": {
    title: "Waitron could not start.",
    action: "Ask whoever installed this box to look at it.",
  },
  "es-ES": {
    title: "Waitron no ha podido arrancar.",
    action: "Pide a quien instaló este equipo que lo revise.",
  },
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

function renderPage(state: RecoveryState, logLines: string[], locale: SupportedLocale): string {
  const page = PAGE_TEXT[locale];
  const text = operatorText(state)[locale];
  const lastError = page.lastError(
    state.lastErrorCode ?? page.noCode,
    state.lastFailureAt ?? page.noTime,
  );
  const tail =
    logLines.length === 0
      ? escapeHtml(page.noLog)
      : logLines.map((line) => escapeHtml(line)).join("\n");
  // The retry form sits above the installer detail: the operator's action is the point of the page.
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.heading)}</title>
</head>
<body>
<h1>${escapeHtml(page.heading)}</h1>
<p>${escapeHtml(text.title)}</p>
<p>${escapeHtml(text.action)}</p>
<form method="post" action="/recovery-api/retry">
<button type="submit">${escapeHtml(page.retry)}</button>
</form>
<h2>${escapeHtml(page.forInstaller)}</h2>
<p>${escapeHtml(page.status(state.level, state.failures))}</p>
<p>${escapeHtml(lastError)}</p>
<h2>${escapeHtml(page.logTail)}</h2>
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
    // No venue locale: that is read from the venue database, which the recovery path never opens.
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    return c.html(renderPage(deps.state, logLines, locale));
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
