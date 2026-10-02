import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { floorZones, kitchenStations, locations, printers, watcherPrinters } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createStation } from "./kitchen.js";
import { inTx, setupPartyVenue } from "./testing/party-venue.js";
import {
  createWatcher,
  listWatchers,
  readWatcher,
  removeWatcher,
  updateWatcher,
  watcherSees,
  type WatcherInput,
} from "./watchers.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("watcher configuration", () => {
  it("matches a dish only when its station and zone are followed", () => {
    const pass = {
      everyStation: false,
      stationIds: ["grill", "fryer"],
      everyZone: true,
      zoneIds: [],
    };
    expect(watcherSees(pass, { stationId: "grill", zoneId: "terrace" })).toBe(true);
    expect(watcherSees(pass, { stationId: "fryer", zoneId: null })).toBe(true);
    expect(watcherSees(pass, { stationId: "cold", zoneId: "terrace" })).toBe(false);
    const runner = { everyStation: true, stationIds: [], everyZone: false, zoneIds: ["terrace"] };
    expect(watcherSees(runner, { stationId: "cold", zoneId: "terrace" })).toBe(true);
    expect(watcherSees(runner, { stationId: "cold", zoneId: "counter" })).toBe(false);
    expect(watcherSees(runner, { stationId: "cold", zoneId: null })).toBe(false);
  });

  it("creates, sorts, replaces follows, and switches off without losing the record", async () => {
    const v = await setupPartyVenue(suite.db);
    const [initial] = await inTx(v, (tx) =>
      tx.select({ id: kitchenStations.id }).from(kitchenStations),
    );
    const second = await inTx(v, (tx) => createStation(tx, v.cfg, { name: "Fryer" }));
    const input: WatcherInput = {
      name: "Pass",
      everyStation: false,
      stationIds: [initial!.id, initial!.id],
      everyZone: false,
      zoneIds: [v.tables.zoneId, v.tables.zoneId],
      runsPass: true,
      displayOrder: 2,
    };
    const { id } = await inTx(v, (tx) => createWatcher(tx, v.cfg, input));
    const early = await inTx(v, (tx) =>
      createWatcher(tx, v.cfg, { ...input, name: "Runner", displayOrder: 1 }),
    );
    const alphabetical = await inTx(v, (tx) =>
      createWatcher(tx, v.cfg, { ...input, name: "Alpha", displayOrder: 2 }),
    );
    expect((await inTx(v, (tx) => listWatchers(tx, v.cfg))).map((w) => w.id)).toEqual([
      early.id,
      alphabetical.id,
      id,
    ]);
    expect(await inTx(v, (tx) => readWatcher(tx, v.cfg, id))).toMatchObject({
      name: "Pass",
      stationIds: [initial!.id],
      zoneIds: [v.tables.zoneId],
      runsPass: true,
      printerIds: [],
    });
    await inTx(v, (tx) =>
      updateWatcher(tx, v.cfg, id, {
        ...input,
        stationIds: [second.id],
        zoneIds: [v.counter.zoneId],
      }),
    );
    expect(await inTx(v, (tx) => readWatcher(tx, v.cfg, id))).toMatchObject({
      stationIds: [second.id],
      zoneIds: [v.counter.zoneId],
    });
    const printerId = await inTx(v, async (tx) => {
      const [printer] = await tx
        .insert(printers)
        .values({
          locationId: v.cfg.locationId,
          name: "Pass printer",
          transport: "network_tcp",
          host: "10.0.0.8",
        })
        .returning({ id: printers.id });
      await tx.insert(watcherPrinters).values({ watcherId: id, printerId: printer!.id });
      return printer!.id;
    });
    expect(await inTx(v, (tx) => readWatcher(tx, v.cfg, id))).toMatchObject({
      printerIds: [printerId],
    });
    await inTx(v, (tx) => removeWatcher(tx, v.cfg, id));
    expect((await inTx(v, (tx) => listWatchers(tx, v.cfg))).some((w) => w.id === id)).toBe(false);
    expect(await inTx(v, (tx) => readWatcher(tx, v.cfg, id))).toMatchObject({
      active: false,
      stationIds: [second.id],
    });
    await expect(inTx(v, (tx) => updateWatcher(tx, v.cfg, id, input))).rejects.toMatchObject({
      code: "watcher.not_found",
      params: { watcherId: id },
    });
    expect(
      await inTx(v, (tx) =>
        tx.select().from(watcherPrinters).where(eq(watcherPrinters.watcherId, id)),
      ),
    ).toEqual([]);
    await inTx(v, (tx) => removeWatcher(tx, v.cfg, id));
    expect(await inTx(v, (tx) => createWatcher(tx, v.cfg, input))).toHaveProperty("id");
  });

  it("refuses invalid follows, cross-venue zones, duplicate names, and missing watchers with named errors", async () => {
    const v = await setupPartyVenue(suite.db);
    const [station] = await inTx(v, (tx) =>
      tx.select({ id: kitchenStations.id }).from(kitchenStations),
    );
    const input: WatcherInput = {
      name: "Pass",
      everyStation: false,
      stationIds: [station!.id],
      everyZone: false,
      zoneIds: [v.tables.zoneId],
      runsPass: false,
    };
    const reject = async (patch: Partial<WatcherInput>, code: string, params: object) => {
      await expect(
        inTx(v, (tx) => createWatcher(tx, v.cfg, { ...input, ...patch })),
      ).rejects.toMatchObject({ code, params });
    };
    await reject({ name: "  " }, "management.request_invalid", { field: "name" });
    await reject({ stationIds: [] }, "management.request_invalid", { field: "stationIds" });
    await reject({ everyStation: true }, "management.request_invalid", { field: "stationIds" });
    await reject({ zoneIds: [] }, "management.request_invalid", { field: "zoneIds" });
    await reject({ everyZone: true }, "management.request_invalid", { field: "zoneIds" });
    const off = await inTx(v, (tx) => createStation(tx, v.cfg, { name: "Off" }));
    await inTx(v, (tx) =>
      tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, off.id)),
    );
    await reject({ stationIds: [off.id] }, "station.not_found", { stationId: off.id });
    const foreign = await inTx(v, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Elsewhere",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurant",
        })
        .returning({ id: locations.id });
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: location!.id, name: "Other terrace" })
        .returning({ id: floorZones.id });
      return { locationId: location!.id, zoneId: zone!.id };
    });
    await reject({ zoneIds: [foreign.zoneId] }, "zone.not_found", { zoneId: foreign.zoneId });
    const existing = await inTx(v, (tx) => createWatcher(tx, v.cfg, input));
    await reject({}, "watcher.name_taken", { name: "Pass" });
    const missing = randomUUID();
    await expect(inTx(v, (tx) => updateWatcher(tx, v.cfg, missing, input))).rejects.toMatchObject({
      code: "watcher.not_found",
      params: { watcherId: missing },
    });
    await expect(inTx(v, (tx) => removeWatcher(tx, v.cfg, missing))).rejects.toMatchObject({
      code: "watcher.not_found",
      params: { watcherId: missing },
    });
    const foreignCfg = { ...v.cfg, locationId: foreign.locationId as typeof v.cfg.locationId };
    await expect(
      inTx(v, (tx) => updateWatcher(tx, foreignCfg, existing.id, input)),
    ).rejects.toMatchObject({ code: "watcher.not_found", params: { watcherId: existing.id } });
    await expect(inTx(v, (tx) => removeWatcher(tx, foreignCfg, existing.id))).rejects.toMatchObject(
      { code: "watcher.not_found", params: { watcherId: existing.id } },
    );
  });
});
