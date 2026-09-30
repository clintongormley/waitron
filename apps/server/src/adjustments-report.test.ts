import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ADJUSTMENTS_ROUTES, type AdjustmentReport } from "@waitron/adjustments";
import { recordVoid } from "@waitron/core";
import { parties, sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ModuleRouteContext } from "@waitron/module";
import { currentBusinessDay } from "@waitron/reporting";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { saleId as brandSaleId } from "@waitron/shared";
import { DEVICE_COOKIE } from "./device-session.js";
import { createTable } from "./tables.js";
import { send } from "./testing/bill-venue.js";
import {
  inTx,
  PINS,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// The adjustment report (service plan Task 12) over bills made through the till's own routes:
// drafts submitted by their owners, a take-over, an adjustment and a payment, read back through
// the adjustments module's report route.
let venue: AdjustmentVenue;
let reports: Hono;
let reader: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    reports = new Hono();
    ADJUSTMENTS_ROUTES.mount(
      reports,
      {
        db,
        cfg: { locationId: venue.cfg.locationId, contentDefaultLanguage: venue.venueLocale },
        core: {} as ModuleRouteContext["core"],
      },
      () => {},
    );
    const session = await inTx(venue, (tx) =>
      startManagementSession(tx, { personId: venue.supervisorId }),
    );
    reader = `${MANAGEMENT_COOKIE}=${session.token}`;
  },
});

interface Member {
  id: string;
  cookie: string;
  sessionId: string;
}

/** A new staff member signed in at the venue's till, on its enrolled device. */
async function member(name: string): Promise<Member> {
  const device = venue.cookie.staff.split("; ").find((part) => part.startsWith(DEVICE_COOKIE))!;
  return inTx(venue, async (tx) => {
    const [row] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("2468"), role: "staff" })
      .returning({ id: persons.id });
    const session = await loginWithPin(tx, {
      tillId: venue.cfg.tillId,
      personId: row!.id,
      pin: "2468",
    });
    return {
      id: row!.id,
      cookie: `${SESSION_COOKIE}=${session.token}; ${device}`,
      sessionId: session.id,
    };
  });
}

async function call(who: Member, method: string, path: string, body?: unknown) {
  const answer = await send(venue.app, who.cookie, method, path, body);
  expect(answer.status, `${method} ${path}: ${JSON.stringify(answer.json)}`).toBe(200);
  return answer.json as Record<string, unknown> & { id: string; revision: number };
}

/** A party seated by `who` at a fresh table; answers the party and its bill. */
async function seat(who: Member): Promise<{ partyId: string; billId: string }> {
  const table = await inTx(venue, (tx) =>
    createTable(tx, venue.cfg, {
      label: `R-${randomUUID().slice(0, 8)}`,
      zoneId: venue.tables.zoneId,
    }),
  );
  const seated = await call(who, "POST", `/api/tables/${table.id}/seat`, {});
  return { partyId: seated.partyId as string, billId: seated.tabId as string };
}

type Draft = { id: string; revision: number; lines: { id: string }[] };

async function draft(who: Member, partyId: string, dishes: string[]): Promise<Draft> {
  return (await call(who, "PUT", `/api/parties/${partyId}/drafts`, {
    draftId: null,
    revision: 0,
    lines: dishes.map((name) => ({ menuItemId: venue.item(name), quantity: "1" })),
  })) as unknown as Draft;
}

async function submit(who: Member, partyId: string, submitted: Draft): Promise<void> {
  const [party] = await inTx(venue, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  await call(who, "POST", `/api/parties/${partyId}/drafts/${submitted.id}/submit`, {
    submissionId: randomUUID(),
    draftRevision: submitted.revision,
    expectedPartyRevision: party!.revision,
    groups: [{ lineIds: submitted.lines.map((line) => line.id), release: "fire" }],
  });
}

async function lineNamed(billId: string, name: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, name))),
  );
  return row!.id;
}

async function adjust(
  who: Member,
  billId: string,
  dish: string,
  action: "cancel" | "comp",
): Promise<void> {
  const [bill] = await inTx(venue, (tx) =>
    tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  await call(who, "POST", `/api/working-orders/${billId}/adjustments`, {
    submissionId: randomUUID(),
    expectedRevision: bill!.revision,
    lineId: await lineNamed(billId, dish),
    reasonId: venue.reasonId.house,
    action,
    note: null,
  });
}

/** `who` pays what is left on the bill in cash, which issues its invoice; answers the invoice. */
async function payInFull(
  who: Member,
  billId: string,
  amount: string,
): Promise<{ id: string; operatorId: string | null }> {
  await call(who, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    tip: "0.00",
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
  });
  const [sale] = await inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, operatorId: sales.operatorId })
      .from(sales)
      .where(eq(sales.workingOrderId, billId)),
  );
  return sale!;
}

