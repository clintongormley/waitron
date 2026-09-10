import type {
  AgentConfig,
  AgentPhase,
  AgentStatus,
  DiscoveredDevice,
  PairResult,
} from "@waitron/print-agent";
import { Hono } from "hono";

/**
 * The LAN setup/status page (base spec §2.3). It has no database and no secret: it reads the live
 * `AgentStatus` the loop publishes, renders one card per phase, and — when the server address is not
 * pinned by env — lets the operator enter it, writing the same `config.json` the Host reads. A second
 * card drives box-local Bluetooth pairing (Scan → Pair), acting only on the box's own radio (#289).
 */
export interface SetupDeps {
  status: () => AgentStatus;
  config: () => Promise<AgentConfig | null>;
  saveConfig: (config: AgentConfig) => Promise<void>;
  /** True when `WAITRON_SERVER_URL` pins the address: the form becomes read-only and POST is refused,
   * so the page can never override a compose-supplied server. */
  envLocked: boolean;
  defaultName: string;
  /** A box-local Bluetooth inquiry — `host.scan(["bluetooth"])`. */
  scanBluetooth: () => Promise<DiscoveredDevice[]>;
  /** Bonds a Bluetooth printer by MAC — `host.pair(mac)`. */
  pairBluetooth: (mac: string) => Promise<PairResult>;
}

/** Minimal HTML-entity escaping for the untrusted strings the page interpolates — the agent's name,
 * a server-sent `lastError`, a Bluetooth device name/MAC. Without it a crafted string could inject
 * markup into the page. */
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

function card(inner: string): string {
  return `<div class="card">${inner}</div>`;
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
  .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); margin-bottom: 1rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; }
  input { width: 100%; padding: .5rem; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 1rem; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin: 1rem 0; }
  .ok { color: #0a7d28; margin: 1rem 0; }
  .muted { color: #555; }
  ul.devices { list-style: none; padding: 0; margin: 1rem 0 0; }
  ul.devices li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 0; border-top: 1px solid #eee; }
  ul.devices form { margin: 0; }
  ul.devices button { margin-top: 0; }
  dl { margin: 0; }
  dt { font-weight: 600; margin-top: .75rem; }
</style>
</head>
<body><main>${body}</main></body>
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

/** The box-local Bluetooth pairing card: a Scan button, the last scan's found list (each with a Pair
 * button), and the last pair outcome. `scanned === undefined` means "not scanned yet" (no list shown);
 * an empty array means a scan that found nothing. */
function bluetoothCard(state: {
  scanned?: DiscoveredDevice[];
  pair?: { mac: string; result: PairResult };
}): string {
  let found = "";
  if (state.scanned !== undefined) {
    if (state.scanned.length === 0) {
      found = `<p class="muted">No Bluetooth printers found. Put the printer in pairing mode and scan again.</p>`;
    } else {
      const items = state.scanned
        .map((d) => {
          const mac = escapeHtml(d.localKey ?? "");
          const label = escapeHtml(d.name ?? d.localKey ?? "unknown device");
          return `<li><span>${label} <span class="muted">${mac}</span></span>
<form method="post" action="/bluetooth/pair"><input type="hidden" name="mac" value="${mac}"><button type="submit">Pair</button></form></li>`;
        })
        .join("");
      found = `<ul class="devices">${items}</ul>`;
    }
  }
  let outcome = "";
  if (state.pair !== undefined) {
    outcome = state.pair.result.ok
      ? `<p class="ok">Paired ${escapeHtml(state.pair.result.localKey ?? state.pair.mac)}.</p>`
      : `<p class="error">Could not pair ${escapeHtml(state.pair.mac)}: ${escapeHtml(state.pair.result.error ?? "pairing failed")}</p>`;
  }
  return `<h2>Bluetooth printers</h2>
<p>Pair a Bluetooth printer to this box, then choose it in the dashboard.</p>
<form method="post" action="/bluetooth/scan"><button type="submit">Scan for printers</button></form>
${found}${outcome}`;
}

export function createSetupApp(deps: SetupDeps): Hono {
  const app = new Hono();

  const mainCard = async (): Promise<string> => {
    const status = deps.status();
    if (status.phase === "unconfigured") {
      const saved = await deps.config();
      return formCard(deps, saved?.serverUrl ?? "");
    }
    // Past the form, the phase's own card names the server it follows, so an env-locked agent needs no
    // separate address line. The guard rules out `unconfigured`, but `AgentStatus` is one interface so
    // the narrowing does not reshape the object type — hence the assertion of the proven phase.
    const connected = status as AgentStatus & { phase: Exclude<AgentPhase, "unconfigured"> };
    return statusCard(connected);
  };

  const renderRoot = async (bt: {
    scanned?: DiscoveredDevice[];
    pair?: { mac: string; result: PairResult };
  }): Promise<string> => {
    return layout(card(await mainCard()) + card(bluetoothCard(bt)));
  };

  app.get("/", async (c) => c.html(await renderRoot({})));

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
        layout(card(formCard(deps, rawUrl, `That is not a valid http(s) address: ${rawUrl}`))),
        400,
      );
    }
    await deps.saveConfig({ serverUrl: origin, name: rawName === "" ? deps.defaultName : rawName });
    return c.redirect("/", 303);
  });

  app.post("/bluetooth/scan", async (c) => {
    const scanned = await deps.scanBluetooth();
    return c.html(await renderRoot({ scanned }));
  });

  app.post("/bluetooth/pair", async (c) => {
    const form = await c.req.parseBody();
    const mac = typeof form.mac === "string" ? form.mac.trim() : "";
    if (mac === "") {
      return c.html(await renderRoot({}), 400);
    }
    const result = await deps.pairBluetooth(mac);
    return c.html(await renderRoot({ pair: { mac, result } }));
  });

  app.get("/status.json", (c) => c.json(deps.status()));

  return app;
}
