import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billPayments,
  incidents,
  parties,
  products,
  workingOrders,
  workingOrderLines,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import type { BillDraftSnapshot } from "./order-drafts.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelBody } from "./testing/cancel-line.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  provisionBillVenue,
  send,
  tabWith,
  seatedWith,
  placedCounterBillMovedTo,
  type BillVenue,
} from "./testing/bill-venue.js";

const fault = vi.hoisted(() => ({ enabled: false, calls: 0, failAt: 1 }));
vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) => {
      const record = real.buildAltaRecord(...args);
      if (fault.enabled && ++fault.calls === fault.failAt)
        record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
      return record;
    },
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let venue: BillVenue;
beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
});
afterEach(() => {
  fault.enabled = false;
  fault.calls = 0;
  fault.failAt = 1;
});

function snapshot() {
  const names = suite.db
    .all<{ name: string }>(sql`select name from sqlite_schema where type = 'table' order by name`)
    .map((row) => row.name)
    .filter((name) =>
      /^(working_|order_|bill_|ticket_|kitchen_|service_commands|parties$|party_|sales$|sale_|tenders$|print_jobs$|drawer_opens$|invoice_series$|cadenas$|registros_facturacion$|envios$|attendance_|unpaid_departures$)/.test(
        name,
      ),
    );
  const result: Record<string, unknown> = {};
  for (const name of names) {
    if (!/^[a-z_0-9]+$/.test(name)) throw new Error("invalid snapshot identifier");
    result[name] = suite.db.all(sql.raw(`select * from "${name}"`));
  }
  return result;
}

async function paid(billId: string, amount: number) {
  await suite.db.insert(billPayments).values({
    workingOrderId: billId,
    submissionId: randomUUID(),
    fingerprint: "fixture",
    kind: "contribution",
    method: "cash",
    applied: amount,
    tendered: amount,
    state: "received",
    requestedBy: venue.operatorId,
    source: "device",
    deviceId: venue.deviceId,
    receivedAt: new Date().toISOString(),
  });
}