function dayOffset(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The report over the business days either side of today, through the module's route. */
async function readReport(): Promise<AdjustmentReport> {
  const today = currentBusinessDay({ timeZone: "Europe/Madrid", dayCutover: "05:00" });
  const response = await reports.request(
    `/management-api/adjustments/report?from=${dayOffset(today, -1)}&to=${dayOffset(today, 1)}`,
    { headers: { cookie: reader } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as AdjustmentReport;
}

/** A person's row, or their credited sales as nothing when the report has no row for them. */
function rowOf(report: AdjustmentReport, who: Member) {
  return report.people.find((row) => row.personId === who.id);
}

function salesOf(report: AdjustmentReport, who: Member): string {
  return rowOf(report, who)?.sales ?? "0.00";
}

async function voidCount(): Promise<number> {
  const { rows } = await inTx(venue, async (tx) =>
    tx.execute<{ n: number }>(sql`select count(*) as n from sale_voids`),
  );
  return rows[0]!.n;
}

describe("whose sales an adjustment rate is measured against (plan D21, spec §7)", () => {
  it("credits each dish to the owner of the draft that sent it, not the invoice's operator, and keeps Alex's comped Burger in his sales", async () => {
    const alex = await member("Alex");
    const sam = await member("Sam");
    const mia = await member("Mia");
    const jo = await member("Jo");
    const { partyId, billId } = await seat(alex);

    await submit(alex, partyId, await draft(alex, partyId, ["Burger", "Steak"]));
    // Sam drafts the €30.00 bottle of wine; Mia takes the draft over and sends it (plan D5).
    const sams = await draft(sam, partyId, ["Bottle"]);
    const mias = (await call(mia, "POST", `/api/parties/${partyId}/drafts/${sams.id}/take-over`, {
      revision: sams.revision,
    })) as unknown as Draft;
    await submit(mia, partyId, mias);
    await adjust(alex, billId, "Burger", "comp");
    const invoice = await payInFull(jo, billId, "55.00");

    const report = await readReport();

    // The controls: crediting the invoice's operator would give Jo €67.00 and Alex nothing.
    expect(invoice.operatorId).toBe(jo.id);
    expect(salesOf(report, alex)).toBe("37.00");
    expect(salesOf(report, mia)).toBe("30.00");
    expect(salesOf(report, sam)).toBe("0.00");
    expect(salesOf(report, jo)).toBe("0.00");
    // Dropping the comped Burger from the denominator would give €25.00 and 48.0%.
    expect(rowOf(report, alex)).toMatchObject({
      count: 1,
      reduction: "12.00",
      ratePercent: "32.4",
      byAction: { comp: { count: 1, reduction: "12.00", nominalValue: "12.00" } },
      byStage: { afterFiring: { count: 1, reduction: "12.00", nominalValue: "12.00" } },
    });
    expect(rowOf(report, mia)).toMatchObject({ count: 0, ratePercent: "0.0" });
  });
});

describe("a kitchen cancellation is not a voided invoice (spec §7)", () => {
  it("reports the cancellation as a cancellation, writes no void, and reads nothing from an invoice's later void", async () => {
    const lucia = await member("Lucía");
    const pablo = await member("Pablo");
    const rosa = await member("Rosa");
    const { partyId, billId } = await seat(lucia);
    await submit(lucia, partyId, await draft(lucia, partyId, ["Burger", "Steak"]));
    const voidsBefore = await voidCount();

    await adjust(pablo, billId, "Steak", "cancel");
    const invoice = await payInFull(rosa, billId, "12.00");
    const report = await readReport();

    expect(await voidCount()).toBe(voidsBefore);
    expect(rowOf(report, pablo)).toMatchObject({
      count: 1,
      byAction: {
        cancel: { count: 1, reduction: "25.00", nominalValue: "25.00" },
        comp: { count: 0 },
      },
    });
    // The Steak left the bill; it stays in Lucía's sales through the cancellation's snapshot.
    expect(salesOf(report, lucia)).toBe("37.00");

    const manager = await inTx(venue, (tx) =>
      loginWithPin(tx, { tillId: venue.cfg.tillId, personId: venue.managerId, pin: PINS.manager }),
    );
    await inTx(venue, (tx) =>
      recordVoid(tx, venue.backend, brandSaleId(invoice.id), "rung in error", {
        sessionId: manager.id,
      }),
    );

    expect(await voidCount()).toBe(voidsBefore + 1);
    expect(await readReport()).toEqual(report);
  });
});
