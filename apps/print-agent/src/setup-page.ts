import { getConnInfo } from "@hono/node-server/conninfo";
import type { AgentPhase, AgentSetupSnapshot, AgentStatus } from "@waitron/print-agent";
import { Hono, type Context } from "hono";
import { isIP } from "node:net";
import type { BluetoothAvailability } from "./bluetooth-availability.js";

export interface SetupDeps {
  snapshot: () => Promise<AgentSetupSnapshot>;
  configure: (input: { serverUrl: string; name: string }) => Promise<boolean>;
  beginNetworkReset: () => Promise<boolean>;
  cancelNetworkReset: () => Promise<boolean>;
  /** True when `WAITRON_SERVER_URL` pins the address: the form is read-only and POST is refused. */
  envLocked: boolean;
  defaultName: string;
  now: () => number;
  bluetooth?: () => BluetoothAvailability | undefined;
}

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

function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const withoutZone = address.split("%", 1)[0]!;
  if (withoutZone === "::1") return true;
  const ipv4 = withoutZone.toLowerCase().startsWith("::ffff:")
    ? withoutZone.slice("::ffff:".length)
    : withoutZone;
  return isIP(ipv4) === 4 && ipv4.split(".")[0] === "127";
}

function networkRefused(snapshot: AgentSetupSnapshot, c: Context): boolean {
  return snapshot.joined && !snapshot.outOfTouch && !isLoopback(peerAddress(c));
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
  .muted { color: #555; }
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

function statusCard(status: AgentStatus & { phase: Exclude<AgentPhase, "unconfigured"> }): string {
  const server = escapeHtml(status.current ?? status.serverUrl ?? "the server");
  switch (status.phase) {
    case "pending": {
      const body =
        status.verificationCode !== undefined
          ? `<p>Waiting for approval — verification code <strong>${escapeHtml(status.verificationCode)}</strong></p>
<p class="muted">Match this number in the dashboard to accept the agent.</p>`
          : `<p>Waiting for approval.</p>`;
      return `<h1>Waitron print agent</h1>${body}`;
    }
    case "pairing_closed":
      return `<h1>Waitron print agent</h1>
<p>Ask the manager to open Add a print agent on the Printers page of the dashboard, then wait — this agent keeps asking.</p>`;
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
      return `<h1>Waitron print agent</h1>
<p>This agent was denied or revoked. Save the server address below and approve the new join in the dashboard.</p>`;
    case "unreachable": {
      const detail =
        status.lastError !== undefined
          ? `<p class="muted">${escapeHtml(status.lastError)}</p>`
          : "";
      return `<h1>Waitron print agent</h1>
<p>Can't reach ${server} right now — retrying.</p>${detail}`;
    }
  }
}

function connectionCard(status: AgentStatus): string {
  if (status.phase === "unconfigured") {
    return `<h1>Waitron print agent</h1><p>Checking the venue connection.</p>`;
  }
  return statusCard(status as AgentStatus & { phase: Exclude<AgentPhase, "unconfigured"> });
}

function countdown(resetAt: number, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((resetAt - now) / 1_000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function resetCard(snapshot: AgentSetupSnapshot, now: number): string {
  if (snapshot.resetAt === undefined) {
    return `<h2>Connect to another venue server</h2>
<p>This agent cannot reach its venue. Starting a reset gives the current server five minutes to recover before this agent forgets its approval.</p>
<form method="post" action="/network/reset"><button type="submit">Join a new network</button></form>`;
  }
  return `<h2>Network reset pending</h2>
<p>Resetting in ${countdown(snapshot.resetAt, now)}.</p>
<form method="post" action="/network/reset/cancel"><button type="submit">Cancel reset</button></form>`;
}

function renderRoot(deps: SetupDeps, snapshot: AgentSetupSnapshot): string {
  const sections: string[] = [];
  if (!snapshot.joined) {
    if (snapshot.status.phase !== "unconfigured")
      sections.push(card(connectionCard(snapshot.status)));
    sections.push(card(formCard(deps, snapshot.config?.serverUrl ?? "")));
  } else {
    sections.push(card(connectionCard(snapshot.status)));
    if (snapshot.outOfTouch) sections.push(card(resetCard(snapshot, deps.now())));
  }
  return layout(sections.join(""));
}

function forbidden(c: Context): Response {
  return c.text(
    "This setup page is not available on the network while the print agent is connected.",
    403,
  );
}

export function createSetupApp(deps: SetupDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const snapshot = await deps.snapshot();
    if (networkRefused(snapshot, c)) return forbidden(c);
    return c.html(renderRoot(deps, snapshot));
  });

  app.post("/setup", async (c) => {
    const snapshot = await deps.snapshot();
    if (networkRefused(snapshot, c)) return forbidden(c);
    if (snapshot.joined) return c.text("The print agent is already joined.", 409);
    if (deps.envLocked) {
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
    const configured = await deps.configure({
      serverUrl: origin,
      name: rawName === "" ? deps.defaultName : rawName,
    });
    if (!configured) return c.text("The print agent setup state changed. Try again.", 409);
    return c.redirect("/", 303);
  });

  app.post("/network/reset", async (c) => {
    const snapshot = await deps.snapshot();
    if (networkRefused(snapshot, c)) return forbidden(c);
    if (!snapshot.joined || !snapshot.outOfTouch || snapshot.resetAt !== undefined) {
      return c.text("A network reset is not available now.", 409);
    }
    if (!(await deps.beginNetworkReset())) {
      return c.text("The print agent setup state changed. Try again.", 409);
    }
    return c.redirect("/", 303);
  });

  app.post("/network/reset/cancel", async (c) => {
    const snapshot = await deps.snapshot();
    if (networkRefused(snapshot, c)) return forbidden(c);
    if (!snapshot.joined || snapshot.resetAt === undefined) {
      return c.text("There is no network reset to cancel.", 409);
    }
    if (!(await deps.cancelNetworkReset())) {
      return c.text("The print agent setup state changed. Try again.", 409);
    }
    return c.redirect("/", 303);
  });

  app.get("/status.json", async (c) => {
    const snapshot = await deps.snapshot();
    if (networkRefused(snapshot, c)) return forbidden(c);
    const bluetooth = deps.bluetooth?.();
    return c.json(bluetooth === undefined ? snapshot.status : { ...snapshot.status, bluetooth });
  });

  return app;
}