describe("late issuance rolls back its initiating command", () => {
  it.each([
    "held save",
    "line edit",
    "adjustment",
    "line cancellation",
    "bill split",
    "draft save",
    "draft split",
    "draft submit",
    "draft discard",
  ])("%s retains the command's rows and one refusal incident", async (kind) => {
    const [first, second] = await suite.db.select().from(products);
    if (first?.unitPrice == null || second?.unitPrice == null)
      throw new Error("fixture needs priced products");
    const reduces = ["adjustment", "line cancellation", "bill split"].includes(kind);
    const billId = await tabWith(venue, first.name, ...(reduces ? [second.name] : []));
    const [bill] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
    const partyId = bill!.partyId!;
    let method = "POST";
    let path: string;
    let body: Record<string, unknown>;
    if (kind.startsWith("draft")) {
      const saved = await send(venue.app, venue.cookie, "PUT", `/api/parties/${partyId}/drafts`, {
        billId,
        personId: venue.operatorId,
        draftId: null,
        revision: 0,
        expectedEdit: await readBillEditState(suite.db, billId),
        lines: [
          {
            menuItemId: venue.offerFor(second.name),
            variantId: null,
            menuVersionId: null,
            quantity: "1",
            options: [],
            extras: [],
            note: null,
            courseId: null,
            noMerge: false,
            slot: 1,
            joinGroupId: null,
            afterGroupId: null,
          },
        ],
      });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const state = saved.json as unknown as BillDraftSnapshot;
      const [party] = await suite.db.select().from(parties).where(eq(parties.id, partyId));
      const command = {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        expectedEdit: state.edit,
      };
      if (kind === "draft save") {
        method = "PUT";
        path = `/api/parties/${partyId}/drafts`;
        body = {
          billId,
          personId: venue.operatorId,
          draftId: state.draft!.id,
          revision: state.draft!.revision,
          expectedEdit: state.edit,
          lines: [],
        };
      } else {
        const action = kind.split(" ")[1];
        path = `/api/parties/${partyId}/drafts/${state.draft!.id}/${action}`;
        body =
          action === "split"
            ? { ...command, lineIds: state.draft!.lines.map((line) => line.id) }
            : action === "submit"
              ? {
                  ...command,
                  draftRevision: state.draft!.revision,
                  groups: [{ lineIds: state.draft!.lines.map((line) => line.id), release: "fire" }],
                }
              : { ...command, revision: state.draft!.revision, expectedRevision: bill!.revision };
      }
      await paid(billId, first.unitPrice + (kind === "draft submit" ? second.unitPrice : 0));
    } else {
      await paid(billId, first.unitPrice);
      const edit = await readBillEditState(suite.db, billId);
      const lines = await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId));
      const [party] = await suite.db.select().from(parties).where(eq(parties.id, partyId));
      if (kind === "held save") {
        method = "PUT";
        path = `/api/working-orders/${billId}`;
        body = {
          revision: bill!.revision,
          expectedEdit: edit,
          label: "Revised label",
          lines: lines.map((line) => ({
            workingOrderLineId: line.id,
            menuItemId: venue.offerFor(line.name),
            quantity: "1",
            options: [],
            extras: [],
          })),
        };
      } else if (kind === "line edit") {
        method = "PUT";
        path = `/api/working-orders/${billId}/lines/1`;
        body = { revision: bill!.revision, expectedEdit: edit, note: "Revised note" };
      } else if (kind === "bill split") {
        path = `/api/bills/${billId}/split`;
        body = {
          expectedPartyRevision: party!.revision,
          expectedEdit: edit,
          transfers: [{ lineNo: 2 }],
        };
      } else if (kind === "line cancellation") {
        path = `/api/parties/${partyId}/lines/${lines[1]!.id}/cancel-item`;
        body = {
          quantity: "1",
          expectedEdit: edit,
          outcome: "remove_charge",
          expectedPartyRevision: party!.revision,
          expectedBillRevision: bill!.revision,
          expectedContext: await readCancellationContext(suite.db, partyId, lines[1]!.id),
          submissionId: randomUUID(),
        };
      } else {
        path = `/api/working-orders/${billId}/adjustments`;
        body = await cancelBody(suite.db, billId, 2);
      }
    }
    const before = snapshot();
    fault.enabled = true;
    const answer = await send(venue.app, venue.cookie, method, path, body);
    expect(answer.json).toEqual({ code: "fiscal.fingerprint_mismatch", params: {} });
    expect(answer.status).toBe(409);
    expect(snapshot()).toEqual(before);
    expect(
      (await suite.db.select().from(incidents)).map((row) => ({
        code: row.code,
        saleId: row.saleId,
      })),
    ).toEqual([{ code: "fiscal.fingerprint_mismatch", saleId: null }]);
    fault.enabled = false;
    const repaired = await send(venue.app, venue.cookie, method, path, body);
    expect(repaired.status, JSON.stringify(repaired.json)).toBe(200);
    expect(suite.db.all(sql`select count(*) as count from registros_facturacion`)).toEqual([
      { count: 1 },
    ]);
  });

  it("a second refused departure invoice rolls back both bills and the party close", async () => {
    const [product] = await suite.db.select().from(products);
    const party = await seatedWith(venue, product!.name);
    const zone = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter", paidWhen: "prepay" }),
    );
    await placedCounterBillMovedTo(venue, zone.zoneId, party);
    const [row] = await suite.db.select().from(parties).where(eq(parties.id, party.partyId));
    const body = {
      expectedPartyRevision: row!.revision,
      expectedEdits: await withTransaction(suite.db, (tx) =>
        closingEditsForTest(tx, party.partyId),
      ),
      reason: "Guests left without paying",
      override: { personId: venue.adminId, pin: "1234" },
    };
    const before = snapshot();
    fault.enabled = true;
    fault.failAt = 2;
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/unpaid-departure`,
      body,
    );
    expect(fault.calls).toBe(2);
    expect(answer).toEqual({
      status: 409,
      json: { code: "fiscal.fingerprint_mismatch", params: {} },
    });
    expect(snapshot()).toEqual(before);
    expect((await suite.db.select().from(incidents)).map((row) => row.code)).toEqual([
      "fiscal.fingerprint_mismatch",
    ]);
  });

  it("a placed-order credit refusal leaves its original invoice unchanged", async () => {
    const [product] = await suite.db.select().from(products);
    const offers = await withTransaction(suite.db, (tx) =>
      offerProducts(tx, venue.cfg, {
        zone: "counter",
        orderStart: "counter",
        paidWhen: "ticket_then_pay",
      }),
    );
    const id = randomUUID();
    expect(
      (
        await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
          id,
          zoneId: offers.zoneId,
          lines: [{ menuItemId: offers.offerFor(product!.id), quantity: "1" }],
        })
      ).status,
    ).toBe(200);
    const deps = { db: suite.db, backend: venue.backend, clock: venue.clock };
    await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
    await placeOrder(deps, venue.cfg, id, venue.operatorId);
    const before = snapshot();
    fault.enabled = true;
    const answer = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/cancel`, {
      reason: "Wrong order",
      override: { personId: venue.adminId, pin: "1234" },
    });
    expect(answer).toEqual({
      status: 409,
      json: { code: "fiscal.fingerprint_mismatch", params: {} },
    });
    expect(snapshot()).toEqual(before);
    expect((await suite.db.select().from(incidents)).map((row) => row.code)).toEqual([
      "fiscal.fingerprint_mismatch",
    ]);
  });
});
