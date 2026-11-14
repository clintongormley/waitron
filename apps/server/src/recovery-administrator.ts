import { escapeHtml } from "./html-page.js";
import { ENVIRONMENT_RECOVERY_TEXT } from "./i18n/recovery-page.js";
import type { Hono } from "hono";
import { verifyPassword } from "@waitron/identity";
import { beginStartAgainGuess } from "@waitron/provisioning";
import {
  AppError,
  hasCode,
  isAppError,
  FALLBACK_LOCALE,
  type SupportedLocale,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { errnoOf } from "./errno.js";
import {
  isSecure,
  formBody,
  movedPage,
  bottomText,
  passwordInput,
  START_AGAIN_PAGE_TEXT,
  type StartAgainMessage,
} from "./recovery-start-again.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";
import { resolveLoginLocale } from "./login-locale.js";
import { sentFromThisOrigin } from "./own-page.js";

export type AuthorizeAdministrator = (hashes: readonly string[]) => Promise<void>;
export interface AdministratorChoiceDeps {
  path: string;
  stateDir: string;
  throttleId: string;
  choose: (authorize: AuthorizeAdministrator) => Promise<string>;
  onFinished: () => Promise<void>;
  completedPage?: (locale: SupportedLocale, folder: string) => string;
  eventPrefix?: string;
}
export type AdministratorView = {
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  stopped?: boolean;
  unfinished?: boolean;
};

export function mountAdministratorChoice(
  app: Hono,
  deps: AdministratorChoiceDeps,
  render: (view: AdministratorView) => Promise<string>,
  log?: Logger,
) {
  const record = (level: "info" | "warn", event: string, fields: Record<string, unknown>) => {
    try {
      log?.(level, event, fields);
    } catch {
      /* The completed choice must still be answered. */
    }
  };
  let completed = false;
  let unfinished = false;
  app.post(deps.path, async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    const secure = isSecure(c);
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const answer = async (
      status: 200 | 400 | 403 | 409 | 429,
      message?: StartAgainMessage,
      stopped?: boolean,
    ) =>
      c.html(
        await render({
          locale,
          secure,
          ...(message === undefined ? {} : { message }),
          ...(stopped ? { stopped } : {}),
          ...(unfinished ? { unfinished } : {}),
        }),
        status,
      );
    if (completed || unfinished) return answer(409, { kind: "notFinished" });
    if (!secure) return answer(403, { kind: "insecure" });
    if (!sentFromThisOrigin(c)) return answer(403, { kind: "otherPage" });
    try {
      const form = new URLSearchParams(await formBody(c));
      if (
        [...form.keys()].some((key) => !["password", "choice"].includes(key)) ||
        [...form.keys()].length !== new Set(form.keys()).size
      )
        return answer(400, { kind: "choiceMissing" });
      const choice = form.get("choice");
      if (choice === "keep") return answer(200, undefined, true);
      if (choice !== "move") return answer(400, { kind: "choiceMissing" });
      const password = form.get("password");
      if (password === null || password === "") return answer(400, { kind: "passwordMissing" });
      const folder = await deps.choose(async (hashes) => {
        const finish = await beginStartAgainGuess(deps.stateDir, deps.throttleId, new Date());
        let verified = false;
        try {
          for (const hash of hashes)
            if (await verifyPassword(password, hash)) {
              verified = true;
              break;
            }
        } catch {
          verified = false;
        }
        if (!verified) throw new AppError("setup.owner_required", {});
        await finish("success");
      });
      completed = true;
      restartAfterResponse(outgoingOf(c), deps.onFinished, log);
      let result: Response;
      try {
        result = await answer(200, { kind: "moved", folder });
      } catch {
        result = c.html((deps.completedPage ?? movedPage)(locale, folder), 200);
        record("warn", `${deps.eventPrefix ?? "recovery.environment"}_draw_failed`, {});
      }
      record("info", `${deps.eventPrefix ?? "recovery.environment"}_moved`, { folder });
      return result;
    } catch (error) {
      if (isAppError(error) && hasCode(error, "password.throttled")) {
        c.header("Retry-After", String(error.params.retryAfterSeconds));
        return answer(429, {
          kind: "throttled",
          minutes: Math.ceil(error.params.retryAfterSeconds / 60),
        });
      }
      if (isAppError(error) && hasCode(error, "setup.owner_required"))
        return answer(403, { kind: "wrongPassword" });
      if (isAppError(error) && hasCode(error, "setup.not_ready"))
        return answer(409, { kind: "notOffered" });
      record("warn", `${deps.eventPrefix ?? "recovery.environment"}_move_failed`, {
        errorCode: isAppError(error) ? error.code : null,
        errno: errnoOf(error) ?? null,
        reason: isAppError(error) ? (error.reason ?? null) : null,
      });
      if (isAppError(error) && hasCode(error, "setup.start_again_set_aside_unavailable"))
        return answer(409, { kind: "moveUnavailable" });
      if (isAppError(error) && hasCode(error, "setup.environment_move_unfinished"))
        unfinished = true;
      return answer(409, { kind: "notFinished" });
    }
  });
}

export function renderEnvironmentSection(input: {
  locale: SupportedLocale;
  secure: boolean;
  message?: StartAgainMessage;
  text?: {
    detail: string;
    wrong: string;
    unavailable: string;
    move: string;
    stop: string;
    notFinished?: string;
  };
  path?: string;
  completed?: string;
  passwordId?: string;
}): string {
  const { locale, secure, message } = input;
  const shared = START_AGAIN_PAGE_TEXT[locale];
  const passwordId = input.passwordId ?? "start-again-password";
  const errorId = input.passwordId ? `${passwordId}-error` : "environment-password-error";
  const text = input.text ?? ENVIRONMENT_RECOVERY_TEXT[locale];
  if (message?.kind === "moved")
    return `<p>${escapeHtml(input.completed ?? shared.moved(message.folder))}</p>`;
  const passwordError =
    message?.kind === "wrongPassword"
      ? text.wrong
      : message?.kind === "passwordMissing"
        ? shared.passwordMissing
        : "";
  const error =
    message?.kind === "moveUnavailable"
      ? text.unavailable
      : message?.kind === "notFinished" && input.text?.notFinished !== undefined
        ? input.text.notFinished
        : message === undefined
          ? ""
          : passwordError || bottomText(message, shared);
  const explanation = `<p>${escapeHtml(text.detail)}</p>${input.text === undefined ? `<p>${escapeHtml(shared.moveUnsent)}</p>` : ""}`;
  if (!secure)
    return `${explanation}<p>${escapeHtml(shared.insecureForm)}</p>${error === "" ? "" : `<p>${escapeHtml(error)}</p>`}`;
  return `${explanation}<form method="post" action="${escapeHtml(input.path ?? "/recovery-api/environment/start-again")}">
<p><label for="${escapeHtml(passwordId)}">${escapeHtml(shared.password)} *</label></p>
<p>${passwordInput(passwordError === "" ? "" : ` aria-invalid="true" aria-describedby="${escapeHtml(errorId)}"`, passwordId)}</p>
${passwordError === "" ? "" : `<p id="${escapeHtml(errorId)}">${escapeHtml(passwordError)}</p>`}
${error === "" ? "" : `<p>${escapeHtml(passwordError === "" ? error : shared.fixFields)}</p>`}
<p><button type="submit" name="choice" value="move">${escapeHtml(text.move)}</button>
<button type="submit" name="choice" value="keep" formnovalidate>${escapeHtml(text.stop)}</button></p>
</form>`;
}
