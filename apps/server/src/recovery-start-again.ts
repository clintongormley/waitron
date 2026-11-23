import { OPERATOR_WORDS, RECOVERY_PAGE_WORDS } from "./i18n/recovery-page.js";
import { START_AGAIN_PAGE_WORDS, type StartAgainPageWords } from "./i18n/start-again-page.js";
import { isSecure } from "./encrypted-connection.js";
import type { Context, Hono } from "hono";
import {
  chooseStartAgainLeftovers,
  errnoOf,
  rootRelativePath,
  type StartAgainSurvey,
  type StartAgainUnit,
} from "@waitron/provisioning";
import {
  AppError,
  FALLBACK_LOCALE,
  hasCode,
  isAppError,
  type SupportedLocale,
} from "@waitron/shared";
import { FULL_DISK_BYTES, fullDiskFailure } from "./boot-failure.js";
import "./errors.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { sentFromThisOrigin } from "./own-page.js";
import { escapeHtml, renderDocument } from "./html-page.js";
import type { RecoveryDeps } from "./recovery-surface.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";
import { lowestFreeBytes } from "./start-space.js";

export type StartAgainMessage =
  | {
      kind:
        | "passwordMissing"
        | "choiceMissing"
        | "wrongPassword"
        | "filesChanged"
        | "notOffered"
        | "insecure"
        | "otherPage"
        | "busy"
        | "diskFull"
        | "moveUnavailable"
        | "notSaved"
        | "notFinished";
    }
  | { kind: "throttled"; minutes: number }
  | { kind: "moved"; folder: string };

type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

const MAX_LISTED = 50;

/** The unit's top path first (a folder with a trailing `/`), then a database's side files. */
function unitLines(unit: StartAgainUnit): string[] {
  const top = unit.entries.find((entry) => entry.path === unit.path);
  const head = `${unit.root}/${unit.path}${top?.type === "folder" ? "/" : ""}`;
  const sides = unit.pieces
    .filter((piece) => piece !== unit.path)
    .map((piece) => `${unit.root}/${piece}`);
  return [head, ...sides];
}

function foundList(survey: Choice, text: StartAgainPageWords): string {
  const lines = survey.units.flatMap(unitLines);
  const shown = lines.slice(0, MAX_LISTED);
  if (lines.length > MAX_LISTED) shown.push(text.more(lines.length - MAX_LISTED));
  return `<p>${escapeHtml(text.filesFound)}</p>
<ul>
${shown.map((line) => `<li>${escapeHtml(line)}</li>`).join("\n")}
</ul>
`;
}

export function bottomText(message: StartAgainMessage, text: StartAgainPageWords): string {
  switch (message.kind) {
    case "passwordMissing":
    case "choiceMissing":
      return text.fixFields;
    case "wrongPassword":
      return text.forgotten;
    case "throttled":
      return `${text.throttled(message.minutes)} ${text.forgotten}`;
    case "moved":
      return text.moved(message.folder);
    default:
      return text[message.kind];
  }
}

/**
 * The found files and, over a secure request, the choice form. Placed between the action
 * paragraph and the Retry form. A `moved` answer is the moved message over the found files, with
 * no form, and the page draws it in place of the title, the action paragraph and the Retry form.
 * The page loads no script, so its password field cannot use a field primitive (A1098 Q1).
 */
export function passwordInput(passwordInvalid: string, id = "start-again-password"): string {
  return `<input type="password" id="${escapeHtml(id)}" name="password" autocomplete="current-password" required${passwordInvalid}>`;
}

export function renderStartAgainSection(input: {
  survey: Choice;
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  chosen?: "keep" | "move";
}): string {
  const { survey, locale, secure, message, chosen } = input;
  const text = START_AGAIN_PAGE_WORDS[locale];
  const list = foundList(survey, text);
  const bottom =
    message === undefined
      ? ""
      : `<p id="start-again-message">${escapeHtml(bottomText(message, text))}</p>\n`;
  if (message?.kind === "moved") return `${bottom}${list}`;
  if (!secure) return `${list}<p>${escapeHtml(text.insecureForm)}</p>\n${bottom}`;

  const passwordError =
    message?.kind === "passwordMissing"
      ? text.passwordMissing
      : message?.kind === "wrongPassword"
        ? text.wrongPassword
        : null;
  const choiceError = message?.kind === "choiceMissing" ? text.choiceMissing : null;
  const passwordInvalid =
    passwordError === null
      ? ""
      : ' aria-invalid="true" aria-describedby="start-again-password-error"';
  const choiceInvalid = choiceError === null ? "" : ' aria-describedby="start-again-choice-error"';
  // A Move this box cannot do is not offered back as the person's choice.
  const preselected = message?.kind === "moveUnavailable" ? undefined : chosen;
  const checked = (value: "keep" | "move") => (preselected === value ? " checked" : "");
  const fieldError = (id: string, value: string | null) =>
    value === null ? "" : `<p id="${id}">${escapeHtml(value)}</p>\n`;

  return `${list}<form method="post" action="/recovery-api/start-again">
<p><label for="start-again-password">${escapeHtml(text.password)} *</label></p>
<p>${passwordInput(passwordInvalid)}</p>
${fieldError("start-again-password-error", passwordError)}<fieldset${choiceInvalid}>
<legend>${escapeHtml(text.choiceLegend)}</legend>
<p><label><input type="radio" name="choice" value="keep" required${checked("keep")}> <strong>${escapeHtml(text.keepTitle)}</strong></label></p>
<p>${escapeHtml(text.keepDetail)}</p>
<p><label><input type="radio" name="choice" value="move" required${checked("move")}> <strong>${escapeHtml(text.moveTitle)}</strong></label></p>
<p>${escapeHtml(text.moveDetail)}</p>
<p>${escapeHtml(text.moveUnsent)}</p>
</fieldset>
${fieldError("start-again-choice-error", choiceError)}<input type="hidden" name="listed" value="${escapeHtml(survey.digest)}">
${bottom}<p><button type="submit">${escapeHtml(text.continue)}</button></p>
</form>
`;
}

