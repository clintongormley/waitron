import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  inTx,
  provisionBillVenue,
  fiscalRecordCount,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIGRATIONS = migrationOptionsFor(manifestSets(), null);

interface OpenVenue {
  venue: BillVenue;
  counter: ZoneOffers;
  productId: string;
}

/** A bill venue whose counter offers every dish, and whose "Counter till" profile, and so every
 * device on it, may print and clock in. */
async function openVenue(db: Database): Promise<OpenVenue> {
  const venue = await provisionBillVenue(db);
  const counter = await inTx(venue, (tx) => offerProducts(tx, venue.cfg));
  const [dish] = db.all<{ id: string }>(sql`select id from products where name = 'Paella'`);
  db.run(sql`
    update device_profiles
    set capabilities = json_insert(json_insert(capabilities, '$[#]', 'print-receipt'), '$[#]', 'clock-in')
    where name = 'Counter till'
  `);
  return { venue, counter, productId: dish!.id };
}

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

function latest(db: Database): { at: Date; offsetMinutes: number } | undefined {
  const [row] = db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return row === undefined ? undefined : { at: new Date(row.at), offsetMinutes: row.offsetMinutes };
}

function cashSale(open: OpenVenue, app: Hono, id: string) {
  return send(app, open.venue.cookie, "POST", "/api/sales", {
    workingOrderId: id,
    zoneId: open.counter.zoneId,
    lines: [{ menuItemId: open.counter.offerFor(open.productId), quantity: "1" }],
    tender: { method: "cash", amount: "35.00" },
  });
}

describe("a venue database with no records", () => {
  let open: OpenVenue;

  // Its only sale is written on a clock a year behind the real one, so it has a database of its own.
  useVenueDb({
    migrations: MIGRATIONS,
    timeoutMs: 60_000,
    setup: async (db) => {
      open = await openVenue(db);
    },
  });

  it("takes a cash sale on a clock a year behind today", async () => {
    expect(latest(open.venue.db)).toBeUndefined();
    const yearBehind = Date.now() - 365 * DAY;
    const id = randomUUID();

    const sold = await cashSale(open, open.venue.appAt(clockAt(yearBehind)), id);

    expect(sold.status).toBe(200);
    expect(fiscalRecordCount(open.venue, id)).toBe(1);
    expect(latest(open.venue.db)!.at.getTime()).toBe(Math.floor(yearBehind / 1000) * 1000);
  });
});
