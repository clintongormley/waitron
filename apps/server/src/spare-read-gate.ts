import type { MiddlewareHandler } from "hono";
import { AppError, type SupportedLocale } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import { SAFE_METHODS } from "./read-only-gate.js";
import { SPARE_WORDS } from "./i18n/spare.js";
import { BOX_HOSTNAME } from "./box-name.js";
import "./errors.js";

export function renderSparePage(locale: SupportedLocale): string {
  const words = SPARE_WORDS[locale];
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${words.title}</title>
<style>:root { color-scheme: light dark; } p { overflow-wrap: anywhere; }</style>
</head><body><main><h1>${words.title}</h1><p>${words.status}</p><p>${words.body}</p></main></body></html>`;
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
</head><body><main><p>${words.mainBack}</p></main></body></html>`;
}

/** Mounted on a mirror boot only; promotion must not reopen reads before the restart. */
export function spareReadGate(deps: { silent: () => boolean }): MiddlewareHandler {
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
    if (path === "/" || path === "/manage" || path.startsWith("/manage/")) {
      if (new URL(c.req.url).hostname !== BOX_HOSTNAME) return c.html(renderSparePage(locale));
      if (deps.silent()) return c.redirect("/handover/emergency", 302);
      return c.html(renderMainBackPage(locale));
    }
    const error = new AppError("node.spare", {});
    const words = SPARE_WORDS[locale];
    return c.json(
      {
        error: { code: error.code, params: error.params, message: `${words.title}. ${words.body}` },
      },
      403,
    );
  };
}
