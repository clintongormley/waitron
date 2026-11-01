import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ticketItems, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { TicketState } from "./kitchen-print.js";
import {
  heldItem,
  initiatedAt,
  initiatedItem,
  kitchenPhase,
  requestedItem,
  type KitchenPhase,
} from "./kitchen-phase.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import "./errors.js";

const T = "2026-11-01T12:00:00.000Z";
const U = "2026-11-01T12:05:00.000Z";

describe("A773 phases", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  beforeAll(() => useSplitExtrasDb(suite.db));

  it.each<[string | null, string | null, TicketState, KitchenPhase]>([
    [null, null, "queued", "held"],
    [T, null, "queued", "requested"],
    [T, T, "queued", "waiting"],
    [null, T, "queued", "waiting"],
    [T, T, "preparing", "preparing"],
    [T, T, "ready", "ready"],
  ])("(%s, %s, %s) reads as %s", (requestedAt, firedAt, state, phase) => {
    expect(kitchenPhase({ requestedAt, firedAt, state })).toBe(phase);
  });

  it.each<[string | null, string | null, string | null]>([
    [null, null, null],
    [T, null, T],
    [null, T, T],
    [T, U, T],
  ])("initiatedAt(%s, %s) is %s", (requestedAt, firedAt, expected) => {
    expect(initiatedAt({ requestedAt, firedAt })).toBe(expected);
  });

  it("SQL twins agree with kitchenPhase over the same rows", async () => {
    const venue = await setupSplitExtrasVenue();
    const burger = { productId: venue.products.burger, quantity: "1" };
    const orderId = await withTransaction(suite.db, (tx) =>
      fireNewOrder(tx, venue.cfg, [burger, burger, burger, burger]),
    );
    const items = await suite.db
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, orderId));
    expect(items).toHaveLength(4);
    const stamps: { requestedAt: string | null; firedAt: string | null; state: TicketState }[] = [
      { requestedAt: null, firedAt: null, state: "queued" },
      { requestedAt: T, firedAt: null, state: "queued" },
      { requestedAt: null, firedAt: T, state: "queued" },
      { requestedAt: T, firedAt: T, state: "preparing" },
    ];
    await withTransaction(suite.db, async (tx) => {
      for (const [index, stamp] of stamps.entries())
        await tx.update(ticketItems).set(stamp).where(eq(ticketItems.id, items[index]!.id));
    });
    const rows = await suite.db
      .select({
        id: ticketItems.id,
        requestedAt: ticketItems.requestedAt,
        firedAt: ticketItems.firedAt,
        state: ticketItems.state,
      })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, orderId));
    const ids = items.map((item) => item.id);
    const matching = async (condition: ReturnType<typeof heldItem>) =>
      (
        await suite.db
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(and(inArray(ticketItems.id, ids), condition))
      )
        .map((row) => row.id)
        .sort();
    const whose = (test: (phase: KitchenPhase) => boolean) =>
      rows
        .filter((row) => test(kitchenPhase(row)))
        .map((row) => row.id)
        .sort();

    expect(await matching(heldItem())).toEqual(whose((phase) => phase === "held"));
    expect(await matching(requestedItem())).toEqual(whose((phase) => phase === "requested"));
    expect(await matching(initiatedItem())).toEqual(whose((phase) => phase !== "held"));
    expect(whose((phase) => phase === "held")).toHaveLength(1);
    expect(whose((phase) => phase === "requested")).toHaveLength(1);
  });
});