export interface StartAgainView {
  code:
    | "setup.start_again_files_found"
    | "setup.start_again_kept"
    | "setup.start_again_move_unfinished";
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  chosen?: "keep" | "move";
}

/** Draws the whole recovery page for `view`; the route sets the status and headers. */
export type StartAgainRender = (view: StartAgainView) => string | Promise<string>;

type StartAgainDeps = NonNullable<RecoveryDeps["startAgain"]>;

const MAX_FORM_BYTES = 4096;
const FORM_FIELDS = ["password", "choice", "listed"] as const;

class Refusal {
  constructor(
    readonly status: 400 | 403 | 409 | 429,
    readonly message: StartAgainMessage,
    readonly secure = true,
  ) {}
}

function invalid(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}

export async function formBody(c: Context, maxBytes = MAX_FORM_BYTES): Promise<string> {
  const type = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") invalid("body");
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) invalid("body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        invalid("body");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface Form {
  password: string | undefined;
  choice: "keep" | "move" | undefined;
  listed: string | undefined;
}

function parseForm(body: string): Form {
  const params = new URLSearchParams(body);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) invalid("body");
  if (keys.some((key) => !(FORM_FIELDS as readonly string[]).includes(key))) invalid("body");
  const value = (key: (typeof FORM_FIELDS)[number]) => {
    const found = params.get(key);
    return found === null || found === "" ? undefined : found;
  };
  const choice = value("choice");
  return {
    password: value("password"),
    choice: choice === "keep" || choice === "move" ? choice : undefined,
    listed: value("listed"),
  };
}

async function refusalFor(error: unknown, deps: StartAgainDeps, log?: Logger): Promise<Refusal> {
  if (isAppError(error)) {
    if (hasCode(error, "setup.request_invalid")) {
      const field = error.params.field;
      if (field === "password") return new Refusal(400, { kind: "passwordMissing" });
      if (field === "choice") return new Refusal(400, { kind: "choiceMissing" });
      return new Refusal(400, { kind: "notSaved" });
    }
    if (hasCode(error, "password.throttled"))
      return new Refusal(429, {
        kind: "throttled",
        minutes: Math.ceil(error.params.retryAfterSeconds / 60),
      });
    switch (error.code) {
      case "setup.owner_required":
        return new Refusal(403, { kind: "wrongPassword" });
      case "setup.start_again_files_changed":
        return new Refusal(409, { kind: "filesChanged" });
      case "setup.not_ready":
      case "setup.start_again_kept":
        return new Refusal(409, { kind: "notOffered" });
      case "provisioning.database_in_use":
        return new Refusal(409, { kind: "busy" });
      case "setup.start_again_set_aside_unavailable":
        return new Refusal(409, { kind: "moveUnavailable" });
      case "setup.attempt_invalid": {
        const free = await lowestFreeBytes([deps.roots.stateDir, deps.roots.venueDir], deps.statfs);
        return new Refusal(409, {
          kind: free !== null && free < FULL_DISK_BYTES ? "diskFull" : "notSaved",
        });
      }
    }
  }
  if (!isAppError(error)) {
    const free = await lowestFreeBytes([deps.roots.stateDir, deps.roots.venueDir], deps.statfs);
    if (fullDiskFailure(error, free)) return new Refusal(409, { kind: "diskFull" });
  }
  logChoiceFailed(error, deps, log);
  return new Refusal(409, { kind: "notFinished" });
}

/** The cause a warning may carry: a code's own reason, else an errno and a root-relative path. */
function failureReason(error: unknown, deps: StartAgainDeps): string | undefined {
  if (isAppError(error)) return error.reason;
  const errno = errnoOf(error);
  const where = rootRelativePath(deps.roots, error);
  if (where === undefined) return errno;
  return `${errno ?? "unknown"} ${where}`;
}

function logChoiceFailed(error: unknown, deps: StartAgainDeps, log?: Logger): void {
  const reason = failureReason(error, deps);
  log?.("warn", "recovery.start_again_choice_failed", {
    errorCode: isAppError(error) ? error.code : null,
    ...(reason === undefined ? {} : { reason }),
  });
}

