import { buildLandingApp } from "./landing-app.js";
import { mountDiscovery } from "./discovery-api.js";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";
import { mountConnectionBootstrap } from "./connection-bootstrap.js";

const now = new Date("2026-10-21T00:00:00Z");
let material: SelfSignedMaterial;
beforeAll(() => {
  material = mintSelfSignedServerCert({
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
    now,
  });
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(healthy = false) {
  const stateDir = await mkdtemp(join(tmpdir(), "public-connection-"));
  dirs.push(stateDir);
  await mkdir(join(stateDir, "tls"));
  for (const [name, bytes] of Object.entries({
    "ca.crt": material.caCertPem,
    "ca.key": material.caKeyPem,
    "server.crt": material.serverCertPem,
    ...(healthy ? { "server.key": material.serverKeyPem } : {}),
  }))
    await writeFile(join(stateDir, "tls", name), bytes);
  await writeFile(join(stateDir, "secrets.env"), "retained vault material");
  const onRepaired = vi.fn(async () => {});
  const app = new Hono();
  mountConnectionBootstrap(app, {
    stateDir,
    hostnames: ["waitron.local", "localhost"],
    listIpv4: () => [],
    now: () => now,
    origins: ["http://waitron.local:8080", "http://127.0.0.1:8080"],
    reachUrls: ["https://waitron.local:8080"],
    onRepaired,
    log: () => {},
  });
  return { stateDir, app, onRepaired };
}
const url = "http://waitron.local:8080/setup-api/connection/repair";
const allowed = { Origin: "http://waitron.local:8080" };

it("holds public HTTP after repair and continues only after the explicit continuation response flush", async () => {
  const f = await fixture();
  const outgoing = new EventEmitter();
  const response = await f.app.request(url, { method: "POST", headers: allowed }, { outgoing });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ state: "healthy", trust: "retained" });
  expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(material.caCertPem);
  expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe("retained vault material");
  expect(f.onRepaired).not.toHaveBeenCalled();
  outgoing.emit("finish");
  expect(f.onRepaired).not.toHaveBeenCalled();
  const continued = new EventEmitter();
  const reply = await f.app.request(
    url.replace("/repair", "/continue"),
    { method: "POST", headers: allowed },
    { outgoing: continued },
  );
  expect(reply.status).toBe(200);
  expect(await reply.json()).toEqual({ restarting: true });
  expect(f.onRepaired).not.toHaveBeenCalled();
  continued.emit("finish");
  await vi.waitFor(() => expect(f.onRepaired).toHaveBeenCalledOnce());
});

it.each([
  ["missing origin", url, {}],
  ["null origin", url, { Origin: "null" }],
  ["foreign origin", url, { Origin: "https://elsewhere.example" }],
  ["wrong scheme", url, { Origin: "https://waitron.local:8080" }],
  ["foreign host", "http://elsewhere.example:8080/setup-api/connection/repair", allowed],
  ["wrong port", "http://waitron.local:8081/setup-api/connection/repair", allowed],
  ["host header", url, { ...allowed, Host: "elsewhere.example:8080" }],
  ["query", `${url}?key=private`, allowed],
  ["empty query", `${url}?`, allowed],
  ["cookie", url, { ...allowed, Cookie: "owner=private" }],
  ["authorization", url, { ...allowed, Authorization: "Bearer private" }],
  ["content type", url, { ...allowed, "Content-Type": "application/json" }],
  ["forwarded scheme", url, { Origin: "https://waitron.local:8080", "X-Forwarded-Proto": "https" }],
] as const)("refuses %s without changing certificate files", async (_name, target, headers) => {
  const f = await fixture();
  const response = await f.app.request(target, { method: "POST", headers });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "connection.refused" });
  await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(material.caCertPem);
  expect(f.onRepaired).not.toHaveBeenCalled();
});

