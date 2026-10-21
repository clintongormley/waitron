import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ALL_MODULES } from "@waitron/composition";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { RC2_CANDIDATE } from "@waitron/fiscal-verifactu/test/openssl-certificates.js";
import { mountSetup } from "./setup-api.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { request } from "../test/first-fiscal.js";
import { mountGuidePages } from "./guide-pages.js";

const authority = makeAuthority();
const good = authority.issue();
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
afterEach(async () => {
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
    const venue = {
      ...request,
      location: { ...request.location, operationDescription: "Restaurant" },
    };
    const claim = owned
      ? await host.owner.claimFirstSetup(
          { environment: "production", request: venue },
          randomBytes(32).toString("base64url"),
        )
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
