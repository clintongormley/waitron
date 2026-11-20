import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { CLOUD_SIGN_IN_CALLBACK } from "./cloud-sign-in.js";
import { resolveLoginLocale } from "./login-locale.js";
import { isRemoteStaffRequest } from "./request-from-box.js";

const script = `(async () => {
  const query = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  let outcome = "retry";
  try {
    const tab = sessionStorage.getItem("waitron-cloud-sign-in-tab");
    const requestId = query.get("request_id");
    const state = query.get("state");
    const code = query.get("code");
    const error = query.get("error");
    if (tab && requestId && state && query.size === 3 && Boolean(code) !== Boolean(error)) {
      const response = await fetch("/management-api/cloud/sign-in/return", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab, requestId, state, ...(code ? { code } : { error }) }),
      });
      if (response.ok) outcome = "";
      else if (error === "access_denied") outcome = "cancelled";
    }
  } finally {
    try {
      if (outcome) sessionStorage.setItem("waitron-cloud-sign-in-result", outcome);
    } finally {
      location.replace("/cloud");
    }
  }
})();`;
const scriptHash = createHash("sha256").update(script).digest("base64");

export function mountCloudSignInCallback(app: Hono, isPrimary: () => boolean) {
  app.get(CLOUD_SIGN_IN_CALLBACK, (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'sha256-${scriptHash}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    if (isRemoteStaffRequest(c) || !isPrimary()) return c.notFound();
    const spanish = resolveLoginLocale(c.req.header("accept-language"), "en-GB").startsWith("es");
    const message = spanish ? "Volviendo a Servicios de Cloud…" : "Returning to Cloud services…";
    return c.html(`<!doctype html><html lang="${spanish ? "es" : "en"}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${message}</title><p>${message}</p><script>${script}</script></html>`);
  });
}
