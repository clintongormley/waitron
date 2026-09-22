import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { decryptBundle } from "./recovery-bundle.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // the seeded manager's dashboard password
// Dashboard sign-in resolves the person by EMAIL, so the seeded manager carries a login email
// (unique on `lower(email)` across the database — persons_tenant_email_uq).
const MANAGER_EMAIL = "manager@x.com";
const BUNDLE_PASS = "recovery pass phrase"; // ≥ MIN_PASSPHRASE_LENGTH

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// One fixed NIF: this suite owns its own venue directory, so nothing else ever writes the `tenants`
// row the uniqueness constraint covers.
const NIF = "74000001K";

// Same manager-login scaffolding as box-status.route.test.ts.
async function setupTenant(): Promise<{ managerId: string }> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const managerId = await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
    // `$defaultFn` generators (`packages/identity/src/schema/persons.ts:26,:67`) that an insert
    // statement never reaches, and both columns are NOT NULL.
    const [m] = await tx
      .insert(persons)
      .values({
        displayName: "The Manager",
        email: MANAGER_EMAIL,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(PASSWORD),
        role: "manager",
      })
      .returning({ id: persons.id });
    return m!.id;
  });
  return { managerId };
}

/** Seed every `RECOVERY_FILES` path, or all but `omit` — omitting one makes the route hit
 * `recovery.state_incomplete`. */
async function seedStateDir(omit?: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "recovery-state-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  for (const rel of RECOVERY_FILES) {
    if (rel === omit) continue;
    await writeFile(join(dir, rel), `contents-of-${rel}\n`);
  }
  return dir;
}

function buildApp(stateDir: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      // The all-zero node id (the capture default): this suite uses the management API only for its
      // login route, not origin attribution, so the sentinel keeps behaviour exactly as before Task 6.
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountRecoveryBundleApi(
    app,
    { db: suite.db, stateDir, now: () => new Date("2026-08-29T10:00:00Z") },
    () => {},
  );
  return app;
}

async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("POST /api/box/recovery-bundle", () => {
  let app: Hono;
  let cookie: string;

  beforeAll(async () => {
    await setupTenant();
    app = buildApp(await seedStateDir());
    cookie = await login(app, MANAGER_EMAIL);
  });

  it("401s without a management session", async () => {
    const res = await app.request("/api/box/recovery-bundle", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("400s when no passphrase is supplied", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "recovery.passphrase_required" } });
  });

  it("400s on a too-short passphrase", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "short" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "recovery.passphrase_too_short" } });
  });

  it("returns an attachment whose bytes decrypt back to the state-dir secrets", async () => {
    const res = await app.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: BUNDLE_PASS }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="waitron-recovery-/,
    );
    const files = decryptBundle(await res.text(), BUNDLE_PASS);
    expect(Object.keys(files).sort()).toEqual([...RECOVERY_FILES].sort());
    expect(files["secrets.env"]).toBe("contents-of-secrets.env\n");
  });

  it("500s with recovery.state_incomplete when the box lost one of its own secret files", async () => {
    // A provisioned box missing its own `trading.env` is a box-side fault, not operator error, so
    // the boundary classifies it a STRUCTURED 500 that names the absent file — not a 400 and not an
    // opaque 500. Same authorized manager, a state dir seeded all-but-one.
    const incompleteApp = buildApp(await seedStateDir("trading.env"));
    const incompleteCookie = await login(incompleteApp, MANAGER_EMAIL);
    const res = await incompleteApp.request("/api/box/recovery-bundle", {
      method: "POST",
      headers: { cookie: incompleteCookie, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: BUNDLE_PASS }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: { code: "recovery.state_incomplete", params: { missing: "trading.env" } },
    });
  });
});
