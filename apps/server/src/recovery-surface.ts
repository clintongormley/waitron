import {
  mountBookingsRecovery,
  renderBookingsRecovery,
  type BookingsRecoveryDeps,
} from "./recovery-bookings.js";
import { renderEnvironmentSection } from "./recovery-administrator.js";
import {
  mountRestoreDiscard,
  renderRestoreDiscard,
  type RestoreRecoveryDeps,
} from "./recovery-restore.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";
import { LOG_FILE_NAME } from "@waitron/db";
import type { StartAgainSurvey, chooseStartAgainLeftovers } from "@waitron/provisioning";
import type { Statfs } from "./free-bytes.js";
import {
  GENERIC_TEXT,
  ENVIRONMENT_RECOVERY_TEXT,
  HOLDER_STALLED,
  OPERATOR_TEXT,
  RECOVERY_PAGE_WORDS,
  holderStalledText,
  type OperatorText,
} from "./i18n/recovery-page.js";
import { DECLARATION_LINK_WORDS } from "./i18n/declaration-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./html-page.js";
import { redactSecrets } from "./redact-secrets.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";
import type { RecoveryLevel, RecoveryState } from "./recovery-state.js";
import {
  isSecure,
  mountStartAgainChoice,
  renderStartAgainSection,
  type StartAgainView,
} from "./recovery-start-again.js";

import {
  mountEnvironmentChoice,
  type EnvironmentRecoveryDeps,
  type EnvironmentView,
} from "./recovery-environment.js";

export {
  BOOT_INCOMPLETE,
  GENERIC_TEXT,
  HOLDER_STALLED,
  OPERATOR_TEXT,
  type OperatorText,
} from "./i18n/recovery-page.js";

const MAX_LOG_LINES = 200;

export interface RecoveryDeps {
  state: RecoveryState;
  logDir: string;
  onRetry: (level: RecoveryLevel) => Promise<void>;
  /** Bytes free on the box's disk, read on every request; null when it cannot be read. */
  freeSpace?: () => Promise<number | null>;
  /** This start could not record its failure, so `failures` does not count it. */
  uncounted?: true;
  /** This start was refused before it began, so `failures` does not count it. */
  refusedAtStart?: true;
  log?: Logger;
  environment?: EnvironmentRecoveryDeps;
  restore?: RestoreRecoveryDeps;
  bookings?: BookingsRecoveryDeps;
  /** Present when the start found files a cut-off Start again did not create. */
  startAgain?: {
    roots: { stateDir: string; venueDir: string };
    survey: Extract<StartAgainSurvey, { kind: "choice" }>;
    onFinished: () => Promise<void>;
    choose?: typeof chooseStartAgainLeftovers;
    now?: () => Date;
    statfs?: Statfs;
  };
}

interface LogView {
  tail: string[];
  /** The detail `node-entry.ts` recorded for the latest start, when that start failed. */
  lastFailure: { at: string; detail: string } | null;
}

type BootLine = { event?: unknown; at?: unknown; detail?: unknown } & Record<string, unknown>;

/** A `server.boot_*` line as `node-entry.ts` writes it, or null for any other line or a torn one. */
function bootLine(line: string): BootLine | null {
  if (!line.includes('"server.boot_')) return null;
  try {
    return JSON.parse(line) as BootLine;
  } catch {
    return null;
  }
}

/**
 * Walks back to the latest start's own lines. A later `server.boot_started` with no failure after it
 * means the latest start hung or was killed, and an older failure would describe another start.
 */
function lastFailureIn(lines: readonly string[]): LogView["lastFailure"] {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = bootLine(lines[index]!);
    if (parsed?.event === "server.boot_started") return null;
    if (parsed?.event === "server.boot_failed" && typeof parsed.detail === "string") {
      return { at: String(parsed.at), detail: parsed.detail };
    }
  }
  return null;
}

/** A failed start's detail on lines of its own, below the rest of its record. */
function tailLine(line: string): string {
  const parsed = bootLine(line);
  if (parsed?.event !== "server.boot_failed" || typeof parsed.detail !== "string") return line;
  const { detail, ...rest } = parsed;
  return `${JSON.stringify(rest)}\n${detail}`;
}

/** Never throws: a box that failed before it ever wrote a log still has to serve this page. */
async function readLog(logDir: string): Promise<LogView> {
  let text: string;
  try {
    text = await readFile(join(logDir, LOG_FILE_NAME), "utf8");
  } catch {
    return { tail: [], lastFailure: null };
  }
  const lines = text.split("\n").filter((line) => line !== "");
  // Read from the whole file, so the tail's line cap cannot cut the failure off.
  return { tail: lines.slice(-MAX_LOG_LINES), lastFailure: lastFailureIn(lines) };
}

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

