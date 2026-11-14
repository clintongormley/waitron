import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// records a sale; every case's payment is a part payment of a 35.00 Paella bill.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const billId = await tabWith(venue, "Paella");
    const settled = await pay(venue.app, billId, cashPart("35.00"));
    if (settled.status !== 200) throw new Error(`setup sale answered ${settled.status}`);
  },
});

const MINUTE = 60_000;

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const at = (ms: number) => venue.appAt(clockAt(ms));

function cashPart(amount = "10.00") {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

function pay(app: Hono, billId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
}

function drawerJobs(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from print_jobs where kind = 'drawer'`,
  );
  return row!.n;
}

it("answers a bill payment's replay", async () => {
  const now = nowMs();
  const billId = await tabWith(venue, "Paella");
  const body = cashPart();
  const first = await pay(at(now), billId, body);
  expect(first.status).toBe(200);
  const drawers = drawerJobs();

  const replay = await pay(at(now - 10 * MINUTE), billId, body);

  expect(replay.status).toBe(200);
  expect((replay.json.payment as { id: string }).id).toBe(
    (first.json.payment as { id: string }).id,
  );
  expect(await paymentRows(venue, billId)).toHaveLength(1);
  expect(drawerJobs()).toBe(drawers);
});
