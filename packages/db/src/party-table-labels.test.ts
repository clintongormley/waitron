import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import {
  billPartyTableLabels,
  orderTableLabels,
  partySurvivors,
  partyTableLabels,
  tableOwnNames,
} from "./party-table-labels.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorTodayJoins, floorTodayJoinTables, floorTodayTables } from "./schema/floor-plans.js";
import { floorZones } from "./schema/floor-zones.js";
import { parties, partyTables } from "./schema/parties.js";
import { locations } from "./schema/tenants.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const LOCATION = "cccccccc-0000-4000-8000-000000000001";
const OTHER_LOCATION = "cccccccc-0000-4000-8000-000000000002";
const OPERATOR = "cccccccc-2222-4000-8000-000000000001";

describe("party table labels", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  beforeAll(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values([
      { id: LOCATION, name: "Room", invoiceLocales: ["es"], operationDescription: "Hostelería" },
      {
        id: OTHER_LOCATION,
        name: "Other room",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  /**
   * A party seated at one new table per entry, each joined at its own time, left where given; an
   * entry's `id` is its table's id and, unless `rowId` is given, its membership row's too.
   */
  async function party(
    tables: {
      label: string;
      joinedAt: string;
      leftAt?: string;
      id?: string;
      rowId?: string;
    }[] = [],
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(parties)
        .values({ openedBy: OPERATOR })
        .returning({ id: parties.id });
      for (const table of tables) {
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: LOCATION, name: table.label })
          .returning({ id: floorZones.id });
        const [created] = await tx
          .insert(diningTables)
          .values({ id: table.id, locationId: LOCATION, label: table.label, zoneId: zone!.id })
          .returning({ id: diningTables.id });
        await tx.insert(partyTables).values({
          id: table.rowId ?? table.id,
          partyId: row!.id,
          tableId: created!.id,
          joinedAt: table.joinedAt,
          leftAt: table.leftAt ?? null,
        });
      }
      return row!.id;
    });
  }

  async function merge(from: string, into: string): Promise<void> {
    await inTx((tx) =>
      tx
        .update(parties)
        .set({ state: "closed", closedAt: "2026-09-29T21:00:00.000Z", mergedIntoPartyId: into })
        .where(eq(parties.id, from)),
    );
  }

  const LEFT = { joinedAt: "2026-09-29T20:00:00.000Z", leftAt: "2026-09-29T20:30:00.000Z" };

  it("lists a party's active tables in the order they joined, not by id or label", async () => {
    const id = await party([
      {
        id: "00000000-0000-4000-8000-00000000000a",
        label: "A",
        joinedAt: "2026-09-29T20:02:00.000Z",
      },
      {
        id: "ffffffff-0000-4000-8000-00000000000a",
        label: "B",
        joinedAt: "2026-09-29T20:00:00.000Z",
      },
      { label: "C", ...LEFT },
    ]);
    expect(await inTx((tx) => partyTableLabels(tx, [id]))).toEqual(new Map([[id, ["B", "A"]]]));
  });

  it("breaks a tie on join time by writing order, against the membership ids", async () => {
    const at = "2026-09-29T20:00:00.000Z";
    const id = await party([
      {
        id: "00000000-0000-4000-8000-00000000000c",
        rowId: "ffffffff-0000-4000-8000-00000000000b",
        label: "D",
        joinedAt: at,
      },
      {
        id: "ffffffff-0000-4000-8000-00000000000c",
        rowId: "00000000-0000-4000-8000-00000000000b",
        label: "E",
        joinedAt: at,
      },
    ]);
    expect(await inTx((tx) => partyTableLabels(tx, [id]))).toEqual(new Map([[id, ["D", "E"]]]));
  });

  it("answers an empty map when asked about no party", async () => {
    expect(await inTx((tx) => partyTableLabels(tx, []))).toEqual(new Map());
    expect(await inTx((tx) => billPartyTableLabels(tx, []))).toEqual(new Map());
  });

  it("follows a chain of merges to its end, and answers a never-merged party with itself", async () => {
    const survivor = await party();
    const middle = await party();
    const first = await party();
    await merge(middle, survivor);
    await merge(first, middle);
    expect(await inTx((tx) => partySurvivors(tx, [first, middle, survivor]))).toEqual(
      new Map([
        [first, survivor],
        [middle, survivor],
        [survivor, survivor],
      ]),
    );
  });

  it("names a seated party after its own tables, even when it was merged into another", async () => {
    const survivor = await party([{ label: "Table 9", joinedAt: "2026-09-29T20:00:00.000Z" }]);
    const seated = await party([{ label: "Table 1", joinedAt: "2026-09-29T20:00:00.000Z" }]);
    await merge(seated, survivor);
    expect(await inTx((tx) => billPartyTableLabels(tx, [seated]))).toEqual(
      new Map([[seated, ["Table 1"]]]),
    );
  });

  it("names a party that holds no table after the tables of the party at the end of its merges", async () => {
    const survivor = await party([
      { label: "Table 7", joinedAt: "2026-09-29T20:20:00.000Z" },
      { label: "Table 8", joinedAt: "2026-09-29T20:21:00.000Z" },
    ]);
    const middle = await party([{ label: "Table 6", ...LEFT }]);
    const first = await party([{ label: "Table 4", ...LEFT }]);
    const second = await party([{ label: "Table 5", ...LEFT }]);
    const seated = await party([{ label: "Table 2", joinedAt: "2026-09-29T20:00:00.000Z" }]);
    const alone = await party([{ label: "Table 3", ...LEFT }]);
    await merge(middle, survivor);
    await merge(first, middle);
    await merge(second, survivor);
    expect(
      await inTx((tx) => billPartyTableLabels(tx, [first, second, seated, alone, survivor])),
    ).toEqual(
      new Map([
        [first, ["Table 7", "Table 8"]],
        [second, ["Table 7", "Table 8"]],
        [seated, ["Table 2"]],
        [alone, []],
        [survivor, ["Table 7", "Table 8"]],
      ]),
    );
    expect(await inTx((tx) => billPartyTableLabels(tx, [first, second]))).toEqual(
      new Map([
        [first, ["Table 7", "Table 8"]],
        [second, ["Table 7", "Table 8"]],
      ]),
    );
  });

  it("names a party that holds no table by its own empty list when its merges form a cycle", async () => {
    const first = await party([{ label: "Table 10", ...LEFT }]);
    const second = await party([{ label: "Table 11", ...LEFT }]);
    await merge(first, second);
    await merge(second, first);
    expect(await inTx((tx) => billPartyTableLabels(tx, [first, second]))).toEqual(
      new Map([
        [first, []],
        [second, []],
      ]),
    );
  });

  it("names a party that does not exist by an empty list", async () => {
    const missing = "cccccccc-9999-4000-8000-000000000001";
    expect(await inTx((tx) => billPartyTableLabels(tx, [missing]))).toEqual(
      new Map([[missing, []]]),
    );
  });

  async function nameToday(tableId: string, name: string | null): Promise<void> {
    await inTx((tx) => tx.insert(floorTodayTables).values({ tableId, name }));
  }

  async function group(tableIds: readonly string[], name: string | null = null): Promise<void> {
    await inTx(async (tx) => {
      const [{ zoneId }] = await tx
        .select({ zoneId: diningTables.zoneId })
        .from(diningTables)
        .where(eq(diningTables.id, tableIds[0]!));
      const [join] = await tx
        .insert(floorTodayJoins)
        .values({ zoneId: zoneId!, seats: 10, name })
        .returning({ id: floorTodayJoins.id });
      for (const tableId of tableIds) {
        await tx
          .insert(floorTodayJoinTables)
          .values({ joinId: join!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
      }
    });
  }

  /** Bar, Counter 3, 4 and 5 (each label suffixed), joining a new party in that order. */
  async function longTable() {
    const s = randomUUID().slice(0, 6);
    const ids = { bar: randomUUID(), c3: randomUUID(), c4: randomUUID(), c5: randomUUID() };
    const labels = {
      bar: `Bar ${s}`,
      c3: `Counter 3 ${s}`,
      c4: `Counter 4 ${s}`,
      c5: `Counter 5 ${s}`,
    };
    const partyId = await party(
      (["bar", "c3", "c4", "c5"] as const).map((key, i) => ({
        id: ids[key],
        label: labels[key],
        joinedAt: `2026-09-29T20:0${i + 1}:00.000Z`,
      })),
    );
    return { s, ids, labels, partyId };
  }

  describe("today's names", () => {
    it("lists a named group's name once in place of its tables", async () => {
      const { s, ids, partyId } = await longTable();
      await group([ids.bar, ids.c3, ids.c4, ids.c5], `García birthday ${s}`);
      await nameToday(ids.c4, `Window ${s}`);
      expect(await inTx((tx) => partyTableLabels(tx, [partyId]))).toEqual(
        new Map([[partyId, [`García birthday ${s}`]]]),
      );
    });

    it("places a named group among the party's other tables by the order they joined", async () => {
      const s = randomUUID().slice(0, 6);
      const [bar, c3, nine] = [randomUUID(), randomUUID(), randomUUID()];
      const later = await party([
        { id: bar, label: `Bar ${s}`, joinedAt: "2026-09-29T20:01:00.000Z" },
        { id: c3, label: `Counter 3 ${s}`, joinedAt: "2026-09-29T20:02:00.000Z" },
        { id: nine, label: `Table 9 ${s}`, joinedAt: "2026-09-29T20:03:00.000Z" },
      ]);
      await group([bar, c3], `García birthday ${s}`);
      expect(await inTx((tx) => partyTableLabels(tx, [later]))).toEqual(
        new Map([[later, [`García birthday ${s}`, `Table 9 ${s}`]]]),
      );

      const t = randomUUID().slice(0, 6);
      const [bar2, c32, nine2] = [randomUUID(), randomUUID(), randomUUID()];
      const earlier = await party([
        { id: nine2, label: `Table 9 ${t}`, joinedAt: "2026-09-29T20:00:00.000Z" },
        { id: bar2, label: `Bar ${t}`, joinedAt: "2026-09-29T20:01:00.000Z" },
        { id: c32, label: `Counter 3 ${t}`, joinedAt: "2026-09-29T20:02:00.000Z" },
      ]);
      await group([bar2, c32], `García birthday ${t}`);
      expect(await inTx((tx) => partyTableLabels(tx, [earlier]))).toEqual(
        new Map([[earlier, [`Table 9 ${t}`, `García birthday ${t}`]]]),
      );
    });

    it("names each table by its own today's name, else its label, never its group's name", async () => {
      const { s, ids, labels } = await longTable();
      await group([ids.bar, ids.c3], `García birthday ${s}`);
      await nameToday(ids.c3, `Window ${s}`);
      expect(await inTx((tx) => tableOwnNames(tx, [ids.bar, ids.c3, ids.c4]))).toEqual(
        new Map([
          [ids.bar, labels.bar],
          [ids.c3, `Window ${s}`],
          [ids.c4, labels.c4],
        ]),
      );
      expect(await inTx((tx) => tableOwnNames(tx, []))).toEqual(new Map());
    });

    it("lists each table of an unnamed group by its own today's name, else its label", async () => {
      const { s, ids, labels, partyId } = await longTable();
      await group([ids.bar, ids.c3, ids.c4, ids.c5]);
      await nameToday(ids.c4, `Window ${s}`);
      await nameToday(ids.c5, null);
      expect(await inTx((tx) => partyTableLabels(tx, [partyId]))).toEqual(
        new Map([[partyId, [labels.bar, labels.c3, `Window ${s}`, labels.c5]]]),
      );
    });

    it("lists a group's name for each party seated at one of its tables", async () => {
      const s = randomUUID().slice(0, 6);
      const [bar, c3] = [randomUUID(), randomUUID()];
      const first = await party([{ id: bar, label: `Bar ${s}`, ...AT }]);
      const second = await party([{ id: c3, label: `Counter 3 ${s}`, ...AT }]);
      await group([bar, c3], `García birthday ${s}`);
      expect(await inTx((tx) => partyTableLabels(tx, [first, second]))).toEqual(
        new Map([
          [first, [`García birthday ${s}`]],
          [second, [`García birthday ${s}`]],
        ]),
      );
    });

    it("lists each of two groups sharing one name, both at one party", async () => {
      const { s, ids, partyId } = await longTable();
      await group([ids.bar, ids.c3], `García birthday ${s}`);
      await group([ids.c4, ids.c5], `García birthday ${s}`);
      expect(await inTx((tx) => partyTableLabels(tx, [partyId]))).toEqual(
        new Map([[partyId, [`García birthday ${s}`, `García birthday ${s}`]]]),
      );
    });

    it("lists both of two tables in no group whose shown names are the same", async () => {
      const { ids, labels, partyId } = await longTable();
      await nameToday(ids.c4, labels.bar);
      expect(await inTx((tx) => partyTableLabels(tx, [partyId]))).toEqual(
        new Map([[partyId, [labels.bar, labels.c3, labels.bar, labels.c5]]]),
      );
    });

    it("names an order delivered to a table by its group's name, else its own, else its saved label", async () => {
      const s = randomUUID().slice(0, 6);
      const bar = await table(`Bar ${s}`);
      const c3 = await table(`Counter 3 ${s}`);
      const c4 = await table(`Counter 4 ${s}`);
      const c5 = await table(`Counter 5 ${s}`);
      await group([c3, c4], `García birthday ${s}`);
      await nameToday(c4, `Window ${s}`);
      await nameToday(c5, `Terrace ${s}`);
      const delivered = (id: string, deliveryTableId: string) => ({
        id,
        partyId: null,
        deliveryTableId,
        deliveryTableLabel: null,
        label: "Luis",
      });
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            delivered("bar", bar),
            delivered("c3", c3),
            delivered("c4", c4),
            delivered("c5", c5),
          ]),
        ),
      ).toEqual(
        new Map([
          ["bar", `Bar ${s}`],
          ["c3", `García birthday ${s}`],
          ["c4", `García birthday ${s}`],
          ["c5", `Terrace ${s}`],
        ]),
      );
    });

    it("names an order delivered to a renamed table, and a party bill, by the shown names", async () => {
      const { s, ids, partyId } = await longTable();
      await group([ids.bar, ids.c3, ids.c4, ids.c5], `García birthday ${s}`);
      const window = await table(`Terrace ${s}`);
      await nameToday(window, `Window ${s}`);
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            {
              id: "delivered",
              partyId: null,
              deliveryTableId: window,
              deliveryTableLabel: null,
              label: "Luis",
            },
            { id: "bill", partyId, deliveryTableId: null, deliveryTableLabel: null, label: "Ana" },
          ]),
        ),
      ).toEqual(
        new Map([
          ["delivered", `Window ${s}`],
          ["bill", `García birthday ${s}`],
        ]),
      );
    });
  });

  async function table(label: string, locationId = LOCATION): Promise<string> {
    const [row] = await inTx(async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId, name: label })
        .returning({ id: floorZones.id });
      return tx
        .insert(diningTables)
        .values({ locationId, label, zoneId: zone!.id })
        .returning({ id: diningTables.id });
    });
    return row!.id;
  }

  const AT = { joinedAt: "2026-09-29T20:00:00.000Z" };

  describe("orderTableLabels", () => {
    it("names a party bill after its party's tables, not its delivery table or its label", async () => {
      const partyId = await party([
        { label: "Table 21", ...AT },
        { label: "Table 22", joinedAt: "2026-09-29T20:01:00.000Z" },
      ]);
      const deliveryTableId = await table("Bar 1");
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            { id: "bill", partyId, deliveryTableId, deliveryTableLabel: null, label: "Ana" },
          ]),
        ),
      ).toEqual(new Map([["bill", "Table 21, 22"]]));
    });

    it("names a party bill by its label once its party holds no table", async () => {
      const partyId = await party([{ label: "Table 23", ...LEFT }]);
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            { id: "bill", partyId, deliveryTableId: null, deliveryTableLabel: null, label: "Ana" },
          ]),
        ),
      ).toEqual(new Map([["bill", "Ana"]]));
    });

    it("names the bill of a party merged into another after the survivor's tables", async () => {
      const survivor = await party([{ label: "Table 24", ...AT }]);
      const merged = await party([{ label: "Table 25", ...LEFT }]);
      await merge(merged, survivor);
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            {
              id: "bill",
              partyId: merged,
              deliveryTableId: null,
              deliveryTableLabel: null,
              label: "Ana",
            },
          ]),
        ),
      ).toEqual(new Map([["bill", "Table 24"]]));
    });

    it("names an order of no party after the table it is delivered to, else its label, else nothing", async () => {
      const deliveryTableId = await table("Terrace 3");
      const elsewhere = await table("Terrace 3", OTHER_LOCATION);
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            {
              id: "delivered",
              partyId: null,
              deliveryTableId,
              deliveryTableLabel: null,
              label: "Luis",
            },
            {
              id: "labelled",
              partyId: null,
              deliveryTableId: null,
              deliveryTableLabel: null,
              label: "Marta",
            },
            {
              id: "walk-up",
              partyId: null,
              deliveryTableId: null,
              deliveryTableLabel: null,
              label: null,
            },
            {
              id: "elsewhere",
              partyId: null,
              deliveryTableId: elsewhere,
              deliveryTableLabel: null,
              label: "Pepe",
            },
          ]),
        ),
      ).toEqual(
        new Map([
          ["delivered", "Terrace 3"],
          ["labelled", "Marta"],
          ["walk-up", null],
          ["elsewhere", "Pepe"],
        ]),
      );
    });

    it("names an order whose delivery table was let go after the name kept for it", async () => {
      expect(
        await inTx((tx) =>
          orderTableLabels(tx, LOCATION, [
            {
              id: "released",
              partyId: null,
              deliveryTableId: null,
              deliveryTableLabel: "Terrace 9",
              label: "Luis",
            },
          ]),
        ),
      ).toEqual(new Map([["released", "Terrace 9"]]));
    });

    it("answers an empty map when asked about no order", async () => {
      expect(await inTx((tx) => orderTableLabels(tx, LOCATION, []))).toEqual(new Map());
    });
  });
});
