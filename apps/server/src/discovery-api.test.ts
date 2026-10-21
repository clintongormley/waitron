import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { it, expect, afterEach, beforeAll } from "vitest";
import { mountDiscovery } from "./discovery-api.js";

import { mintSelfSignedServerCert, type SelfSignedMaterial } from "./self-signed-cert.js";
let material: SelfSignedMaterial;
beforeAll(() => {
  material = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["waitron.local"],
    ipAddresses: ["127.0.0.1", "192.168.1.5"],
  });
});
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function stateDirWithCa(pem: string = material.caCertPem) {
  const d = await mkdtemp(join(tmpdir(), "disc-"));
  dirs.push(d);
  await mkdir(join(d, "tls"), { recursive: true });
  await writeFile(join(d, "tls", "ca.crt"), pem);
  if (pem === material.caCertPem) await writeFile(join(d, "tls", "ca.key"), material.caKeyPem);
  return d;
}
function appFor(stateDir: string, over: Partial<Parameters<typeof mountDiscovery>[1]> = {}) {
  const app = new Hono();
  mountDiscovery(
    app,
    {
      stateDir,
      hostname: "waitron.local",
      port: 8080,
      secure: true,
      listIpv4: () => ["192.168.1.5"],
      renderQrSvg: async (t) => `<svg data-qr="${t}"></svg>`,
      ...over,
    },
    () => {},
  );
  return app;
}

it("serves the CA as a downloadable attachment", async () => {
  const app = appFor(await stateDirWithCa());
  const res = await app.request("/setup-api/ca.crt");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-x509-ca-cert");
  expect(res.headers.get("content-disposition")).toContain("waitron-ca.crt");
  expect(await res.text()).toContain("BEGIN CERTIFICATE");
});

it("404s the CA download when the box has no CA", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca-"));
  dirs.push(d);
  const res = await appFor(d).request("/setup-api/ca.crt");
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: "no_box_ca" });
});

it("publishes discovery JSON with addresses, urls and the qr target", async () => {
  const res = await appFor(await stateDirWithCa()).request("/setup-api/discovery");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    hostname: "waitron.local",
    addresses: ["192.168.1.5"],
    hostnameUrl: "https://waitron.local:8080",
    ipUrls: ["https://192.168.1.5:8080"],
    qrTarget: "https://192.168.1.5:8080",
    caDownloadAvailable: true,
    caDownloadPath: "/setup-api/ca.crt",
  });
});

it("reports caDownloadAvailable:false when there is no box CA", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca2-"));
  dirs.push(d);
  expect(await (await appFor(d).request("/setup-api/discovery")).json()).toMatchObject({
    caDownloadAvailable: false,
  });
});

it("renders a trust page with the CA link and the inline QR", async () => {
  const res = await appFor(await stateDirWithCa()).request("/setup/trust");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("/setup-api/ca.crt");
  expect(html).toContain('data-qr="https://192.168.1.5:8080"'); // the injected QR svg
  expect(html).toMatch(/iOS/); // per-OS steps present
});

it("trust page notes the operator-cert case instead of a download when no box CA", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca3-"));
  dirs.push(d);
  const html = await (await appFor(d).request("/setup/trust")).text();
  expect(html).toMatch(/own certificate|installer supplied/i);
});

// A box with no LAN address has a null `qrTarget`, so the trust page omits the QR section entirely,
// without a line explaining the absence.
it("trust page omits the QR section (and skips the renderer) when there is no LAN address", async () => {
  let rendered = 0;
  const app = appFor(await stateDirWithCa(), {
    listIpv4: () => [],
    renderQrSvg: async (t) => {
      rendered++;
      return `<svg data-qr="${t}"></svg>`;
    },
  });
  const html = await (await app.request("/setup/trust")).text();
  expect(rendered).toBe(0);
  expect(html).not.toContain("data-qr=");
  expect(html).not.toContain("Open this page on another device");
  expect(html).not.toContain("<figure>");
  // And no line apologising for the absence — the reader never knew a QR was on offer.
  expect(html).not.toMatch(/no QR/i);
});

// A non-ENOENT ca.crt read failure still answers 404 no_box_ca with no fs detail, but logs one line.
// A `ca.crt` that is a directory makes readFile throw EISDIR.
it("logs a non-ENOENT ca.crt read failure and still answers 404 no_box_ca", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-eisdir-"));
  dirs.push(d);
  await mkdir(join(d, "tls", "ca.crt"), { recursive: true });
  const events: { level: string; event: string }[] = [];
  const app = new Hono();
  mountDiscovery(
    app,
    {
      stateDir: d,
      hostname: "waitron.local",
      port: 8080,
      secure: true,
      listIpv4: () => ["192.168.1.5"],
      renderQrSvg: async (t) => `<svg data-qr="${t}"></svg>`,
    },
    (level, event) => events.push({ level, event }),
  );
  const res = await app.request("/setup-api/ca.crt");
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: "no_box_ca" });
  expect(events.some((e) => e.level === "error" && e.event === "setup.ca_read_failed")).toBe(true);
});

it("serves the landing certificate path as an alias on the discovery app", async () => {
  const app = appFor(await stateDirWithCa());
  const res = await app.request("https://waitron.local/ca.crt");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-x509-ca-cert");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toContain("BEGIN CERTIFICATE");
});

it("mirrors public repair help on HTTPS and accepts only an empty same-origin action", async () => {
  const stateDir = await stateDirWithCa();
  const app = appFor(stateDir);
  const page = await app.request("https://waitron.local:8080/setup/connection", {
    headers: { "Accept-Language": "es-ES,en;q=0.8" },
  });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<html lang="es">');
  const refused = await app.request("https://waitron.local:8080/setup-api/connection/repair", {
    method: "POST",
  });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: "connection.refused" });
  const result = await app.request("https://waitron.local:8080/setup-api/connection/repair", {
    method: "POST",
    headers: { Origin: "https://waitron.local:8080" },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ state: "healthy", caAvailable: true });
  expect((await app.request("/setup-api/discovery")).status).toBe(200);
  expect((await app.request("/")).status).toBe(404);
});

it("withholds malformed and non-CA certificate downloads and availability", async () => {
  const app = appFor(await stateDirWithCa("unusable public certificate"));
  for (const path of ["/ca.crt", "/setup-api/ca.crt"]) {
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "no_box_ca" });
  }
  expect(await (await app.request("/setup-api/discovery")).json()).toMatchObject({
    caDownloadAvailable: false,
  });
  expect(await (await app.request("/setup/trust")).text()).not.toContain(
    'href="/setup-api/ca.crt"',
  );
});

it("permits the configured localhost and loopback HTTPS aliases without trusting request names", async () => {
  const app = appFor(await stateDirWithCa(), {
    connectionHostnames: ["waitron.local", "localhost"],
  });
  for (const host of ["localhost", "127.0.0.1"]) {
    const origin = `https://${host}:8080`;
    const response = await app.request(`${origin}/setup-api/connection/repair`, {
      method: "POST",
      headers: { Origin: origin },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "healthy" });
  }
});
