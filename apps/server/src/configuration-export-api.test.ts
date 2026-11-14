import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue, type VenueRequest, type VenueResult } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { writeArchiveSettings } from "./archive-settings.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { mountConfigurationExportApi } from "./configuration-export-api.js";
import { decodeConfigurationBundle } from "./configuration-transfer.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";

const encoding = vi.hoisted(() => ({ observe: false, order: [] as string[] }));
vi.mock("./configuration-transfer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./configuration-transfer.js")>();
  return {
    ...actual,
    encodeConfigurationBundleAsync: async (
      ...args: Parameters<typeof actual.encodeConfigurationBundleAsync>
    ) => {
      if (!encoding.observe) return actual.encodeConfigurationBundleAsync(...args);
      const turn = setImmediate(() => encoding.order.push("turned"));
      try {
        const bytes = await actual.encodeConfigurationBundleAsync(...args);
        encoding.order.push("encoded");
        return bytes;
      } finally {
        clearImmediate(turn);
      }
    },
  };
});

const noopLog: Logger = () => {};
let venue: VenueResult;
let cookie: string;
let moduleVersions: Record<string, number>;

const request: VenueRequest = {
  country: "ES",
  taxId: "B44444444",
  legalName: "Prepared Export SL",
  name: "Prepared",
  invoiceLocales: ["es-ES"],
  operationDescription: "Restaurant",
  fiscalTerritory: "ES-common",
  addressLine1: "Calle 1",
  addressLine2: null,
  postalCode: "28001",
  city: "Madrid",
  province: "Madrid",
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  seriesCode: "F",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Admin",
    email: "export@example.test",
    pinHash: "pin",
    passwordHash: "password",
  },
};

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await applyVenue(planVenue(request, ALL_MODULES), { db, modules: ALL_MODULES });
    moduleVersions = await schemaVersionsByModule({ venue: db, node: suite.node }, ALL_MODULES);
    cookie = await withTransaction(db, async (tx) => {
      const admin = await tx.execute<{ id: string }>(sql`
        select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')
      `);
      const session = await startManagementSession(tx, {
        personId: admin.rows[0]!.id,
      });
      await setFreshManagementSignIn(tx, session.token);
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    });
  },
});

function app(options: { clock?: boolean } = {}): Hono {
  const app = new Hono();
  mountConfigurationExportApi(
    app,
    {
      db: suite.db,
      cfg: venue,
      modules: ALL_MODULES,
      moduleVersions,
      ...(options.clock === false ? {} : { now: () => new Date("2026-09-09T00:00:00.000Z") }),
    },
    noopLog,
  );
  return app;
}

describe("configuration export API", () => {
  it("requires proof before preparing an export", async () => {
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, cookie, false));
    try {
      const response = await app().request("/management-api/configuration-export", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "a strong passphrase" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management_session.proof_required" },
      });
      expect(response.headers.get("content-disposition")).toBeNull();
    } finally {
      await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, cookie));
    }
  });

  it("refuses an unproved staff session by permission before asking for proof", async () => {
    const { token } = await openManagementSession(suite.db, "staff");
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { cookie: `${MANAGEMENT_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  });

  it("requires an authenticated manager", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(401);
  });

  it("answers a damaged stored settings document as a server failure", async () => {
    suite.db.execute(
      sql`insert into settings (module, version, revision, doc, updated_at) values ('adjustments', 1, 1, '{"maxBillComp":-1}', '2026-11-09T12:00:00.000Z')`,
    );
    try {
      const response = await app().request("/management-api/configuration-export", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ passphrase: "a strong passphrase" }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: "settings.invalid",
          params: { module: "adjustments", field: "maxBillComp" },
        },
      });
    } finally {
      suite.db.execute(sql`delete from settings where module = 'adjustments'`);
    }
  });

  it("awaits asynchronous encryption while the event loop keeps turning", async () => {
    encoding.observe = true;
    encoding.order = [];
    try {
      const response = await app().request("/management-api/configuration-export", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ passphrase: "a strong passphrase" }),
      });
      expect(response.status).toBe(200);
      expect(encoding.order).toEqual(["turned", "encoded"]);
      expect(
        decodeConfigurationBundle(
          new Uint8Array(await response.arrayBuffer()),
          "a strong passphrase",
        ).venue.legalName,
      ).toBe("Prepared Export SL");
    } finally {
      encoding.observe = false;
    }
  });

  it("returns an encrypted configuration-only artifact", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const decoded = decodeConfigurationBundle(
      new Uint8Array(await response.arrayBuffer()),
      "a strong passphrase",
    );
    expect(decoded.venue.legalName).toBe("Prepared Export SL");
    expect(decoded.venue.taxpayerDomicile).toBeNull();
    expect(decoded.privacyContact).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
    expect(decoded.tables).not.toHaveProperty("sales");
  });

  it.each([
    ["missing", {}],
    ["not a string", { passphrase: 123456789012 }],
    ["shorter than twelve characters", { passphrase: "elevenchars" }],
  ])("refuses a passphrase that is %s", async (_label, body) => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field: "passphrase" } },
    });
  });

  it("accepts a passphrase of exactly twelve characters", async () => {
    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passphrase: "twelve chars" }),
    });
    expect(response.status).toBe(200);
  });

  it("stamps the artifact with the current time when no clock is supplied", async () => {
    const before = Date.now();
    const response = await app({ clock: false }).request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    const after = Date.now();
    expect(response.status).toBe(200);
    const decoded = decodeConfigurationBundle(
      new Uint8Array(await response.arrayBuffer()),
      "a strong passphrase",
    );
    const stamped = Date.parse(decoded.createdAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });

  it("carries neither the archive settings' nor the stream's bucket secret", async () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const originalStreamSecret = "stream-secret-for-export-0123456789";
    const archiveSecret = "archive-secret-for-export-0123456789";
    const bucket = { region: "eu-west-1", bucket: "venue-copy", prefix: "", accessKeyId: "AKIAX" };
    await withTransaction(suite.db, async (tx) => {
      await putCredential(tx, ring, {
        purpose: STREAM_PURPOSE,
        value: streamSettingsPayload({
          bucket: { ...bucket, secretAccessKey: originalStreamSecret },
        }),
      });
      await writeArchiveSettings(tx, ring, {
        enabled: true,
        destinations: [
          {
            kind: "s3",
            id: "bucket",
            bucket: { ...bucket, bucket: "archives", secretAccessKey: archiveSecret },
          },
        ],
        schedule: { kind: "interval", ms: 3_600_000 },
        retention: { count: 7, days: 30 },
        destinationTimeoutMs: 900_000,
      });
    });
    const sealed = await suite.db.execute<{ blob: Uint8Array }>(sql`
      select ciphertext as blob from tenant_credentials
      where purpose in ('backup.stream', 'backup.archive')
    `);
    expect(sealed.rows).toHaveLength(2);

    const response = await app().request("/management-api/configuration-export", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
    expect(response.status).toBe(200);
    const decoded = decodeConfigurationBundle(
      new Uint8Array(await response.arrayBuffer()),
      "a strong passphrase",
    );
    // The secrets are sealed in the vault, so the vault table travelling would hide them too.
    expect(decoded.tables).not.toHaveProperty("tenant_credentials");
    const exportedText = JSON.stringify(decoded);
    expect(exportedText).not.toContain(originalStreamSecret);
    expect(exportedText).not.toContain(archiveSecret);
    for (const row of sealed.rows) {
      expect(exportedText).not.toContain(Buffer.from(row.blob).toString("hex"));
      expect(exportedText).not.toContain(Buffer.from(row.blob).toString("base64"));
    }
  });
});
