import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { CLOUD_SIGN_IN_CALLBACK } from "./cloud-sign-in.js";
import { resolveLoginLocale } from "./login-locale.js";
import { cloudSignInCallbackCopy } from "./i18n/cloud-sign-in-callback.js";
import { isRemoteStaffRequest } from "./request-from-box.js";

function callbackScript(setup: boolean) {
  const tabKey = setup ? "waitron-setup-cloud-tab" : "waitron-cloud-sign-in-tab";
  const resultKey = setup ? "waitron-setup-cloud-result" : "waitron-cloud-sign-in-result";
  const scope = setup ? "setup-api" : "management-api";
  return `(async () => {
  const query = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  let outcome = "retry";
  try {
    const tab = sessionStorage.getItem("${tabKey}");
    const requestId = query.get("request_id");
    const state = query.get("state");
    const code = query.get("code");
    const error = query.get("error");
    if (tab && requestId && state && query.size === 3 && Boolean(code) !== Boolean(error)) {
      const response = await fetch("/${scope}/cloud/sign-in/return", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab, requestId, state, ...(code ? { code } : { error }) }),
      });
      if (response.ok) outcome = "${setup ? "signed-in" : ""}";
      else if (error === "access_denied") outcome = "cancelled";
    }
  } finally {
    try {
      if (outcome) sessionStorage.setItem("${resultKey}", outcome);
    } finally {
      location.replace("${setup ? "/" : "/cloud"}");
    }
  }
})();`;
}

export function mountCloudSignInCallback(
  app: Hono,
  isAvailable: (c: Context) => boolean,
  setup = false,
) {
  const script = callbackScript(setup);
  const scriptHash = createHash("sha256").update(script).digest("base64");
  app.get(CLOUD_SIGN_IN_CALLBACK, (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'sha256-${scriptHash}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    if (isRemoteStaffRequest(c) || !isAvailable(c)) return c.notFound();
    const lang = resolveLoginLocale(c.req.header("accept-language"), "en-GB").startsWith("es")
      ? "es"
      : "en";
    const message = cloudSignInCallbackCopy[lang][setup ? "setup" : "installed"];
    return c.html(`<!doctype html><html lang="${lang}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${message}</title><p>${message}</p><script>${script}</script></html>`);
  });
}
