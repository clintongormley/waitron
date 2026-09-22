import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { Transaction } from "@waitron/db";
import { asAppUser, invoiceSeries, withTransaction } from "@waitron/db";
import { applyVenue, planVenue, resolveFiscalModules } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { WaitronModule } from "@waitron/module";
import { recordCorrection, recordSale, recordSubstitution, recordVoid } from "@waitron/core";
import { hashPassword, hashPin, loginWithPin } from "@waitron/identity";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import "./errors.js";

// The payoff proof of the fiscal-none branch, on REAL Postgres (Testcontainers), never PGlite:
// PGlite runs every connection as a table-owning superuser, so its grants are not enforced (CLAUDE.md
// §4) — a "no fiscal row was written" reading there proves less than the same reading with the write
// path run as the actual non-superuser deployment role, bound by the grants it really holds. A
// GB (`GB-vat`) venue selects the `fiscal-none` slot member end-to-end: the territory resolves to
// filing `none`, `venueModuleConfig` enables `fiscal-none` and disables `fiscal-verifactu`, and the
// slot hands back a `NoneBackend` that records NOTHING. Ringing a sale, a void, a correction and a
// substitution through the real core write path must leave every fiscal table empty and stamp each
// sale's `fiscal_backend = "none"`.
//
// The shared-container `rls_probe` role (globalSetup, inherits `app_user`) is the non-superuser
// subject the write path runs as; `suite.admin` is the owner that provisions and reads back.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";
const LOCALE = "en-GB";

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is
// unique, so each venue needs its own tax id (mirrors till-sale-integrated's `nextNif`).
let taxIdCounter = 0;
function nextTaxId(): string {
  taxIdCounter += 1;
  return `GB${String(100_000_000 + taxIdCounter).padStart(9, "0")}`;
}

const BASE = new Date("2027-05-01T12:00:00.000Z");

// A steady, confident clock — the write path reads it once per record; a GB no-regime venue chains
// nothing, so only its instant/offset are consumed.
const steadyClock: TrustedClock = {
  now: () => ({
    instant: BASE,
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("fiscal-none.e2e: anchor() is not used by the write path");
  },
  currentAnchor: () => null,
};

const suite = useTemplateDb({ template: "manifest" });

// The GB enabled set and its backend, resolved ONCE via the real wiring: the territory selects
// filing `none`, `venueModuleConfig` forces the fiscal slot onto `fiscal-none`, and `fiscalSlot`
// returns that member's contribution. `makeBackend()` is what boot calls — so this is the backend a
// real GB box rings sales through, not a hand-built `new NoneBackend()`.
let gbModules: WaitronModule[];
let backend: FiscalBackend;

beforeAll(() => {
  const gbConfig = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat");
  gbModules = enabledModules(ALL_MODULES, gbConfig);
  backend = fiscalSlot(gbModules, null).makeBackend({
    db: suite.admin,
    clock: steadyClock,
    environment: "preproduction",
  });
});

interface GbVenue {
  tillId: TillId;
  nodeId: NodeId;
  standardSeriesId: SeriesId;
  rectificativeSeriesId: SeriesId;
  adminSessionId: string;
}

/** Provision a fresh GB venue (country `GB`, territory `GB-vat`, `fiscal-none` enabled /
 *  `fiscal-verifactu` disabled — the set `venueModuleConfig` produces) as the owner, then open a
 *  shift session for its seeded admin (who holds every permission, so it authorizes voids and
 *  corrections). `useTemplateDb` resets the clone between tests, so each test provisions into an
 *  empty database and the counts below are order-independent. */
async function setupGbVenue(): Promise<GbVenue> {
  const venue: VenueResult = await applyVenue(
    planVenue(
      {
        country: "GB",
        taxId: nextTaxId(),
        legalName: "Deli London Ltd",
        location: {
          name: "Main counter",
          fiscalTerritory: "GB-vat",
          invoiceLocales: [LOCALE],
          operationDescription: "Sale on premises",
          addressLine1: "1 High Street",
          addressLine2: null,
          postalCode: "EC1A 1AA",
          city: "London",
          province: "London",
          timeZone: "Europe/London",
          dayCutover: "05:00",
        },
        tillName: "Till 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      gbModules,
    ),
    { db: suite.admin, modules: gbModules },
  );

  const nodeId = brandNodeId(venue.nodeId);

  // The two series the venue plan seeds — read by purpose rather than by array position.
  const seriesRows = await suite.admin
    .select({ id: invoiceSeries.id, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(eq(invoiceSeries.nodeId, nodeId));
  const standard = seriesRows.find((r) => r.purpose === "standard");
  const rectificative = seriesRows.find((r) => r.purpose === "rectificative");
  if (standard === undefined || rectificative === undefined) {
    throw new Error("fiscal-none.e2e: venue plan did not seed both series");
  }

  // The seeded admin person (role='admin', holds sale.void + sale.rectify) and an open shift session
  // opened through `loginWithPin` exactly as a till would — the authorizer for the void and the
  // correction below. Read as owner; opened as the app role under the tenant scope.
  const { rows: adminRows } = await suite.admin.execute<{ id: string }>(
    sql`select id from persons where role = 'admin'`,
  );
  const adminPersonId = adminRows[0]!.id;
  const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
  let adminSessionId: string;
  try {
    const session = await withTransaction(app, async (tx) => {
      await asAppUser(tx);
      return loginWithPin(tx, {
        tillId: venue.tillId,
        personId: adminPersonId,
        pin: "1234",
      });
    });
    adminSessionId = session.id;
  } finally {
    await app.close();
  }

  return {
    tillId: brandTillId(venue.tillId),
    nodeId,
    standardSeriesId: brandSeriesId(standard.id),
    rectificativeSeriesId: brandSeriesId(rectificative.id),
    adminSessionId,
  };
}

/** Run `fn` as the non-superuser app role — the exact subject the trading write path
 *  runs under (bound by `app_user`'s grants, no superuser bypass). Opens and closes its own connection. */
async function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
  try {
    return await withTransaction(app, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  } finally {
    await app.close();
  }
}

/** Ring an ordinary café sale through `recordSale`, immediate cash settlement. Returns its id. */
async function ringSale(venue: GbVenue): Promise<{ saleId: SaleId; backendId: string }> {
  return asApp(async (tx) => {
    const { saleId, fiscal } = await recordSale(tx, backend, {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.standardSeriesId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: "1.50",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { [LOCALE]: "Coffee" },
          quantity: "1",
          unitPrice: "1.50",
          vatRate: "0.00",
          lineTotal: "1.50",
        },
      ],
      clock: steadyClock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "1.50", tipAmount: "0.00", settledAt: BASE }],
      },
    });
    return { saleId, backendId: fiscal.backend };
  });
}

