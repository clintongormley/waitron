import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_MODULES } from "@waitron/composition";
import { afterEach, beforeAll, expect, it } from "vitest";
import { request } from "../test/first-fiscal.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";

import { mintSelfSignedServerCert } from "./self-signed-cert.js";
let publicCa: string;
beforeAll(() => {
  publicCa = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1"],
  }).caCertPem;
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(frozen: "production" | "preproduction" | null) {
  const root = await mkdtemp(join(tmpdir(), "repair-bootstrap-"));
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  if (frozen === null) await writeFile(join(venueDir, "first-setup-claim.json"), "torn");
  else {
    const host = createFirstSetupModuleHost({
      stateDir,
      venueDir,
      modules: ALL_MODULES,
      environment: {},
    });
    await host.owner.claimFirstSetup(
      { environment: frozen, request },
      randomBytes(32).toString("base64url"),
    );
  }
  return { root, stateDir, venueDir };
}

it.each([
  { frozen: "production", ambient: "dev", environment: "production", developmentMode: {} },
  {
    frozen: "preproduction",
    ambient: "production",
    environment: "preproduction",
    developmentMode: {},
  },
  {
    frozen: null,
    ambient: "dev",
    environment: "preproduction",
    developmentMode: { developmentMode: true },
  },
  { frozen: null, ambient: "production", environment: "production", developmentMode: {} },
  {
    frozen: null,
    ambient: "damaged-configuration",
    environment: "preproduction",
    developmentMode: {},
  },
] as const)(
  "repair bootstrap keeps frozen $frozen metadata despite ambient $ambient without opening a database",
  async ({ frozen, ambient, environment, developmentMode }) => {
    const f = await fixture(frozen);
    const marker = await readFile(join(f.venueDir, "first-setup-claim.json"));
    const admitted = await resolveFirstSetupEntry(f, {
      WAITRON_ENV: ambient,
      WAITRON_SETUP_APP_DIR: "",
    });
    expect(admitted.kind).toBe("resolution");
    if (admitted.kind !== "resolution") throw new Error("expected repair");
    const response = await admitted.app.request("/setup-api/status");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      provisioned: false,
      environment,
      ...developmentMode,
      needs: ["first-setup-resolution"],
    });
    expect(await (await admitted.app.request("/setup-api/discovery")).json()).toEqual({
      caDownloadAvailable: false,
    });
    await mkdir(join(f.stateDir, "tls"));
    await writeFile(join(f.stateDir, "tls", "ca.crt"), publicCa);
    const discovery = await admitted.app.request("/setup-api/discovery");
    expect(discovery.headers.get("Cache-Control")).toBe("no-store");
    expect(await discovery.json()).toEqual({ caDownloadAvailable: true });
    expect((await admitted.app.request("/")).status).toBe(404);
    expect((await admitted.app.request("/setup-api/provision", { method: "POST" })).status).toBe(
      404,
    );
    expect(await readFile(join(f.venueDir, "first-setup-claim.json"))).toEqual(marker);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("the repair shell preserves API refusals and missing assets while serving its public downloads", async () => {
  const f = await fixture(null);
  const ui = join(f.root, "ui");
  await mkdir(join(ui, "setup-assets"), { recursive: true });
  await writeFile(join(ui, "index.html"), "<html>repair wizard</html>");
  await writeFile(join(ui, "setup-assets", "guide.txt"), "public instructions");
  const admitted = await resolveFirstSetupEntry(f, { WAITRON_SETUP_APP_DIR: ui });
  expect(admitted.kind).toBe("resolution");
  if (admitted.kind !== "resolution") throw new Error("expected repair");
  expect(await (await admitted.app.request("/")).text()).toBe("<html>repair wizard</html>");
  const download = await admitted.app.request("/setup-assets/guide.txt");
  expect(download.status).toBe(200);
  expect(download.headers.get("Content-Disposition")).toBe("attachment");
  expect(await download.text()).toBe("public instructions");
  const missing = await admitted.app.request("/setup-assets/missing.txt");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("Content-Disposition")).toBeNull();
  const navigation = await admitted.app.request("/manage", { headers: { Accept: "text/html" } });
  expect(navigation.status).toBe(302);
  expect(navigation.headers.get("Location")).toBe("/");
  for (const path of ["/assets/missing.js", "/setup-api/missing", "/api/missing"])
    expect((await admitted.app.request(path, { headers: { Accept: "text/html" } })).status).toBe(
      404,
    );
});

it.each(["not JSON", "null"])(
  "damaged module configuration %s leaves repair available without publication routes",
  async (configuration) => {
    const f = await fixture(null);
    await writeFile(join(f.stateDir, "modules.json"), configuration);
    const marker = await readFile(join(f.venueDir, "first-setup-claim.json"));
    const admitted = await resolveFirstSetupEntry(f, { WAITRON_ENV: "production" });
    expect(admitted.kind).toBe("resolution");
    if (admitted.kind !== "resolution") throw new Error("expected repair");
    expect((await admitted.app.request("/setup-api/first-setup/resolution")).status).toBe(200);
    for (const [path, method] of [
      ["/setup-api/first-setup/resolution/publication", "GET"],
      ["/setup-api/first-setup/resolution/finish", "POST"],
      ["/setup-api/provision", "POST"],
    ] as const)
      expect((await admitted.app.request(path, { method })).status).toBe(404);
    expect(await readFile(join(f.stateDir, "modules.json"), "utf8")).toBe(configuration);
    expect(await readFile(join(f.venueDir, "first-setup-claim.json"))).toEqual(marker);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("does not advertise a malformed retained CA on resolution discovery", async () => {
  const f = await fixture(null);
  await mkdir(join(f.stateDir, "tls"));
  await writeFile(join(f.stateDir, "tls/ca.crt"), "broken public certificate");
  const admission = await resolveFirstSetupEntry(f, {});
  expect(admission.kind).toBe("resolution");
  if (admission.kind !== "resolution") throw new Error("Expected resolution");
  const response = await admission.app.request("/setup-api/discovery");
  expect(await response.json()).toEqual({ caDownloadAvailable: false });
});
