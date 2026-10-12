import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loadKeyRing, tenantCredentials } from "@waitron/credentials";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { resolveEmailDelivery } from "./email-delivery.js";
import { createSetupOperationStore } from "./setup-operation.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    await withTransaction(db, async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "50000000R", legalName: "Email SL" });
    });
  },
});
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 14).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const email = {
  server: "smtp.example.test",
  port: 587,
  encryption: "starttls",
  user: "venue-user",
  password: "smtp-secret-231q",
  from: "VENUE@example.test",
};
const result = {
  locationId: "22222222-2222-2222-2222-222222222222",
  nodeId: "44444444-4444-4444-4444-444444444444",
  seriesIds: ["66666666-6666-6666-6666-666666666666"],
  seeded: [],
};
function body(mode: "live" | "demo" | "prepare" = "live"): Record<string, unknown> {
  return {
    mode,
    venue: {
      country: "ES",
      taxId: "50000000R",
      legalName: "Email SL",
      taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      location: {
        name: "Sala",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      admin: {
        displayName: "Admin",
        pin: "1357",
        password: "correct-horse-battery",
        email: "admin@example.test",
      },
    },
    ...(mode === "live"
      ? { aeatCert: { pfxBase64: "AA==", passphrase: "fiscal-fixture", certKind: "sello" } }
      : {}),
  };
}
function mount(overrides: Partial<SetupDeps> = {}) {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      db: suite.db,
      ring,
      provision: async () => {
        calls.push("provision");
        return result;
      },
      recoverProvision: async () => {
        calls.push("recover");
        return result;
      },
      seedDemo: async () => {},
      establishIdentity: async () => {},
      seedMembership: async () => {},
      assertFiscalReady: async () => {},
      runFiscalTest: async () => ({ status: "accepted" }),
      persistTrading: async () => {
        calls.push("publish");
      },
      requestRestart: () => {},
      ...overrides,
    },
    (...line) => {
      logs.push(line);
    },
  );
  return { app, calls, logs };
}
const post = (app: Hono, value: unknown, path = "/setup-api/provision") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
beforeEach(async () => {
  await withTransaction(suite.db, async (tx) => {
    await tx.delete(tenantCredentials);
  });
});

describe("setup provision email credential", () => {
  it("seals live SMTP settings before publishing and resolves the same sender", async () => {
    const made = mount({
      persistTrading: async () => {
        expect(await resolveEmailDelivery(suite.db, ring, false)).toEqual({
          mode: "smtp",
          smtp: {
            url: "smtp://venue-user:smtp-secret-231q@smtp.example.test:587?requireTLS=true",
            from: "venue@example.test",
          },
        });
      },
    });
    const response = await post(made.app, { ...body(), email });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provisioned: true, restarting: true });
    expect(JSON.stringify(made.logs)).not.toContain(email.password);
    const stored = await suite.db.select().from(tenantCredentials);
    expect(stored.map((row) => row.purpose).sort()).toEqual(["email.smtp", "fiscal.aeat"]);
    expect(
      Buffer.from(stored.find((row) => row.purpose === "email.smtp")!.ciphertext).includes(
        Buffer.from(email.password),
      ),
    ).toBe(false);
  });
  it("refuses a live provision without email settings before any writes", async () => {
    const made = mount();
    const response = await post(made.app, body());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.email_required", params: { field: "email" } },
    });
    expect(made.calls).toEqual([]);
    expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
  });
  it("allows development live provisioning without SMTP or a production certificate", async () => {
    const made = mount({ devMode: true });
    const value = body();
    delete value.aeatCert;
    const response = await post(made.app, value);
    expect(response.status).toBe(200);
    expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
  });
  it.each(["demo", "prepare"] as const)(
    "refuses %s email settings before provisioning",
    async (mode) => {
      const made = mount();
      const response = await post(made.app, { ...body(mode), email });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "setup.request_invalid", params: { field: "email" } },
      });
      expect(made.calls).toEqual([]);
      expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
    },
  );
  it.each([null, [], "smtp://secret", { ...email, port: null }, { ...email, password: null }])(
    "refuses malformed settings before provisioning",
    async (value) => {
      const made = mount();
      const response = await post(made.app, { ...body(), email: value });
      expect(response.status).toBe(400);
      const json = (await response.json()) as {
        error: { code: string; params: { field: string } };
      };
      expect(json.error.code).toBe(
        value === null || Array.isArray(value) || typeof value === "string"
          ? "setup.request_invalid"
          : "email.settings_invalid",
      );
      expect(made.calls).toEqual([]);
      expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
      expect(JSON.stringify(made.logs)).not.toContain(email.password);
    },
  );
  it("reuses sealed email after a publishing failure without retaining settings in the resume file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-email-provision-"));
    try {
      const operations = createSetupOperationStore(dir);
      const first = mount({
        operations,
        persistTrading: async () => {
          throw new Error("disk unavailable");
        },
      });
      const value = { ...body(), email };
      const failed = await post(first.app, value);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        error: { code: "server.internal" },
      });
      expect(await resolveEmailDelivery(suite.db, ring, false)).toEqual({
        mode: "smtp",
        smtp: {
          url: "smtp://venue-user:smtp-secret-231q@smtp.example.test:587?requireTLS=true",
          from: "venue@example.test",
        },
      });
      expect((await operations.read())?.phase).toBe("secret_sealed");
      const persisted = readFileSync(join(dir, "setup-operation.json"), "utf8");
      for (const secret of [email.password, email.user, email.server, "fiscal-fixture"])
        expect(persisted).not.toContain(secret);
      const next = mount({ operations: createSetupOperationStore(dir) });
      expect((await post(next.app, value)).status).toBe(200);
      expect(next.calls).toEqual(["publish"]);
      expect((await operations.read())?.phase).toBe("complete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("resumes both credential seals when SMTP storage fails after the fiscal seal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-email-seal-failure-"));
    await suite.db
      .run(sql`create trigger test_email_seal_failure before insert on tenant_credentials
      when new.purpose = 'email.smtp' begin select raise(abort, 'fixture storage refusal'); end`);
    try {
      const operations = createSetupOperationStore(dir);
      const first = mount({ operations });
      const value = { ...body(), email };
      const failed = await post(first.app, value);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        error: { code: "server.internal" },
      });
      expect(first.calls).toEqual(["provision"]);
      expect((await operations.read())?.phase).toBe("membership_seeded");
      expect((await suite.db.select().from(tenantCredentials)).map((row) => row.purpose)).toEqual([
        "fiscal.aeat",
      ]);
      await suite.db.run(sql`drop trigger test_email_seal_failure`);
      const next = mount({ operations: createSetupOperationStore(dir) });
      expect((await post(next.app, value)).status).toBe(200);
      expect(next.calls).toEqual(["publish"]);
      expect(
        (await suite.db.select().from(tenantCredentials)).map((row) => row.purpose).sort(),
      ).toEqual(["email.smtp", "fiscal.aeat"]);
      expect(await resolveEmailDelivery(suite.db, ring, false)).toEqual({
        mode: "smtp",
        smtp: {
          url: "smtp://venue-user:smtp-secret-231q@smtp.example.test:587?requireTLS=true",
          from: "venue@example.test",
        },
      });
    } finally {
      await suite.db.run(sql`drop trigger if exists test_email_seal_failure`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("allows a fiscal test before the wizard has collected email settings", async () => {
    const made = mount();
    const response = await post(made.app, body(), "/setup-api/fiscal-test");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(await suite.db.select().from(tenantCredentials)).toEqual([]);
  });
});