it.each(["password=private", '{"privateKey":"private"}', " "])(
  "refuses actual body bytes %s even without a declared content length",
  async (body) => {
    const f = await fixture();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const request = new Request(url, {
      method: "POST",
      headers: allowed,
      body: stream,
      duplex: "half",
    } as RequestInit);
    const response = await f.app.request(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "connection.refused" });
    await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("a healthy repeat preserves every PEM and never rotates trust", async () => {
  const f = await fixture(true);
  const response = await f.app.request(url, { method: "POST", headers: allowed });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "healthy", trust: "retained" });
  for (const [name, bytes] of Object.entries({
    "ca.crt": material.caCertPem,
    "ca.key": material.caKeyPem,
    "server.crt": material.serverCertPem,
    "server.key": material.serverKeyPem,
  }))
    expect(await readFile(join(f.stateDir, "tls", name), "utf8")).toBe(bytes);
});

it("serves only public status and validated CA bytes", async () => {
  const f = await fixture();
  const response = await f.app.request("http://waitron.local:8080/setup/connection");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain("repair-required");
  expect(html).not.toContain("PRIVATE KEY");
  for (const path of ["/ca.crt", "/setup-api/ca.crt"]) {
    const ca = await f.app.request(path);
    expect(ca.status).toBe(200);
    expect(await ca.text()).toBe(material.caCertPem);
  }
  await writeFile(join(f.stateDir, "tls/ca.crt"), "not a public certificate");
  expect((await f.app.request("/ca.crt")).status).toBe(404);
  for (const path of ["/setup-api/first-setup/resolution", "/tls/ca.key", "/tls/repair-archive"]) {
    expect((await f.app.request(path)).status).toBe(404);
  }
  expect((await f.app.request(url)).status).toBe(404);
});

it("operator TLS refuses box repair without modifying the managed material", async () => {
  const f = await fixture();
  const app = new Hono();
  mountConnectionBootstrap(app, {
    stateDir: f.stateDir,
    hostnames: ["waitron.local", "localhost"],
    listIpv4: () => [],
    now: () => now,
    origins: ["http://waitron.local:8080"],
    reachUrls: ["https://waitron.local:8080"],
    onRepaired: f.onRepaired,
    log: () => {},
    repairAllowed: false,
  });
  const response = await app.request(url, { method: "POST", headers: allowed });
  expect((await app.request("/ca.crt")).status).toBe(404);
  expect(await (await app.request("/setup/connection")).text()).not.toContain("BEGIN CERTIFICATE");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "connection.refused" });
  await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("offers one public repair action, retains installed trust and omits private controls", async () => {
  const { app } = await fixture();
  const html = await (await app.request("http://waitron.local:8080/setup/connection")).text();
  expect(html).toContain('id="connection-repair"');
  expect(html).toContain("Set up secure connection");
  expect(html).toContain("Keep your installed Waitron certificate.");
  expect(html).not.toContain("Remove any old Waitron certificate");
  expect(html).not.toMatch(/<(input|textarea|select|form)\b/);
});

it("healthy public help offers HTTPS continuation without a rotation button", async () => {
  const { app } = await fixture(true);
  const html = await (await app.request("/setup/connection")).text();
  expect(html).toContain("Certificate ready. Follow the instructions, then reconnect.");
  expect(html).toContain('href="https://waitron.local:8080"');
  expect(html).not.toContain('id="connection-repair"');
});

