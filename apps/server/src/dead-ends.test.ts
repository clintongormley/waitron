import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { kitchenStations } from "@waitron/db";
import { eq } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell, setStationToday } from "@waitron/venue-service";
import { findDeadEnds } from "./dead-ends.js";
import { inTx, setupPartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("findDeadEnds", () => {
  it("names the closed station for a dish with no replacement and leaves an explicitly routed dish out", async () => {
    const v = await setupPartyVenue(suite.db);
    const stationName = `Upstairs bar ${randomUUID()}`;
    const [bar] = await suite.db
      .insert(kitchenStations)
      .values({
        locationId: v.cfg.locationId,
        name: stationName,
      })
      .returning({ id: kitchenStations.id });
    const at = new Date();
    await inTx(v, async (tx) => {
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Caña") }, zoneId: null },
        { kind: "station", stationId: bar!.id },
      );
      const [kitchen] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Burger") }, zoneId: null },
        { kind: "station", stationId: kitchen!.id },
      );
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, kitchen!.id));
      await setStationToday(tx, v.cfg, bar!.id, "closed", at);
    });
    const answer = await inTx(v, (tx) =>
      findDeadEnds(
        tx,
        v.cfg,
        v.counter.zoneId,
        [
          { key: "lager", productId: v.productId("Caña"), quantity: "2", makeAt: null },
          { key: "bread", productId: v.productId("Burger"), quantity: "1", makeAt: null },
        ],
        at,
      ),
    );
    expect(answer).toEqual([
      {
        key: "lager",
        name: "Caña",
        quantity: "2",
        stationId: bar!.id,
        stationName,
        why: "closed",
      },
    ]);
    const chosen = await inTx(v, (tx) =>
      findDeadEnds(
        tx,
        v.cfg,
        v.counter.zoneId,
        [{ key: "lager", productId: v.productId("Caña"), quantity: "2", makeAt: bar!.id }],
        at,
      ),
    );
    expect(chosen).toEqual([]);
    await inTx(v, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, bar!.id)),
    );
    const switchedOff = await inTx(v, (tx) =>
      findDeadEnds(
        tx,
        v.cfg,
        v.counter.zoneId,
        [{ key: "lager", productId: v.productId("Caña"), quantity: "2", makeAt: null }],
        at,
      ),
    );
    expect(switchedOff).toMatchObject([{ key: "lager", stationId: bar!.id, why: "switched_off" }]);
    await inTx(v, (tx) =>
      tx.update(kitchenStations).set({ active: true }).where(eq(kitchenStations.id, bar!.id)),
    );
    const [destination] = await suite.db
      .insert(kitchenStations)
      .values({
        locationId: v.cfg.locationId,
        name: `Destination bar ${randomUUID()}`,
      })
      .returning({ id: kitchenStations.id });
    await inTx(v, (tx) => setStationToday(tx, v.cfg, bar!.id, "closed", at, destination!.id));
    const replaced = await inTx(v, (tx) =>
      findDeadEnds(
        tx,
        v.cfg,
        v.counter.zoneId,
        [{ key: "lager", productId: v.productId("Caña"), quantity: "2", makeAt: null }],
        at,
      ),
    );
    expect(replaced).toEqual([]);
  });
});
