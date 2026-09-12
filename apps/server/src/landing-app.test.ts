import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLandingApp } from "./landing-app.js";

function stateDirWithCa(): string {
  const d = mkdtempSync(join(tmpdir(), "waitron-land-"));
  mkdirSync(join(d, "tls"), { recursive: true });
  writeFileSync(
    join(d, "tls", "ca.crt"),
    "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
  );
  return d;
}

function stateDirWithoutCa(): string {
  return mkdtempSync(join(tmpdir(), "waitron-land-noca-"));
}

describe("landing app", () => {
  const log = { info() {}, warn() {}, error() {} } as never;

  it("serves the trust page at / without redirecting and without HSTS", async () => {
    const dir = stateDirWithCa();
    try {
      const app = buildLandingApp({
        stateDir: dir,
        reachUrls: ["https://waitron.local"],
        httpsUrl: "https://waitron.local",
        log,
      });
      const res = await app.request("http://waitron.local/");
      expect(res.status).toBe(200); // not a 3xx
      expect(res.headers.get("strict-transport-security")).toBeNull();
      // The download link points at the landing-local path, not /setup-api/ca.crt (which is HTTPS-only).
      expect(await res.text()).toContain('href="/ca.crt"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the CA at /ca.crt as an attachment", async () => {
    const dir = stateDirWithCa();
    try {
      const app = buildLandingApp({
        stateDir: dir,
        reachUrls: [],
        httpsUrl: "https://waitron.local",
        log,
      });
      const res = await app.request("http://waitron.local/ca.crt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/x-x509-ca-cert");
      expect(res.headers.get("content-disposition")).toContain("waitron-ca.crt");
      expect(await res.text()).toContain("BEGIN CERTIFICATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The page's "Continue to the secure site" hand-off — the whole reason the landing page carries
  // `httpsUrl`: the visitor follows it AFTER trusting the CA, escaping the HTTPS interstitial.
  it("renders the HTTPS hand-off link", async () => {
    const dir = stateDirWithCa();
    try {
      const app = buildLandingApp({
        stateDir: dir,
        reachUrls: ["https://waitron.local"],
        httpsUrl: "https://waitron.local:8080",
        log,
      });
      const html = await (await app.request("http://waitron.local/")).text();
      expect(html).toContain('href="https://waitron.local:8080"');
      expect(html).toMatch(/Continue to the secure site/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Operator-cert box: no box CA. The page omits the download link (shows the operator-cert note) and
  // the download route 404s `no_box_ca` — the same all-errors-collapse posture as discovery-api.
  it("omits the download link and 404s /ca.crt when there is no box CA", async () => {
    const dir = stateDirWithoutCa();
    try {
      const app = buildLandingApp({
        stateDir: dir,
        reachUrls: [],
        httpsUrl: "https://waitron.local",
        log,
      });
      const page = await (await app.request("http://waitron.local/")).text();
      expect(page).not.toContain('href="/ca.crt"');
      expect(page).toMatch(/operator-supplied/i);

      const res = await app.request("http://waitron.local/ca.crt");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "no_box_ca" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A non-ENOENT ca.crt read failure (a `ca.crt` that is a DIRECTORY → EISDIR) still answers 404
  // no_box_ca to the LAN caller — no fs detail leaked — but logs one line, unlike ordinary ENOENT.
  // Uses a real function logger (not the object stub above) so the log call is exercised.
  it("logs a non-ENOENT ca.crt read failure and still answers 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-land-eisdir-"));
    mkdirSync(join(dir, "tls", "ca.crt"), { recursive: true });
    try {
      const events: { level: string; event: string }[] = [];
      const app = buildLandingApp({
        stateDir: dir,
        reachUrls: [],
        httpsUrl: "https://waitron.local",
        log: ((level: string, event: string) => events.push({ level, event })) as never,
      });
      const res = await app.request("http://waitron.local/ca.crt");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "no_box_ca" });
      expect(events.some((e) => e.level === "error" && e.event === "landing.ca_read_failed")).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("serves the same guide and download paths before and after an HTTPS upgrade", async () => {
  const dir = stateDirWithCa();
  try {
    const app = buildLandingApp({
      stateDir: dir,
      reachUrls: [],
      httpsUrl: "https://waitron.local",
      log: () => {},
    });
    const page = await app.request("http://waitron.local/setup/trust");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Connect to this Waitron box");
    const cert = await app.request("http://waitron.local/setup-api/ca.crt");
    expect(cert.status).toBe(200);
    expect(cert.headers.get("cache-control")).toBe("no-store");
    expect(await cert.text()).toContain("BEGIN CERTIFICATE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
