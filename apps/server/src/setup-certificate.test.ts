import { mkdtemp, readdir, rm } from "node:fs/promises";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { assertOtherFirstSetupAllowed } from "@waitron/provisioning";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { RC2_CANDIDATE } from "@waitron/fiscal-verifactu/test/openssl-certificates.js";
import { mountSetup } from "./setup-api.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { request } from "../test/first-fiscal.js";
import { mountGuidePages } from "./guide-pages.js";

const authority = makeAuthority();
const good = authority.issue({ organizationIdentifier: `VATES-${request.taxId}` });
const noKey = authority.issue({ withKey: false });
const expired = authority.issue({ notAfter: new Date("2020-01-01T00:00:00Z") });
const future = authority.issue({
  notBefore: new Date("2090-01-01T00:00:00Z"),
  notAfter: new Date("2091-01-01T00:00:00Z"),
});
const body = (pfx: Buffer, passphrase = good.passphrase) => ({
  pfxBase64: pfx.toString("base64"),
  passphrase,
  certKind: "sello",
});
const roots: string[] = [];
const sockets: TLSSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(["en", "es"])(
  "serves the setup certificate guide and its refusal section (%s)",
  async (language) => {
    const app = new Hono();
    mountGuidePages(app, {}, () => {});
    const response = await app.request(`/help/${language}/aeat-certificate`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="refusals"');
  },
);

it.each([false, true])(
  "setup readiness validates certificates before any test work (owned=%s)",
  async (owned) => {
    const root = await mkdtemp(join(tmpdir(), "a852-setup-"));
    roots.push(root);
    const stateDir = join(root, "state");
    const host = createFirstSetupModuleHost({
      stateDir,
      venueDir: join(root, "venue"),
      environment: {},
      modules: ALL_MODULES,
    });
    const venue = request;
    const claim = owned
      ? await host.owner.claimFirstSetup({ environment: "production", request: venue })
      : undefined;
    const runFiscalTest = vi.fn().mockResolvedValue({ status: "accepted" });
    const app = new Hono();
    const logs: unknown[] = [];
    mountSetup(
      app,
      { environment: "production", runFiscalTest, ...(owned ? { firstFiscal: host } : {}) },
      (...line) => {
        logs.push(line);
      },
    );
    const post = (aeatCert: unknown) =>
      app.request("/setup-api/fiscal-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(claim
            ? {
                "X-Waitron-Setup-Owner": claim.capability,
                "X-Waitron-Setup-Attempt": claim.state.attemptId,
                "X-Waitron-Setup-Revision": String(claim.state.revision),
                "X-Waitron-Setup-Generation": String(claim.state.ownerGeneration),
              }
            : {}),
        },
        body: JSON.stringify({ mode: "live", ...(owned ? {} : { venue }), aeatCert }),
      });
    const before = owned ? await host.store.read() : undefined;
    for (const [cert, field, reason] of [
      [body(good.pfx, "SYNTHETIC-wrong-passphrase"), "passphrase", "passphrase_wrong"],
      [body(Buffer.from("SYNTHETIC-non-certificate")), "pfxBase64", "unreadable"],
      [body(noKey.pfx), "pfxBase64", "no_private_key"],
      [{ ...RC2_CANDIDATE, certKind: "sello" }, "pfxBase64", "old_encryption"],
      [body(expired.pfx), "pfxBase64", "expired"],
      [body(future.pfx), "pfxBase64", "not_yet_valid"],
    ] as const) {
      const response = await post(cert);
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 422,
        body: { error: { code: "setup.certificate_refused", params: { field, reason } } },
      });
    }
    expect(runFiscalTest).not.toHaveBeenCalled();
    if (owned) {
      expect(await host.store.read()).toEqual(before);
      expect(
        (await readdir(stateDir)).some((name) => name.startsWith("fiscal-readiness-db-")),
      ).toBe(false);
    }
    expect(JSON.stringify(logs)).not.toContain("SYNTHETIC-wrong-passphrase");
    expect(JSON.stringify(logs)).not.toContain(good.pfx.toString("base64"));
    const response = await post(body(good.pfx));
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: { status: "accepted" },
    });
    expect(runFiscalTest).toHaveBeenCalledTimes(1);
  },
);

