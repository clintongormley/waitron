import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { credentialRevision, loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  applyAllocatedTestVenue as applyAllocatedVenue,
  applyHistoricalTestVenue as applyVenue,
} from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { FISCAL_SLOT, sealAeatSecret } from "@waitron/fiscal-verifactu";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { mountFiscalCertificateApi } from "./fiscal-certificate-api.js";
import type { StartedServer } from "./boot.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const path = "/management-api/fiscal-certificate";
const authority = makeAuthority();
const installed = authority.issue();
const keyEnv = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

describe("the certificate routes with the real Veri*Factu seat", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 120_000,
  });
  const seat = FISCAL_SLOT.certificate!;

  async function venue() {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const result = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: "89890001K",
          legalName: "WAITRON SL",
          location: {
            name: "Sala",
            fiscalTerritory: "ES-common",
            invoiceLocales: ["es-ES"],
            operationDescription: "Venta en establecimiento",
            addressLine1: "Calle Uno 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Owner",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword("dashPass123"),
            email: "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: suite.db, modules: ALL_MODULES },
    );
    await sealAeatSecret(
      {
        db: suite.db,
        ring,
        nodeId: result.nodeId,
        now: () => new Date("2026-10-18T09:00:00Z"),
      },
      {
        pfxBase64: installed.pfx.toString("base64"),
        passphrase: installed.passphrase,
        certKind: "sello",
      },
    );
    const cookie = await withTransaction(suite.db, async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      const session = await startManagementSession(tx, { personId: admin!.id });
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    });
    const logged: [string, string, unknown][] = [];
    const log: Logger = (level, event, fields) => {
      logged.push([level, event, fields]);
    };
    const app = new Hono();
    mountFiscalCertificateApi(
      app,
      {
        db: suite.db,
        ring,
        seat,
        nodeId: result.nodeId,
        locationId: result.locationId,
        environment: "preproduction",
        filing: () => true,
        now: () => new Date("2026-10-18T10:00:00Z"),
      },
      log,
    );
    return { app, cookie, logged };
  }

  const revision = (db = suite.db) =>
    withTransaction(db, (tx) => credentialRevision(tx, { purpose: "fiscal.aeat" }));

  it("a wrong passphrase through the route is refused under the passphrase field and leaves the vault unchanged", async () => {
    const v = await venue();
    const before = await revision();
    const candidate = authority.issue();
    const pfxBase64 = candidate.pfx.toString("base64");
    const passphrase = "not-the-passphrase";
    const response = await v.app.request(path, {
      method: "POST",
      headers: { cookie: v.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pfxBase64, passphrase, certKind: "sello", expectedRevision: before }),
    });
    const responseText = await response.clone().text();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "refused",
      reason: "passphrase_wrong",
      field: "passphrase",
    });
    expect(await revision()).toBe(before);
    expect(v.logged.filter(([, event]) => event.startsWith("fiscal.certificate"))).toEqual([
      ["info", "fiscal.certificate_refused", { reason: "passphrase_wrong", field: "passphrase" }],
    ]);
    const everything = [responseText, ...v.logged.map((line) => JSON.stringify(line))].join("\n");
    expect(everything).not.toContain(passphrase);
    expect(everything).not.toContain(pfxBase64);
  });

  it("GET through the route shows the setup-installed certificate with the installer null", async () => {
    const v = await venue();
    const response = await v.app.request(path, { headers: { cookie: v.cookie } });
    expect(response.status).toBe(200);
    const card = (await response.json()) as {
      filing: boolean;
      revision: string | null;
      installed: { source: string; installedByName: string | null; kind: string } | null;
    };
    expect(card.filing).toBe(true);
    expect(card.revision).toBe(await revision());
    expect(card.installed).toMatchObject({
      source: "setup",
      installedByName: null,
      kind: "sello",
      installedAt: "2026-10-18T09:00:00.000Z",
    });
  });
});

const { beforeServerStarts, startServer } = serverFixture();

const boxes = {
  "fiscal-verifactu": {
    disabled: "fiscal-none",
    country: "ES",
    taxId: "B10101010",
    location: {
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
    },
  },
  "fiscal-none": {
    disabled: "fiscal-verifactu",
    country: "GB",
    taxId: "GB100000001",
    location: {
      fiscalTerritory: "GB-vat",
      invoiceLocales: ["en-GB"],
      postalCode: "EC1A 1AA",
      city: "London",
      province: "London",
      timeZone: "Europe/London",
    },
  },
} as const;

for (const [fiscal, box] of Object.entries(boxes)) {
  describe(`a trading box whose fiscal module is ${fiscal}`, () => {
    const modules = ALL_MODULES.filter((m) => m.name !== box.disabled);
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((s) => s.name !== box.disabled),
        null,
      ),
    });
    it(
      fiscal === "fiscal-verifactu"
        ? "serves GET /management-api/fiscal-certificate"
        : "answers 404 at /management-api/fiscal-certificate",
      async () => {
        beforeServerStarts();
        const venue = await applyAllocatedVenue(
          planVenue(
            {
              country: box.country,
              taxId: box.taxId,
              legalName: "Certificate box SL",
              location: {
                ...box.location,
                invoiceLocales: [...box.location.invoiceLocales],
                name: "Sala",
                operationDescription: "Restaurant",
                addressLine1: "Calle Mayor 1",
                addressLine2: null,
                dayCutover: "05:00",
              },
              seriesCode: "A",
              rectificativeSeriesCode: "R",
              admin: {
                displayName: "Owner",
                pinHash: hashPin("1234"),
                passwordHash: hashPassword("dashPass123"),
                email: "owner@example.test",
              },
            },
            modules,
          ),
          { db: suite.db, modules },
        );
        const cookie = await withTransaction(suite.db, async (tx) => {
          const [admin] = await tx
            .select({ id: persons.id })
            .from(persons)
            .where(eq(persons.role, "admin"));
          const session = await startManagementSession(tx, { personId: admin!.id });
          return `${MANAGEMENT_COOKIE}=${session.token}`;
        });
        const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-fiscal-certificate-"));
        let server: StartedServer | undefined;
        try {
          await copyMigrationsRoot(join(scratch, "migrations"));
          await writeFile(
            join(scratch, "modules.json"),
            JSON.stringify({ modules: { [box.disabled]: false } }),
          );
          const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
          const [port] = await freePorts(1);
          server = await startServer({
            ...keyEnv,
            WAITRON_HTTP_LANDING_PORT: "0",
            WAITRON_HTTP_PORT: String(port),
            WAITRON_STATE_DIR: scratch,
            WAITRON_VENUE_DIR: dirname(database),
            WAITRON_TILL_NODE_ID: venue.nodeId,
            WAITRON_TILL_LOCATION_ID: venue.locationId,
            WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
            WAITRON_ENV: "preproduction",
          });
          await awaitListening(port!);
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: { cookie },
          });
          if (fiscal === "fiscal-verifactu") {
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
              filing: false,
              installed: null,
              revision: null,
            });
          } else {
            expect(response.status).toBe(404);
          }
        } finally {
          await server?.close();
          await rm(scratch, { recursive: true, force: true });
        }
      },
    );
  });
}
