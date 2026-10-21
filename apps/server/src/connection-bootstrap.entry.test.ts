import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest, get as httpsGet } from "node:https";
import { Hono } from "hono";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  mintSelfSignedServerCert,
  reissueServerLeaf,
  type SelfSignedMaterial,
} from "./self-signed-cert.js";
import { needsConnectionBootstrap, serveRecovery } from "./recovery-listener.js";
import { closeListener } from "./close-listener.js";
import { freePorts } from "./testing/free-ports.js";
import { startServerOrFirstSetupResolution } from "./first-setup-launch.js";
import { runEntry, type EntryDeps } from "./node-entry.js";
import { FRESH } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";

let material: SelfSignedMaterial;
beforeAll(() => {
  material = mintSelfSignedServerCert({
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
});
const dirs: string[] = [];
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(
  damage: "missing-key" | "malformed" | "mismatch" | "missing-ca" | "expired" = "missing-key",
) {
  const root = await mkdtemp(join(tmpdir(), "connection-entry-"));
  dirs.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await mkdir(venueDir);
  for (const [name, value] of Object.entries({
    "ca.crt": material.caCertPem,
    "ca.key": material.caKeyPem,
    "server.crt": material.serverCertPem,
    "server.key": material.serverKeyPem,
  }))
    await writeFile(join(stateDir, "tls", name), value);
  if (damage === "missing-key") await rm(join(stateDir, "tls/server.key"));
  if (damage === "malformed") await writeFile(join(stateDir, "tls/server.crt"), "malformed");
  if (damage === "mismatch") await writeFile(join(stateDir, "tls/server.key"), material.caKeyPem);
  if (damage === "expired")
    await writeFile(
      join(stateDir, "tls/server.crt"),
      reissueServerLeaf({
        caCertPem: material.caCertPem,
        caKeyPem: material.caKeyPem,
        hostnames: ["waitron.local", "localhost"],
        ipAddresses: ["127.0.0.1"],
        now: new Date("2020-01-01T00:00:00Z"),
      }).serverCertPem,
    );
  if (damage === "missing-ca") await rm(join(stateDir, "tls/ca.crt"));
  await writeFile(join(stateDir, "secrets.env"), "retained evidence");
  return { root, stateDir, venueDir };
}
function get(port: number, path: string) {
  return fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
}
function verifiedGet(
  port: number,
  path: string,
  ca: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      { hostname: "127.0.0.1", port, path, ca, servername: "waitron.local", timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTPS test deadline")));
  });
}
async function repair(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/setup-api/connection/repair`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  const continued = await fetch(`http://127.0.0.1:${port}/setup-api/connection/continue`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  expect(continued.status).toBe(200);
  await continued.body?.cancel();
  return result;
}

it.each(["missing-key", "malformed", "mismatch", "missing-ca", "expired"] as const)(
  "real recovery listeners expose only connection bootstrap for %s",
  async (damage) => {
    const f = await fixture(damage);
    const [port, landingPort] = (await freePorts(2)) as [number, number];
    const privateApp = new Hono();
    privateApp.get("/", (c) => c.text("PRIVATE RECOVERY LOG"));
    privateApp.post("/recovery-api/retry", (c) => c.json({ private: true }));
    const server = await serveRecovery(privateApp, {
      stateDir: f.stateDir,
      port,
      httpHost: "127.0.0.1",
      log: () => {},
      landing: {
        stateDir: f.stateDir,
        httpHost: "127.0.0.1",
        httpPort: port,
        landingPort,
        boxAddresses: [],
        tls: undefined,
      },
    });
    closes.push(() => closeListener(server));
    const page = await get(port, "/setup/connection");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("repair-required");
    expect(await (await get(port, "/")).text()).not.toContain("PRIVATE RECOVERY LOG");
    for (const path of [
      "/setup-api/status",
      "/setup-api/first-setup/resolution",
      "/api/me",
      "/tls/ca.key",
    ]) {
      expect((await get(port, path)).status).toBe(404);
    }
    expect(
      (await fetch(`http://127.0.0.1:${port}/recovery-api/retry`, { method: "POST" })).status,
    ).toBe(404);
    expect((await get(landingPort, "/setup/connection")).status).toBe(200);
    expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("retained evidence");
  },
);

it("direct repair re-enters resolution on verified HTTPS and the returned handle closes it", async () => {
  const f = await fixture();
  await writeFile(join(f.venueDir, "first-setup-claim.json"), "torn claim");
  const [port, landingPort] = (await freePorts(2)) as [number, number];
  const strict = vi.fn(async () => {
    throw new Error("strict start reached unresolved workspace");
  });
  const handle = await startServerOrFirstSetupResolution(
    {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: String(landingPort),
    },
    {},
    { startServer: strict },
  );
  closes.push(handle.close);
  expect((await get(port, "/setup/connection")).status).toBe(200);
  expect(await repair(port)).toMatchObject({ state: "healthy", trust: "retained" });
  await vi.waitFor(
    async () => {
      expect(strict).not.toHaveBeenCalled();
      expect(await verifiedGet(port, "/setup-api/first-setup/status", material.caCertPem)).toEqual({
        status: 200,
        body: JSON.stringify({ claimed: true, resolution: true }),
      });
    },
    { timeout: 10000 },
  );
  expect(strict).not.toHaveBeenCalled();
  expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(material.caCertPem);
  expect(await readFile(join(f.venueDir, "first-setup-claim.json"), "utf8")).toBe("torn claim");
  await expect(readFile(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  await handle.close();
  await expect(get(port, "/")).rejects.toThrow();
  await vi.waitFor(async () => {
    await expect(get(landingPort, "/")).rejects.toThrow();
  });
});

it.each(
  (["normal", "resolution", "recovery"] as const).flatMap((level) =>
    (["malformed", "expired", "mismatch", "missing-key"] as const).map((damage) => ({
      level,
      damage,
    })),
  ),
)(
  "supervised $level transport repairs $damage before any staged work or recovery counter mutation",
  async ({ level, damage }) => {
    const f = await fixture(damage);
    if (level === "resolution")
      await writeFile(join(f.venueDir, "first-setup-claim.json"), "retained torn claim");
    const [port] = (await freePorts(1)) as [number];
    const forbidden = vi.fn(async () => {
      throw new Error("protected work reached");
    });
    const exited = vi.fn();
    let handle: Awaited<ReturnType<typeof serveRecovery>> | undefined;
    const deps: EntryDeps = {
      ...f,
      args: [],
      baseEnv: {
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
      },
      readRecoveryState: async () => ({
        ...FRESH,
        level: level === "recovery" ? "recovery" : "normal",
      }),
      writeRecoveryState: forbidden,
      loadBoxEnv: forbidden,
      runStagedRestore: forbidden,
      runStagedReset: forbidden,
      clearReplacedDatabases: forbidden,
      assertNotAhead: forbidden,
      startServer: forbidden,
      serveRecovery: async (app, options) => {
        handle = await serveRecovery(app, options);
        closes.push(() => closeListener(handle!));
      },
      installShutdownHandlers: () => {},
      scheduleStayedUp: forbidden,
      log: () => {},
      exit: exited,
    };
    await runEntry(deps);
    expect((await get(port, "/setup/connection")).status).toBe(200);
    expect(forbidden).not.toHaveBeenCalled();
    expect(await repair(port)).toMatchObject({ state: "healthy" });
    await vi.waitFor(() => expect(exited).toHaveBeenCalledWith(0));
    expect(forbidden).not.toHaveBeenCalled();
    await expect(readFile(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("a failed direct continuation keeps public retry available and the next retry closes the replacement", async () => {
  const f = await fixture();
  const [port] = (await freePorts(1)) as [number];
  let starts = 0;
  const strict = vi.fn(async () => {
    if (++starts === 1) throw new Error("PRIVATE boot failure detail");
    const app = new Hono();
    app.get("/", (c) => c.text("admitted normal server"));
    const server = await serveRecovery(app, {
      stateDir: f.stateDir,
      port,
      httpHost: "127.0.0.1",
      log: () => {},
    });
    return { close: () => closeListener(server) };
  });
  const handle = await startServerOrFirstSetupResolution(
    {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
    },
    {},
    { startServer: strict },
  );
  closes.push(handle.close);
  await repair(port);
  await vi.waitFor(async () => {
    expect(strict).toHaveBeenCalledOnce();
    const page = await get(port, "/setup/connection");
    const body = await page.text();
    expect(body).toContain('data-connection-state="healthy"');
    expect(body).toContain(">Reconnect</button>");
    expect(body).not.toContain("PRIVATE boot failure detail");
  });
  await repair(port);
  await vi.waitFor(async () => {
    expect(await verifiedGet(port, "/", material.caCertPem)).toEqual({
      status: 200,
      body: "admitted normal server",
    });
  });
  expect(strict).toHaveBeenCalledTimes(2);
  await handle.close();
  await expect(verifiedGet(port, "/", material.caCertPem)).rejects.toThrow();
});

it("healthy recovery keeps its protected Retry on verified HTTPS and flushes its answer", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "tls/server.key"), material.serverKeyPem);
  const [port] = (await freePorts(1)) as [number];
  const onRetry = vi.fn(async () => {});
  const server = await serveRecovery(recoveryApp({ state: FRESH, logDir: f.stateDir, onRetry }), {
    stateDir: f.stateDir,
    port,
    httpHost: "127.0.0.1",
    log: () => {},
  });
  closes.push(() => closeListener(server));
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: "127.0.0.1",
        servername: "waitron.local",
        port,
        ca: material.caCertPem,
        method: "POST",
        path: "/recovery-api/retry",
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTPS test deadline")));
    req.end();
  });
  expect(result).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
  await vi.waitFor(() => expect(onRetry).toHaveBeenCalledWith("normal"));
});

it("real HTTP refuses forged origins and streamed private input while an empty action remains usable", async () => {
  const f = await fixture();
  const [port] = (await freePorts(1)) as [number];
  const server = await serveRecovery(new Hono(), {
    stateDir: f.stateDir,
    port,
    httpHost: "127.0.0.1",
    log: () => {},
  });
  closes.push(() => closeListener(server));
  const endpoint = `http://127.0.0.1:${port}/setup-api/connection/repair`;
  const forged: Record<string, string>[] = [
    {},
    { Origin: "null" },
    { Origin: "https://elsewhere.example" },
    { Origin: `https://127.0.0.1:${port}`, "X-Forwarded-Proto": "https" },
    { Origin: `http://127.0.0.1:${port}`, Authorization: "Bearer private" },
  ];
  for (const headers of forged) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ error: "connection.refused" });
  }
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("private input"));
      controller.close();
    },
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
    body,
    duplex: "half",
    signal: AbortSignal.timeout(5000),
  } as RequestInit);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "connection.refused" });
  await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await repair(port)).toMatchObject({ state: "healthy", trust: "retained" });
});