function triggerLines(
  state: RecoveryState,
  page: (typeof RECOVERY_PAGE_WORDS)[SupportedLocale],
): string {
  if (state.refused !== true || state.refusedTriggers === undefined) return "";
  const { missing, altered } = state.refusedTriggers;
  const names = (list: readonly string[]) => list.map((name) => redactSecrets(name)).join(", ");
  const lines = [
    ...(missing.length > 0 ? [page.missingTriggers(names(missing))] : []),
    ...(altered.length > 0 ? [page.changedTriggers(names(altered))] : []),
  ];
  return lines.map((line) => `<p>${escapeHtml(line)}</p>\n`).join("");
}

/** `undefined` means no reader was given, so the page carries no free-space line at all. */
type FreeSpaceReading = number | null | undefined;

async function readFreeSpace(deps: RecoveryDeps): Promise<FreeSpaceReading> {
  if (deps.freeSpace === undefined) return undefined;
  let bytes: number | null;
  try {
    bytes = await deps.freeSpace();
  } catch (error) {
    deps.log?.("warn", "recovery.free_space_unreadable", { errno: errnoOf(error) ?? null });
    return null;
  }
  if (bytes === null) deps.log?.("warn", "recovery.free_space_unreadable", { errno: null });
  return bytes;
}

function megabytes(bytes: number, locale: SupportedLocale): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
}

function freeSpaceLine(bytes: FreeSpaceReading, locale: SupportedLocale): string {
  if (bytes === undefined) return "";
  const page = RECOVERY_PAGE_WORDS[locale];
  const amount = bytes === null ? page.unknownSpace : megabytes(bytes, locale);
  return `<p>${escapeHtml(page.freeSpace(amount))}</p>\n`;
}