it("uses the explicit page language before browser preferences, without accepting it as repair input", async () => {
  const { app, stateDir } = await fixture();
  const page = await app.request("http://waitron.local:8080/setup/connection?lang=es", {
    headers: { "Accept-Language": "en-GB" },
  });
  expect(await page.text()).toContain('<html lang="es">');
  const fallback = await app.request("/setup/connection", {
    headers: { "Accept-Language": "fr-FR,es-ES;q=0.9,en;q=0.8" },
  });
  expect(await fallback.text()).toContain('<html lang="es">');
  const refused = await app.request(`${url}?lang=es`, { method: "POST", headers: allowed });
  expect(refused.status).toBe(403);
  await expect(readFile(join(stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("offers a continuation retry after a failed post-repair handoff without rotating healthy TLS", async () => {
  const f = await fixture();
  f.onRepaired.mockRejectedValueOnce(new Error("private continuation details"));
  expect((await f.app.request(url, { method: "POST", headers: allowed })).status).toBe(200);
  const first = new EventEmitter();
  expect(
    (
      await f.app.request(
        url.replace("/repair", "/continue"),
        { method: "POST", headers: allowed },
        { outgoing: first },
      )
    ).status,
  ).toBe(200);
  first.emit("finish");
  await vi.waitFor(() => expect(f.onRepaired).toHaveBeenCalledOnce());
  const ca = await readFile(join(f.stateDir, "tls/ca.crt"), "utf8");
  const page = await (await f.app.request("/setup/connection")).text();
  expect(page).toContain('id="connection-reconnect"');
  expect(page).toContain(">Reconnect</button>");
  expect(page).not.toContain("private continuation details");
  const retry = new EventEmitter();
  expect(
    (
      await f.app.request(
        url.replace("/repair", "/continue"),
        { method: "POST", headers: allowed },
        { outgoing: retry },
      )
    ).status,
  ).toBe(200);
  retry.emit("finish");
  await vi.waitFor(() => expect(f.onRepaired).toHaveBeenCalledTimes(2));
  expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(ca);
});

it.each(
  (["bootstrap", "discovery", "landing"] as const).flatMap((surface) =>
    (["LF", "CRLF"] as const).map((ending) => ({ surface, ending })),
  ),
)(
  "$surface downloads only public certificate bytes from $ending PEM with a private key",
  async ({ surface, ending }) => {
    const f = await fixture(true);
    const publicCert =
      ending === "LF" ? material.caCertPem.replaceAll("\r\n", "\n") : material.caCertPem;
    const combined = publicCert + material.caKeyPem;
    await writeFile(join(f.stateDir, "tls/ca.crt"), combined);
    const discovery = new Hono();
    mountDiscovery(
      discovery,
      {
        stateDir: f.stateDir,
        hostname: "waitron.local",
        port: 8080,
        secure: true,
        listIpv4: () => [],
      },
      () => {},
    );
    const landing = buildLandingApp({
      stateDir: f.stateDir,
      reachUrls: ["https://waitron.local:8080"],
      httpsUrl: "https://waitron.local:8080",
      log: () => {},
    });
    const app = { bootstrap: f.app, discovery, landing }[surface];
    for (const path of ["/ca.crt", "/setup-api/ca.crt"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const bytes = await response.text();
      expect(bytes).not.toContain("PRIVATE KEY");
      expect(bytes).toBe(publicCert);
    }
    expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(combined);
  },
);

it.each(["missing-origin", "foreign-origin", "query", "body", "cookie"])(
  "refuses %s on explicit continuation without changing files or calling admission",
  async (kind) => {
    const f = await fixture();
    const headers: Record<string, string> = kind === "missing-origin" ? {} : { ...allowed };
    if (kind === "foreign-origin") headers.Origin = "http://other.example";
    if (kind === "cookie") headers.Cookie = "owner=private";
    const target = url.replace("/repair", "/continue") + (kind === "query" ? "?key=private" : "");
    const response = await f.app.request(target, {
      method: "POST",
      headers,
      ...(kind === "body" ? { body: "private-key=private" } : {}),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "connection.refused" });
    await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(f.onRepaired).not.toHaveBeenCalled();
  },
);

it("does not continue to protected admission while a leaf is still missing", async () => {
  const f = await fixture();
  const outgoing = new EventEmitter();
  const response = await f.app.request(
    url.replace("/repair", "/continue"),
    { method: "POST", headers: allowed },
    { outgoing },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "connection.repair_failed" });
  outgoing.emit("finish");
  expect(f.onRepaired).not.toHaveBeenCalled();
});

it.each(["repair reply", "public page"])(
  "%s includes only the parsed public certificate from a combined PEM",
  async (surface) => {
    const f = await fixture(true);
    const combined = material.caCertPem + material.caKeyPem;
    await writeFile(join(f.stateDir, "tls/ca.crt"), combined);
    const response =
      surface === "repair reply"
        ? await f.app.request(url, { method: "POST", headers: allowed })
        : await f.app.request("/setup/connection");
    expect(response.status).toBe(200);
    const content = await response.text();
    expect(content).not.toContain("PRIVATE KEY");
    if (surface === "repair reply") {
      const result = JSON.parse(content);
      expect(result.caCertificate).toBe(material.caCertPem);
      expect(Object.keys(result).sort()).toEqual([
        "caAvailable",
        "caCertificate",
        "continuationRequired",
        "fingerprint",
        "state",
        "trust",
      ]);
    }
    expect(await readFile(join(f.stateDir, "tls/ca.crt"), "utf8")).toBe(combined);
  },
);