export function movedFolder(setAside: { state: string; venue: string }): string {
  const parent = setAside.state.slice(0, setAside.state.lastIndexOf("/"));
  return `state/${parent}`;
}

/** Drawn without the page's `render`, for a recorded Move whose answer page failed to draw. */
export function movedPage(locale: SupportedLocale, folder: string): string {
  return renderDocument(
    locale,
    RECOVERY_PAGE_WORDS[locale].heading,
    `<p>${escapeHtml(START_AGAIN_PAGE_WORDS[locale].moved(folder))}</p>\n`,
  );
}

function keptPage(locale: SupportedLocale): string {
  const kept = OPERATOR_WORDS["setup.start_again_kept"]![locale];
  return renderDocument(locale, kept.title, `<p>${escapeHtml(kept.action)}</p>\n`);
}

/**
 * `POST /recovery-api/start-again`: the Keep or Move form `renderStartAgainSection` draws. Refuses
 * before choosing unless the request came over TLS from this page; the password goes to `choose`
 * alone and is never logged.
 */
export function mountStartAgainChoice(
  app: Hono,
  deps: StartAgainDeps,
  render: StartAgainRender,
  log?: Logger,
  onKept?: () => void,
): void {
  const choose = deps.choose ?? chooseStartAgainLeftovers;
  const now = deps.now ?? (() => new Date());
  // A recorded Move that did not finish is resumed by the next start, so no second choice may be
  // recorded over it from a stale form.
  let moveUnfinished = false;
  // A finished Move has changed the files the form listed, so a stale form chooses nothing.
  let moved: { kind: "moved"; folder: string } | undefined;

  app.post("/recovery-api/start-again", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const page = async (status: 200 | Refusal["status"], view: Omit<StartAgainView, "locale">) =>
      c.html(await render({ ...view, locale }), status);
    const code = "setup.start_again_files_found" as const;
    if (moveUnfinished)
      return page(409, { code: "setup.start_again_move_unfinished", secure: isSecure(c) });
    if (moved !== undefined) return page(409, { code, secure: isSecure(c), message: moved });

    let chosen: Form["choice"];
    let result: Awaited<ReturnType<typeof choose>>;
    try {
      if (!isSecure(c)) throw new Refusal(403, { kind: "insecure" }, false);
      if (!sentFromThisOrigin(c)) throw new Refusal(403, { kind: "otherPage" });
      const form = parseForm(await formBody(c));
      chosen = form.choice;
      if (form.password === undefined) invalid("password");
      if (form.choice === undefined) invalid("choice");
      if (form.listed === undefined) invalid("listed");
      result = await choose({
        roots: deps.roots,
        password: form.password,
        choice: form.choice,
        listed: form.listed,
        now,
        environmentKeys: deps.environmentKeys,
      });
    } catch (error) {
      if (isAppError(error) && hasCode(error, "setup.start_again_move_unfinished")) {
        moveUnfinished = true;
        // Drawn first: the draw holds the page on this code, which a throwing logger must not skip.
        const answer = await page(409, { code: error.code, secure: true });
        try {
          logChoiceFailed(error, deps, log);
        } catch {
          // The choice is answered; a failed log line must not turn the answer into a 500.
        }
        return answer;
      }
      const refusal = error instanceof Refusal ? error : await refusalFor(error, deps, log);
      if (isAppError(error) && hasCode(error, "password.throttled"))
        c.header("Retry-After", String(error.params.retryAfterSeconds));
      return page(refusal.status, {
        code,
        secure: refusal.secure,
        message: refusal.message,
        ...(chosen === undefined ? {} : { chosen }),
      });
    }
    // Outside the catch: the choice is recorded, so a failure to draw must not say nothing changed.
    // Logged after the answer is drawn: a throwing logger must neither skip the draw that holds the
    // page on its answer nor turn the answer into a 500.
    const logChoice = () => {
      try {
        log?.("info", "recovery.start_again_choice", {
          choice: result.choice,
          attemptId: deps.survey.attemptId,
          units: deps.survey.units.length,
        });
      } catch {
        // The choice is answered either way.
      }
    };
    const recorded = async (view: Omit<StartAgainView, "locale">, fallback: string) => {
      let answer: Response;
      try {
        answer = await page(200, view);
      } catch {
        answer = c.html(fallback, 200);
        try {
          log?.("warn", "recovery.start_again_draw_failed", { choice: result.choice });
        } catch {
          // The recorded page is answered either way.
        }
      }
      logChoice();
      return answer;
    };
    if (result.choice === "keep") {
      onKept?.();
      return recorded({ code: "setup.start_again_kept", secure: true }, keptPage(locale));
    }
    moved = { kind: "moved", folder: movedFolder(result.setAside) };
    restartAfterResponse(outgoingOf(c), deps.onFinished, log);
    return recorded({ code, secure: true, message: moved }, movedPage(locale, moved.folder));
  });
}
