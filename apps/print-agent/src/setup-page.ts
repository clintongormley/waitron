import type { AgentConfig, AgentPhase, AgentStatus } from "@waitron/print-agent";
import { Hono } from "hono";

/**
 * The LAN setup/status page (base spec §2.3). It has no database and no secret: it reads the live
 * `AgentStatus` the loop publishes, renders one card per phase, and — when the server address is not
 * pinned by env — lets the operator enter it, writing the same `config.json` the Host reads.
 */
export interface SetupDeps {
  status: () => AgentStatus;
  config: () => Promise<AgentConfig | null>;
  saveConfig: (config: AgentConfig) => Promise<void>;
  /** True when `WAITRON_SERVER_URL` pins the address: the form becomes read-only and POST is refused,
   * so the page can never override a compose-supplied server. */
  envLocked: boolean;
  defaultName: string;
}

/** Minimal HTML-entity escaping for the untrusted strings the page interpolates — the agent's name,
 * a server-sent `lastError`. Without it a crafted error message could inject markup into the page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normaliseOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function layout(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waitron print agent</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #1a1a1a; }
  main { max-width: 30rem; margin: 2rem auto; padding: 0 1rem; }
  .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
  input { width: 100%; padding: .5rem; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 1rem; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin: 1rem 0; }
  .muted { color: #555; }
  dl { margin: 0; }
  dt { font-weight: 600; margin-top: .75rem; }
</style>
</head>
<body><main><div class="card">${body}</div></main></body>
</html>`;
}

function formCard(deps: SetupDeps, savedUrl: string, error?: string): string {
  const name = escapeHtml(deps.defaultName);
  if (deps.envLocked) {
    // The address is pinned by env; show it read-only with no way to save over it.
    return `<h1>Waitron print agent</h1>
<p>This agent's server address is set by its container and cannot be changed here.</p>
<dl><dt>Server address</dt><dd>${escapeHtml(savedUrl)}</dd></dl>`;
  }
  return `<h1>Waitron print agent</h1>
<p>Enter the address of the venue's server to connect this print agent.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/setup">
  <label for="serverUrl">Server address</label>
  <input id="serverUrl" name="serverUrl" type="url" placeholder="https://box.local" value="${escapeHtml(savedUrl)}" required>
  <label for="name">Name</label>
  <input id="name" name="name" type="text" value="${name}">
  <button type="submit">Save</button>
</form>`;
}

// `unconfigured` renders the form, handled by the caller before this is reached — so the switch here
// is exhaustive over the five connected phases and needs no default.
function statusCard(status: AgentStatus & { phase: Exclude<AgentPhase, "unconfigured"> }): string {
  const server = escapeHtml(status.current ?? status.serverUrl ?? "the server");
  switch (status.phase) {
    case "pending": {
      // The verification code is persisted while pending (AgentConfig.pendingVerificationNumber), so it
      // survives a restart and is normally always here. The fallback covers only a wiped state directory
      // and stays truthful — a plain restart re-polls the same request, it does NOT mint a fresh code.
      const body =
        status.verificationCode !== undefined
          ? `<p>Waiting for approval — verification code <strong>${escapeHtml(status.verificationCode)}</strong></p>
<p class="muted">Match this number in the dashboard to accept the agent.</p>`
          : `<p>Waiting for approval.</p>`;
      return `<h1>Waitron print agent</h1>${body}`;
    }
    case "pairing_closed":
      return `<h1>Waitron print agent</h1>
<p>Ask the manager to switch on pairing mode in the dashboard, then wait — this agent keeps asking.</p>`;
    case "running": {
      const lastJob =
        status.lastJobAt !== undefined
          ? new Date(status.lastJobAt).toISOString()
          : "no jobs printed yet";
      const lastError =
        status.lastError !== undefined
          ? `<dt>Last error</dt><dd>${escapeHtml(status.lastError)}</dd>`
          : "";
      return `<h1>Waitron print agent</h1>
<p>Connected and printing.</p>
<dl>
<dt>Following</dt><dd>${server}</dd>
<dt>Last job</dt><dd>${escapeHtml(lastJob)}</dd>
${lastError}
</dl>`;
    }
    case "unauthorized":
      // Reached from two paths — a `not_approved` status (the admin DENIED) and a pull `unauthorized`
      // (a live token was REVOKED) — so the copy names both.
      return `<h1>Waitron print agent</h1>
<p>This agent was denied or revoked — restart it to ask to join again.</p>`;
    case "unreachable": {
      const detail =
        status.lastError !== undefined
          ? `<p class="muted">${escapeHtml(status.lastError)}</p>`
          : "";
      return `<h1>Waitron print agent</h1>
<p>Can't reach ${server} right now — retrying.</p>${detail}`;
    }
    // `unconfigured` is handled before this function is called (it renders the form), so it never
    // reaches the switch.
  }
}

export function createSetupApp(deps: SetupDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const status = deps.status();
    if (status.phase === "unconfigured") {
      const saved = await deps.config();
      return c.html(layout(formCard(deps, saved?.serverUrl ?? "")));
    }
    // Past the form, the phase's own card is the whole page: it already names the server it follows,
    // so an env-locked agent needs no separate address line here. The guard above rules out
    // `unconfigured`, but `AgentStatus` is one interface so the property narrowing does not reshape
    // the object type — hence the assertion of the phase the guard has already proved.
    const connected = status as AgentStatus & { phase: Exclude<AgentPhase, "unconfigured"> };
    return c.html(layout(statusCard(connected)));
  });

  app.post("/setup", async (c) => {
    if (deps.envLocked) {
      // The address is pinned by env; the page must not be able to write over it (§2.3).
      return c.text("The server address is fixed by this agent's container.", 405);
    }
    const form = await c.req.parseBody();
    const rawUrl = typeof form.serverUrl === "string" ? form.serverUrl.trim() : "";
    const rawName = typeof form.name === "string" ? form.name.trim() : "";
    const origin = normaliseOrigin(rawUrl);
    if (origin === null) {
      return c.html(
        layout(formCard(deps, rawUrl, `That is not a valid http(s) address: ${rawUrl}`)),
        400,
      );
    }
    await deps.saveConfig({ serverUrl: origin, name: rawName === "" ? deps.defaultName : rawName });
    return c.redirect("/", 303);
  });

  app.get("/status.json", (c) => c.json(deps.status()));

  return app;
}
