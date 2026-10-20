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

it("repairs an empty same-origin action and continues only after the response flush", async () => {
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
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "connection.refused" });
  await expect(readFile(join(f.stateDir, "tls/server.key"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