/** Owner read: how many rows `table` holds. */
async function countRows(table: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(
    sql`select cast(count(*) as text) as count from ${sql.identifier(table)} `,
  );
  return Number(rows[0]!.count);
}

/** The `fiscal_backend` values stamped on this tenant's sales (owner read). */
async function saleBackends(): Promise<string[]> {
  const { rows } = await suite.admin.execute<{ fiscal_backend: string }>(
    sql`select fiscal_backend from sales  order by issued_at`,
  );
  return rows.map((r) => r.fiscal_backend);
}

describe("a GB (no-regime) venue writes NO fiscal record", () => {
  it("resolves the fiscal-none backend from the GB-vat territory (the wiring under proof)", () => {
    // The whole chain: territory → filing id → slot member → backend. If any link regressed (the
    // territory stopped resolving to `none`, the slot picked verifactu), this fails before any DB.
    expect(resolveFiscalModules("GB-vat").filing).toBe("none");
    expect(backend.id).toBe("none");
    // fiscal-verifactu is disabled for GB; fiscal-none is the sole slot member enabled.
    const fiscalMembers = gbModules.filter((m) => m.fiscal !== undefined).map((m) => m.fiscal!.id);
    expect(fiscalMembers).toEqual(["none"]);
  });

  it("rings a sale + void + correction + substitution and files ZERO fiscal rows", async () => {
    const venue = await setupGbVenue();

    // 1. A sale — the one whose fiscal_backend the brief pins to "none".
    const sale = await ringSale(venue);
    expect(sale.backendId).toBe("none");

    // 2. Two more ordinary sales: one to correct, one to substitute (an F3 exchanges real tickets).
    const toCorrect = await ringSale(venue);
    const toSubstitute = await ringSale(venue);

    // 3. Void the first sale — authorized by the admin session, no fiscal chain work.
    await asApp((tx) =>
      recordVoid(tx, backend, sale.saleId, "rung in error", {
        sessionId: venue.adminSessionId,
      }),
    );

    // 4. A rectificativa correcting the second sale, drawn from the rectificative series.
    await asApp((tx) =>
      recordCorrection(tx, backend, {
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        seriesId: venue.rectificativeSeriesId,
        correctsSaleId: toCorrect.saleId,
        total: "-1.50",
        lines: [
          {
            lineNo: 1,
            name: "Refund",
            descriptions: { [LOCALE]: "Refund" },
            quantity: "-1",
            unitPrice: "1.50",
            vatRate: "0.00",
            lineTotal: "-1.50",
          },
        ],
        clock: steadyClock,
        authz: { sessionId: venue.adminSessionId },
      }),
    );

    // 5. A factura de canje (F3) substituting the third sale, drawn from the standard series.
    await asApp((tx) =>
      recordSubstitution(tx, backend, {
        tillId: venue.tillId,
        nodeId: venue.nodeId,
        seriesId: venue.standardSeriesId,
        substitutedSaleIds: [toSubstitute.saleId],
        counterparty: {
          taxId: "GB999999973",
          legalName: "Acme Buyer Ltd",
          countryCode: "GB",
        },
        total: "1.50",
        lines: [
          {
            lineNo: 1,
            name: "Coffee",
            descriptions: { [LOCALE]: "Coffee" },
            quantity: "1",
            unitPrice: "1.50",
            vatRate: "0.00",
            lineTotal: "1.50",
          },
        ],
        locale: LOCALE,
        invoiceLocales: [LOCALE],
        clock: steadyClock,
      }),
    );

    // The proof: no fiscal record exists anywhere for this venue — not a registro, not a SIF row,
    // not a chain head, not an outbox envío — across a sale, a void, a correction and a substitution.
    for (const table of ["registros_facturacion", "registro_sif", "cadenas", "envios"]) {
      expect(await countRows(table)).toBe(0);
    }

    // Every sale the venue rang carries the no-regime backend id (a correction inserts a `sales` row
    // too, so this is four: sale, correction, F3 — and the corrected/substituted originals).
    const backends = await saleBackends();
    expect(backends.length).toBeGreaterThanOrEqual(4);
    expect(new Set(backends)).toEqual(new Set(["none"]));
  });
});
