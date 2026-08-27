import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { it, expect, afterEach } from "vitest";
import { mountDiscovery } from "./discovery-api.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function stateDirWithCa(
  pem = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
) {
  const d = await mkdtemp(join(tmpdir(), "disc-"));
  dirs.push(d);
  await mkdir(join(d, "tls"), { recursive: true });
  await writeFile(join(d, "tls", "ca.crt"), pem);
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

it("404s the CA download when the box has no CA (operator cert)", async () => {
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
  expect(html).toMatch(/own certificate|operator-supplied/i);
});

// Beyond the six brief tests: the box with no LAN address (loopback-only) has a null `qrTarget`, so
// the trust page must fall back to a "no QR" note and never call `renderQrSvg`. Pure injection
// (`listIpv4: () => []`), not a real-network probe — so it closes the null-QR branch the six tests,
// which always inject an address, leave for the aggregate.
it("trust page shows a no-QR note (and skips the renderer) when there is no LAN address", async () => {
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
  expect(html).toMatch(/no QR code|No local network address/i);
});

// A non-ENOENT ca.crt read failure (misconfiguration) must still answer 404 no_box_ca to the LAN
// caller — no fs detail leaked — but log one line, unlike the ordinary ENOENT. Mirrors
// media-api.test.ts's non-ENOENT case: a `ca.crt` that is a DIRECTORY makes `readFile` throw EISDIR.
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