it("recovery respects operator TLS selected in the retained settings without exposing those paths", async () => {
  const f = await fixture();
  await writeFile(
    join(f.stateDir, "trading.env"),
    "WAITRON_TLS_CERT_FILE=/operator/server.crt\nWAITRON_TLS_KEY_FILE=/operator/server.key\n",
  );
  const [port] = (await freePorts(1)) as [number];
  const forbidden = async () => {
    throw new Error("protected work reached");
  };
  await runEntry({
    ...f,
    args: [],
    baseEnv: {
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
    },
    readRecoveryState: async () => ({ ...FRESH, level: "recovery" }),
    writeRecoveryState: forbidden,
    loadBoxEnv: forbidden,
    startServer: forbidden,
    serveRecovery: async (app, options) => {
      const server = await serveRecovery(app, options);
      closes.push(() => closeListener(server));
    },
    installShutdownHandlers: () => {},
    scheduleStayedUp: () => {},
    log: () => {},
    exit: () => {},
  });
  const response = await fetch(`http://127.0.0.1:${port}/setup-api/connection/repair`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
    signal: AbortSignal.timeout(5000),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "connection.refused" });
  await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["malformed", "mismatch", "missing-ca", "expired"] as const)(
  "direct %s repair returns through full admission to a verified HTTPS listener",
  async (damage) => {
    const f = await fixture(damage);
    const [port] = (await freePorts(1)) as [number];
    const strict = vi.fn(async () => {
      const app = new Hono();
      app.get("/", (c) => c.text("admitted after connection repair"));
      const server = await serveRecovery(app, {
        stateDir: f.stateDir,
        port,
        httpHost: "127.0.0.1",
        log: () => {},
      });
      return { close: () => closeListener(server) };
    });
    const handle = await startServerOrFirstSetupResolution(
      {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
      },
      {},
      { startServer: strict },
    );
    closes.push(handle.close);
    expect(strict).not.toHaveBeenCalled();
    const result = await repair(port);
    expect(result).toMatchObject({
      state: "healthy",
      trust: damage === "missing-ca" ? "new-required" : "retained",
    });
    const installedCa = await readFile(join(f.stateDir, "tls/ca.crt"), "utf8");
    await vi.waitFor(async () =>
      expect(await verifiedGet(port, "/", installedCa)).toEqual({
        status: 200,
        body: "admitted after connection repair",
      }),
    );
    expect(strict).toHaveBeenCalledOnce();
    if (damage === "missing-ca") {
      expect(installedCa).not.toBe(material.caCertPem);
      await expect(verifiedGet(port, "/", material.caCertPem)).rejects.toMatchObject({
        code: "CERT_SIGNATURE_FAILURE",
      });
    } else expect(installedCa).toBe(material.caCertPem);
    expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("retained evidence");
    await expect(readFile(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("actual HTTP rejects forged/private requests and archive reads before a legitimate empty repair", async () => {
  const f = await fixture();
  const [port] = (await freePorts(1)) as [number];
  const server = await serveRecovery(new Hono(), {
    stateDir: f.stateDir,
    port,
    httpHost: "127.0.0.1",
    log: () => {},
  });
  closes.push(() => closeListener(server));
  const origin = `http://127.0.0.1:${port}`;
  for (const [path, headers, body] of [
    ["", {}, undefined],
    ["", { Origin: "null" }, undefined],
    ["", { Origin: "http://foreign.example" }, undefined],
    ["", { Origin: `https://127.0.0.1:${port}`, "X-Forwarded-Proto": "https" }, undefined],
    ["?lang=en", { Origin: origin }, undefined],
    ["", { Origin: origin, Cookie: "owner=private" }, undefined],
    ["", { Origin: origin, Authorization: "Bearer private" }, undefined],
    ["", { Origin: origin }, "password=private"],
    ["", { Origin: origin }, JSON.stringify({ privateKey: "private" })],
  ] as [string, Record<string, string>, string | undefined][]) {
    const response = await fetch(`${origin}/setup-api/connection/repair${path}`, {
      method: "POST",
      headers,
      body,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "connection.refused" });
    expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(material.caCertPem);
    await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
  for (const path of [
    "/setup-api/connection/repair",
    "/tls/repair-archive",
    "/tls/ca.key",
    "/setup-api/first-setup/resolution",
  ])
    expect((await get(port, path)).status).toBe(404);
  await repair(port);
  expect((await get(port, "/tls/repair-archive")).status).toBe(404);
});

it("keeps public CA download and reload available after a discarded repair reply until explicit HTTPS continuation", async () => {
  const f = await fixture("missing-ca");
  const [port] = (await freePorts(1)) as [number];
  const strict = vi.fn(async () => {
    const app = new Hono();
    app.get("/", (c) => c.text("admitted after public certificate download"));
    const server = await serveRecovery(app, {
      stateDir: f.stateDir,
      port,
      httpHost: "127.0.0.1",
      log: () => {},
    });
    return { close: () => closeListener(server) };
  });
  const handle = await startServerOrFirstSetupResolution(
    {
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
    },
    {},
    { startServer: strict },
  );
  closes.push(handle.close);
  const repaired = await fetch(`http://127.0.0.1:${port}/setup-api/connection/repair`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  expect(repaired.status).toBe(200);
  await repaired.body?.cancel();
  await expect(get(port, "/ca.crt")).resolves.toMatchObject({ status: 200 });
  const ca = await (await get(port, "/ca.crt")).text();
  expect(ca).toContain("BEGIN CERTIFICATE");
  expect(ca).not.toContain("PRIVATE KEY");
  expect(ca).not.toBe(material.caCertPem);
  const reloaded = await get(port, "/setup/connection");
  expect(reloaded.status).toBe(200);
  expect(await reloaded.text()).toContain(">Reconnect</button>");
  expect(strict).not.toHaveBeenCalled();
  const continued = await fetch(`http://127.0.0.1:${port}/setup-api/connection/continue`, {
    method: "POST",
    headers: { Origin: `http://127.0.0.1:${port}` },
  });
  expect(continued.status).toBe(200);
  await continued.body?.cancel();
  await vi.waitFor(async () =>
    expect(await verifiedGet(port, "/", ca)).toEqual({
      status: 200,
      body: "admitted after public certificate download",
    }),
  );
  expect(strict).toHaveBeenCalledOnce();
  await expect(verifiedGet(port, "/", material.caCertPem)).rejects.toMatchObject({
    code: "CERT_SIGNATURE_FAILURE",
  });
});

it("keeps a hostname-valid box on HTTPS after its network address changes", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "tls/server.key"), material.serverKeyPem);
  const opts = {
    stateDir: f.stateDir,
    port: 0,
    httpHost: "127.0.0.1",
    log: vi.fn(),
    landing: {
      stateDir: f.stateDir,
      httpHost: "127.0.0.1",
      boxAddresses: ["192.168.1.20"],
      httpPort: 0,
      landingPort: 0,
    },
  };
  expect(await needsConnectionBootstrap(opts, {})).toBe(false);
  const server = await serveRecovery(
    new Hono().get("/private-probe", (c) => c.text("protected")),
    opts,
  );
  closes.push(() => closeListener(server));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
  expect(await verifiedGet(address.port, "/private-probe", material.caCertPem)).toEqual({
    status: 200,
    body: "protected",
  });
  expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(material.caCertPem);
  expect(await readFile(join(f.stateDir, "tls/server.crt"), "utf8")).toBe(material.serverCertPem);
});
