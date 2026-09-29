import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { billPartyTableLabels, partySurvivors, partyTableLabels } from "./party-table-labels.js";
import { diningTables } from "./schema/dining-tables.js";
import { parties, partyTables } from "./schema/parties.js";
import { locations } from "./schema/tenants.js";
import { seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const LOCATION = "cccccccc-0000-4000-8000-000000000001";
const OPERATOR = "cccccccc-2222-4000-8000-000000000001";

describe("party table labels", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  beforeAll(async () => {
    await seedTenant(suite.db);
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
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
        const [created] = await tx
          .insert(diningTables)
          .values({ id: table.id, locationId: LOCATION, label: table.label })
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

  it("breaks a tie on join time by the membership row's id", async () => {
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
    expect(await inTx((tx) => partyTableLabels(tx, [id]))).toEqual(new Map([[id, ["E", "D"]]]));
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
});