function renderPage(
  deps: RecoveryDeps,
  log: LogView,
  locale: SupportedLocale,
  freeBytes: FreeSpaceReading,
  state: RecoveryState = deps.state,
  section = "",
  answer?: string,
): string {
  const page = RECOVERY_PAGE_WORDS[locale];
  const text = operatorText(state)[locale];
  const refused = state.refused === true;
  const heading = refused ? page.stoppedHeading : page.heading;
  const status = refused
    ? page.stoppedStatus(state.level)
    : deps.refusedAtStart === true
      ? page.refusedAtStartStatus(state.level)
      : deps.uncounted === true
        ? page.uncountedStatus(state.level)
        : page.status(state.level, state.failures);
  const lastError = page.lastError(
    state.lastErrorCode ?? page.noCode,
    state.lastFailureAt ?? page.noTime,
  );
  const tail =
    log.tail.length === 0
      ? escapeHtml(page.noLog)
      : log.tail.map((line) => escapeHtml(tailLine(line))).join("\n");
  const lastFailure =
    log.lastFailure === null
      ? ""
      : `<h2>${escapeHtml(page.lastFailure(log.lastFailure.at))}</h2>
<pre>${escapeHtml(log.lastFailure.detail)}</pre>
`;
  // The retry form sits above the details section: the operator's action is the point of the page.
  // A settled `answer` (a finished Move) takes the place of the operator text and the retry form.
  const lead =
    answer ??
    `<p>${escapeHtml(text.title)}</p>
<p>${escapeHtml(text.action)}</p>
${section}<form method="post" action="/recovery-api/retry">
<button type="submit">${escapeHtml(page.retry)}</button>
</form>
`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>:root { color-scheme: light dark; }</style>
<style>pre { white-space: pre-wrap; } pre, p { overflow-wrap: anywhere; }</style>
<style>li { overflow-wrap: anywhere; }</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
${lead}<h2>${escapeHtml(page.details)}</h2>
<p>${escapeHtml(status)}</p>
${freeSpaceLine(freeBytes, locale)}${triggerLines(state, page)}<p>${escapeHtml(lastError)}</p>
${lastFailure}<h2>${escapeHtml(page.logTail)}</h2>
<pre>${tail}</pre>
<p><a href="/legal/declaration">${escapeHtml(DECLARATION_LINK_WORDS.title)}</a></p>
</body>
</html>
`;
}

/**
 * The recovery page, drawn as the kept page once `isKept()` answers true or the view's code is the
 * kept one, and as the move-unfinished page or the moved answer, with no choice, from the first view
 * that asks for it.
 */
export function startAgainDraw(
  deps: RecoveryDeps,
  isKept: () => boolean,
): (view: Omit<StartAgainView, "code"> & { code?: StartAgainView["code"] }) => Promise<string> {
  const { startAgain } = deps;
  // A recorded Move has changed the files the survey listed, so its form must not come back.
  let moveUnfinished = false;
  let moved: StartAgainView["message"];
  return async (view) => {
    const [log, freeBytes] = await Promise.all([readLog(deps.logDir), readFreeSpace(deps)]);
    if (startAgain === undefined) return renderPage(deps, log, view.locale, freeBytes);
    if (view.code === "setup.start_again_move_unfinished") moveUnfinished = true;
    if (view.message?.kind === "moved") moved = view.message;
    if (moved !== undefined) view = { ...view, message: moved };
    const settled = moveUnfinished
      ? "setup.start_again_move_unfinished"
      : isKept() || view.code === "setup.start_again_kept"
        ? "setup.start_again_kept"
        : null;
    if (settled !== null) {
      const state: RecoveryState = { ...deps.state, lastErrorCode: settled };
      return renderPage(deps, log, view.locale, freeBytes, state);
    }
    const section = renderStartAgainSection({
      survey: startAgain.survey,
      locale: view.locale,
      secure: view.secure,
      ...(view.message === undefined ? {} : { message: view.message }),
      ...(view.chosen === undefined ? {} : { chosen: view.chosen }),
    });
    if (view.message?.kind === "moved")
      return renderPage(deps, log, view.locale, freeBytes, deps.state, "", section);
    return renderPage(deps, log, view.locale, freeBytes, deps.state, section);
  };
}

/**
 * Served instead of trading once boot has failed past the retry threshold, or on the first start
 * after the running server stopped itself (`refused`). The action is retry, or on a Start again
 * cut off beside found files, Keep or Move: there is no degraded-but-trading mode.
 */
export function recoveryApp(deps: RecoveryDeps): Hono {
  const app = new Hono();
  const { startAgain } = deps;
  // Kept in-process only: the next start reads the recorded Keep from disk and refuses with it.
  let kept = false;
  const startAgainPage = startAgainDraw(deps, () => kept);
  let environmentAnswer: string | undefined;
  let environmentUnfinished = false;
  const drawEnvironment = async (view: EnvironmentView) => {
    const [log, freeBytes] = await Promise.all([readLog(deps.logDir), readFreeSpace(deps)]);
    if (view.unfinished) environmentUnfinished = true;
    if (environmentUnfinished)
      return renderPage(deps, log, view.locale, freeBytes, {
        ...deps.state,
        lastErrorCode: "setup.environment_move_unfinished",
      });
    const section = renderEnvironmentSection(view);
    if (view.message?.kind === "moved") environmentAnswer = section;
    if (view.stopped)
      return renderPage(
        deps,
        log,
        view.locale,
        freeBytes,
        deps.state,
        `<p>${escapeHtml(ENVIRONMENT_RECOVERY_TEXT[view.locale].stopped)}</p>`,
      );
    return renderPage(deps, log, view.locale, freeBytes, deps.state, section, environmentAnswer);
  };
  const drawRestore = async (view: EnvironmentView) => {
    const [log, freeBytes] = await Promise.all([readLog(deps.logDir), readFreeSpace(deps)]);
    const section = await renderRestoreDiscard(deps.restore!, view, deps.log);
    if (section === "")
      return (deps.environment === undefined ? startAgainPage : drawEnvironment)(view);
    return renderPage(
      deps,
      log,
      view.locale,
      freeBytes,
      deps.state,
      view.message?.kind === "moved" ? "" : section,
      view.message?.kind === "moved" ? section : undefined,
    );
  };
  const drawBase =
    deps.restore !== undefined
      ? drawRestore
      : deps.environment === undefined
        ? startAgainPage
        : drawEnvironment;

  const bookings =
    deps.state.refused || deps.uncounted || deps.refusedAtStart ? undefined : deps.bookings;
  const drawBookings = async (view: EnvironmentView) => {
    const [log, freeBytes] = await Promise.all([readLog(deps.logDir), readFreeSpace(deps)]);
    const section = await renderBookingsRecovery(bookings!, view);
    return renderPage(
      deps,
      log,
      view.locale,
      freeBytes,
      deps.state,
      view.message?.kind === "moved" ? "" : section,
      view.message?.kind === "moved" ? section : undefined,
    );
  };
  const draw = async (view: EnvironmentView) => {
    const base = await drawBase(view);
    if (!bookings) return base;
    const retry = '<form method="post" action="/recovery-api/retry">';
    return base.replace(retry, `${await renderBookingsRecovery(bookings, view)}${retry}`);
  };
  if (bookings) mountBookingsRecovery(app, bookings, drawBookings, deps.log);

  app.get("/", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    return c.html(await draw({ locale, secure: isSecure(c) }));
  });

  if (startAgain !== undefined)
    mountStartAgainChoice(app, startAgain, startAgainPage, deps.log, () => {
      kept = true;
    });

  if (deps.environment !== undefined)
    mountEnvironmentChoice(app, deps.environment, drawEnvironment, deps.log);

  if (deps.restore !== undefined) mountRestoreDiscard(app, deps.restore, drawRestore, deps.log);

  // Named one by one, to leave out the clear count and the trigger names.
  app.get("/recovery-api/status", (c) => {
    const { failures, level, lastErrorCode, lastFailureAt, holderKind } = deps.state;
    const refused = deps.state.refused === true;
    return c.json({ failures, level, lastErrorCode, lastFailureAt, holderKind, refused });
  });

  app.post("/recovery-api/retry", (c) => {
    restartAfterResponse(outgoingOf(c), () => deps.onRetry("normal"), deps.log);
    return c.json({ ok: true });
  });

  return app;
}