it("setup refuses a certificate issued to another tax number, and nothing is made", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-other-taxpayer-"));
  roots.push(root);
  const stateDir = join(root, "state");
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    environment: {},
    modules: ALL_MODULES,
  });
  const claim = await host.owner.claimFirstSetup({ environment: "production", request });
  const runFiscalTest = vi.fn().mockResolvedValue({ status: "accepted" });
  const app = new Hono();
  mountSetup(app, { environment: "production", runFiscalTest, firstFiscal: host }, () => {});
  const before = await host.store.read();
  const other = authority.issue({ organizationIdentifier: "VATES-B12345674" });
  const response = await app.request("/setup-api/fiscal-test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Waitron-Setup-Owner": claim.capability,
      "X-Waitron-Setup-Attempt": claim.state.attemptId,
      "X-Waitron-Setup-Revision": String(claim.state.revision),
      "X-Waitron-Setup-Generation": String(claim.state.ownerGeneration),
    },
    body: JSON.stringify({ mode: "live", aeatCert: body(other.pfx, other.passphrase) }),
  });
  expect({ status: response.status, body: await response.json() }).toEqual({
    status: 422,
    body: {
      error: {
        code: "setup.certificate_refused",
        params: {
          field: "pfxBase64",
          reason: "other_taxpayer",
          certificateTaxId: "B12345674",
          taxId: request.taxId,
        },
      },
    },
  });
  expect(runFiscalTest).not.toHaveBeenCalled();
  expect(await host.store.read()).toEqual(before);
  expect((await readdir(stateDir)).some((name) => name.startsWith("fiscal-readiness-db-"))).toBe(
    false,
  );
});

it("opens a certificate before reservation, with one local read at a time", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-certificate-inspect-"));
  roots.push(root);
  const stateDir = join(root, "state");
  let openingStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    openingStarted = resolve;
  });
  let releaseOpening!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseOpening = resolve;
  });
  const host = createFirstSetupModuleHost({
    stateDir,
    venueDir: join(root, "venue"),
    environment: {},
    modules: ALL_MODULES.map((module) => {
      const fiscal = module.fiscal;
      const secret = fiscal?.provisioningSecret;
      return fiscal && secret
        ? {
            ...module,
            fiscal: {
              ...fiscal,
              provisioningSecret: {
                ...secret,
                async inspect(raw: unknown) {
                  openingStarted();
                  await release;
                  return secret.inspect!(raw);
                },
              },
            },
          }
        : module;
    }),
  });
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "production",
      firstFiscal: host,
      firstSetup: {
        coordinator: host.coordinator,
        assertOtherAllowed: () => assertOtherFirstSetupAllowed(host.roots.venueDir, host.store),
      },
    },
    () => {},
  );
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  const post = (aeatCert: unknown, url = "https://box.test", origin = url) =>
    app.request(
      url + "/setup-api/certificate/inspect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ fiscalTerritory: "ES-common", aeatCert }),
      },
      url.startsWith("https:") ? { incoming: { socket } } : undefined,
    );

  expect((await post(body(good.pfx), "http://box.test")).status).toBe(403);
  expect((await post(body(good.pfx), "https://box.test", "https://other.test")).status).toBe(403);
  const large = await post({ ...body(good.pfx), pfxBase64: "A".repeat(256 * 1024) });
  expect(large.status).toBe(413);
  expect(await large.json()).toEqual({
    error: {
      code: "setup.certificate_refused",
      params: { field: "pfxBase64", reason: "too_large" },
    },
  });

  const opening = post(body(good.pfx));
  try {
    await started;
    let turnRan = false;
    void host.coordinator.run(async () => {
      turnRan = true;
    });
    await expect.poll(() => turnRan).toBe(true);
    const busy = await post(body(good.pfx));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: { code: "setup.certificate_refused", params: { field: "body", reason: "busy" } },
    });
  } finally {
    releaseOpening();
  }
  const response = await opening;
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ taxId: request.taxId, legalName: "WAITRON SL" });
  expect(await readdir(root)).toEqual([]);

  const refusal = await post(body(noKey.pfx));
  expect(refusal.status).toBe(422);
  expect(await refusal.json()).toEqual({
    error: {
      code: "setup.certificate_refused",
      params: { field: "pfxBase64", reason: "no_private_key" },
    },
  });
  await host.owner.claimFirstSetup({ environment: "production", request });
  const held = await post(body(good.pfx));
  expect(held.status).toBe(409);
  expect(await held.json()).toEqual({ error: { code: "setup.attempt_conflict", params: {} } });
});
