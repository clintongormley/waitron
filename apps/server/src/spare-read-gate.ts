import type { MiddlewareHandler } from "hono";
import { codeOf } from "@waitron/server-kit";
import {
  AppError,
  isDashboardAssetPath,
  isDashboardPath,
  formatDuration,
  type SupportedLocale,
} from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import { SAFE_METHODS } from "./read-only-gate.js";
import { SPARE_WORDS } from "./i18n/spare.js";
import { BOX_HOSTNAME } from "./box-name.js";
import { escapeHtml, httpsLinkLine } from "./html-page.js";
import { boxPageAnswer, renderLogoBoxPage } from "./guide-pages.js";
import type { MainSilenceState } from "./main-silence-watch.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function renderSparePage(
  locale: SupportedLocale,
  main: MainSilenceState | undefined,
  nowMs: number,
  mainUrl: string | null,
): string {
  const words = SPARE_WORDS[locale];
  let mainLine = "";
  if (main?.silent === true)
    mainLine = `<p>${escapeHtml(
      words.mainSilent.replace("{duration}", () =>
        formatDuration(nowMs - main.silentSinceMs, locale),
      ),
    )} <a href="/handover/emergency">${escapeHtml(words.openSwitch)}</a></p>`;
  else if (main !== undefined && !main.reached)
    mainLine = `<p>${escapeHtml(words.mainUnreached)}</p>`;
  return renderLogoBoxPage(
    locale,
    words.title,
    `<h1>${escapeHtml(words.title)}</h1>
${mainLine}
<p>${escapeHtml(words.body)}</p>
${httpsLinkLine(mainUrl, words.openMain)}`,
  );
}

/**
 * Shown at the venue's name while the main server answers, to a device still holding this spare's
 * withdrawn answer. It reloads the same address and never names the main server's own: a till left
 * there could not find this spare at its next reload.
 */
export function renderMainBackPage(locale: SupportedLocale): string {
  const words = SPARE_WORDS[locale];
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Waitron</title>
<style>:root { color-scheme: light dark; } p { overflow-wrap: anywhere; }</style>
</head><body><main><p>${escapeHtml(words.mainBack)}</p></main></body></html>`;
}

/** Mounted on a mirror boot only; promotion must not reopen reads before the restart. */
export function spareReadGate(deps: {
  /** Undefined when no watch runs: a mirror whose chart names no other main box. */
  main: () => MainSilenceState | undefined;
  /** The main box's address from this box's chart; a failed read only drops the link. */
  mainUrl: () => Promise<string | null>;
  log: Logger;
  now?: () => number;
}): MiddlewareHandler {
  const now = deps.now ?? Date.now;
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) return next();
    const path = c.req.path;
    if (
      path === "/api/node" ||
      path === "/api/node/main" ||
      /^\/api\/node\/handover\/[^/]+$/.test(path) ||
      /^\/handover\/[^/]+\/?$/.test(path) ||
      path.startsWith("/handover/assets/")
    )
      return next();
    const locale = resolveLoginLocale(c.req.header("accept-language"), "en-GB");
    c.header("Cache-Control", "no-store");
    if (
      isDashboardPath(path) ||
      isDashboardAssetPath(path) ||
      path === "/till" ||
      path.startsWith("/till/")
    ) {
      const main = deps.main();
      if (new URL(c.req.url).hostname !== BOX_HOSTNAME)
        return boxPageAnswer(
          c,
          renderSparePage(
            locale,
            main,
            now(),
            await deps.mainUrl().catch((error: unknown) => {
              deps.log("warn", "spare_page.main_link_failed", {
                errorCode: codeOf(error),
                requestId: c.get("requestId"),
              });
              return null;
            }),
          ),
          200,
          "no-store",
        );
      if (main?.silent === true) {
        const back =
          path === "/till" || path.startsWith("/till/")
            ? `?back=${encodeURIComponent(c.req.url)}`
            : "";
        return c.redirect(`/handover/emergency${back}`, 302);
      }
      return c.html(renderMainBackPage(locale));
    }
    const error = new AppError("node.spare", {});
    const words = SPARE_WORDS[locale];
    return c.json(
      {
        error: { code: error.code, params: error.params, message: words.refusal },
      },
      403,
    );
  };
}
