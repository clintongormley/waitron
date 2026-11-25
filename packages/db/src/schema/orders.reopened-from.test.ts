import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { refusalOn, restrictRefused, triggerRaised } from "../constraint-target.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedNode, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { REOPENED_FROM_REFUSAL, TRANSITION_REFUSAL } from "../trigger-refusals.js";
import { workingOrders } from "./orders.js";

const AT = "2026-11-25T12:00:00.000Z";

let nodeId = "";

describe("working_orders.reopened_from: an open bill is linked once to the placed bill it reopens", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await seedVenue(suite.db, { name: "Loc", invoiceLocales: ["es"] });
    nodeId = await seedNode(suite.db);
  });

  type Status = "open" | "placed" | "settled" | "abandoned";

  async function bill(status: Status): Promise<string> {
    const row = await seedWorkingOrder(suite.db, {
      source: "dashboard",
      deviceId: null,
      nodeId,
      status,
      openedAt: AT,
      ...(status === "settled" ? { settledAt: AT } : {}),
    });
    return row.id;
  }

  function update(id: string, set: string): Promise<unknown> {
    return withTransaction(suite.db, async (tx) =>
      tx.run(sql`update working_orders set ${sql.raw(set)} where id = ${id}`),
    );
  }

  function link(id: string, to: string | null): Promise<unknown> {
    return withTransaction(suite.db, async (tx) =>
      tx.run(sql`update working_orders set reopened_from = ${to} where id = ${id}`),
    );
  }

  async function reopenedFrom(id: string): Promise<string | null> {
    const [row] = await suite.db
      .select({ reopenedFrom: workingOrders.reopenedFrom })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    return row!.reopenedFrom;
  }

  async function expectRefused(write: () => Promise<unknown>, id: string, before: string | null) {
    const error = await captureError(write);
    expect(triggerRaised(error, REOPENED_FROM_REFUSAL)).toBe(true);
    expect(await reopenedFrom(id)).toBe(before);
  }

  it("an open bill is linked once to a placed bill, and keeps the link as that bill is abandoned", async () => {
    const printed = await bill("placed");
    const reopened = await bill("open");
    await link(reopened, printed);
    await update(printed, `status = 'abandoned'`);
    expect(await reopenedFrom(reopened)).toBe(printed);
  });

  it("a second bill cannot be linked to the same printed bill", async () => {
    const printed = await bill("placed");
    const first = await bill("open");
    const second = await bill("open");
    await link(first, printed);
    const error = await captureError(() => link(second, printed));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "working_orders", columns: ["reopened_from"] }),
    ).toBe(true);
    expect(await reopenedFrom(second)).toBeNull();
    expect(await reopenedFrom(first)).toBe(printed);
  });

  it.each(["open", "abandoned", "settled"] as const)(
    "is not linked to a bill that is %s",
    async (status) => {
      const target = await bill(status);
      const reopened = await bill("open");
      await expectRefused(() => link(reopened, target), reopened, null);
    },
  );

  it("is not linked to itself", async () => {
    const reopened = await bill("open");
    await expectRefused(() => link(reopened, reopened), reopened, null);
  });

  it("is not linked on a bill that is placed, which the transition trigger answers", async () => {
    const printed = await bill("placed");
    const other = await bill("placed");
    const error = await captureError(() => link(other, printed));
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
    expect(await reopenedFrom(other)).toBeNull();
  });

  it("is not linked on a bill that becomes placed in the same update", async () => {
    const printed = await bill("placed");
    const reopened = await bill("open");
    await expectRefused(
      () => update(reopened, `status = 'placed', reopened_from = '${printed}'`),
      reopened,
      null,
    );
  });

  it("is not changed or cleared once set", async () => {
    const printed = await bill("placed");
    const another = await bill("placed");
    const reopened = await bill("open");
    await link(reopened, printed);
    await expectRefused(() => link(reopened, another), reopened, printed);
    await expectRefused(() => link(reopened, null), reopened, printed);
  });

  it("is not set at insert", async () => {
    const printed = await bill("placed");
    const error = await captureError(() =>
      seedWorkingOrder(suite.db, {
        source: "dashboard",
        deviceId: null,
        nodeId,
        status: "open",
        openedAt: AT,
        reopenedFrom: printed,
      }),
    );
    expect(triggerRaised(error, REOPENED_FROM_REFUSAL)).toBe(true);
  });

  it("is not linked to a bill that does not exist", async () => {
    const reopened = await bill("open");
    await expectRefused(
      () => link(reopened, "aaaaaaaa-0000-4000-8000-000000000000"),
      reopened,
      null,
    );
  });

  it("keeps the bill it names from being deleted", async () => {
    const printed = await bill("placed");
    const reopened = await bill("open");
    await link(reopened, printed);
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) =>
        tx.delete(workingOrders).where(eq(workingOrders.id, printed)),
      ),
    );
    expect(restrictRefused(error)).toBe(true);
  });

  it.each([
    ["unlinked", false],
    ["linked", true],
  ] as const)(
    "an %s open bill still takes changes that leave the link alone",
    async (_name, linked) => {
      const printed = await bill("placed");
      const reopened = await bill("open");
      if (linked) await link(reopened, printed);
      await update(reopened, `label = 'Window', status = 'placed'`);
      const [row] = await suite.db
        .select({ label: workingOrders.label, status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, reopened));
      expect(row).toEqual({ label: "Window", status: "placed" });
      expect(await reopenedFrom(reopened)).toBe(linked ? printed : null);
    },
  );
});
