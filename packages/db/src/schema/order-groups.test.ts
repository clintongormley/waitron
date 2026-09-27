import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { orderGroupEvents, orderGroups } from "./order-groups.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";
import { visits } from "./visits.js";

const LOCATION = "bbbbbbbb-0000-4000-8000-000000000002";
const TILL = "bbbbbbbb-1111-4000-8000-000000000002";
const OPERATOR = "bbbbbbbb-2222-4000-8000-000000000002";
const MISSING = "bbbbbbbb-3333-4000-8000-0000000000ff";

describe("order_groups, order_group_events and working_order_lines.group_id", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let nodeId = "";
  let orderSeq = 0;

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  beforeAll(async () => {
    const db = suite.db;
    await db.insert(tenants).values({ id: 1, country: "ES", taxId: "B00000000", legalName: "T" });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL, locationId: LOCATION, name: "Till" });
    nodeId = await seedNode(db, brandLocationId(LOCATION));
  });

  async function visit(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(visits)
        .values({ openedBy: OPERATOR })
        .returning({ id: visits.id });
      return row!.id;
    });
  }

  async function group(
    values: Partial<typeof orderGroups.$inferInsert> & { visitId: string },
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(orderGroups)
        .values({ position: 1, state: "held", submittedBy: OPERATOR, ...values })
        .returning({ id: orderGroups.id });
      return row!.id;
    });
  }

  async function bill(visitId: string): Promise<string> {
    orderSeq += 1;
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(workingOrders)
        .values({ tillId: TILL, nodeId, orderNumber: orderSeq, visitId })
        .returning({ id: workingOrders.id });
      return row!.id;
    });
  }

  async function lineIn(workingOrderId: string, lineNo: number, groupId: string): Promise<void> {
    await inTx(async (tx) => {
      await tx.insert(workingOrderLines).values({
        workingOrderId,
        lineNo,
        name: "Steak",
        descriptions: { es: "Solomillo" },
        quantity: 1000,
        unitPriceGross: 2200,
        vatClass: "reduced",
        lineTotal: 2200,
        groupId,
      });
    });
  }

  it("refuses a fired group with no fired time, and accepts one that has it", async () => {
    const visitId = await visit();
    const error = await captureError(() => group({ visitId, state: "fired" }));
    expect(checkFailed(error, "order_groups_fired_at_ck")).toBe(true);
    const id = await group({ visitId, state: "fired", firedAt: new Date().toISOString() });
    const [row] = await inTx((tx) => tx.select().from(orderGroups).where(eq(orderGroups.id, id)));
    expect(row).toMatchObject({ state: "fired", firedBy: null, remindAt: null });
  });

  it("refuses a held group with a fired time, and accepts one without", async () => {
    const visitId = await visit();
    const error = await captureError(() =>
      group({ visitId, state: "held", firedAt: new Date().toISOString() }),
    );
    expect(checkFailed(error, "order_groups_fired_at_ck")).toBe(true);
    await group({ visitId, state: "held" });
  });

  it("refuses a state outside the vocabulary, and accepts removed", async () => {
    const visitId = await visit();
    const id = await group({ visitId });
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`update order_groups set state = 'paused' where id = ${id}`);
      }),
    );
    expect(checkFailed(error, "order_groups_state_ck")).toBe(true);
    await inTx(async (tx) => {
      await tx.execute(sql`update order_groups set state = 'removed' where id = ${id}`);
    });
  });

  it("refuses an event kind outside the vocabulary, and accepts a known one", async () => {
    const visitId = await visit();
    const groupId = await group({ visitId });
    const event = { visitId, groupId, actorId: OPERATOR, detail: {} };
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`
          insert into order_group_events (id, visit_id, group_id, kind, actor_id, detail, created_at)
          values (${MISSING}, ${visitId}, ${groupId}, 'cancelled', ${OPERATOR}, '{}',
            ${new Date().toISOString()})
        `);
      }),
    );
    expect(checkFailed(error, "order_group_events_kind_ck")).toBe(true);
    await inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, kind: "submitted" }));
  });

  it("refuses a group naming no visit, and accepts one naming a visit", async () => {
    const error = await captureError(() => group({ visitId: MISSING }));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    await group({ visitId: await visit() });
  });

  it("refuses an event naming no visit, and accepts one naming a visit", async () => {
    const visitId = await visit();
    const groupId = await group({ visitId });
    const event = { groupId, kind: "submitted" as const, actorId: OPERATOR, detail: {} };
    const error = await captureError(() =>
      inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, visitId: MISSING })),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    await inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, visitId }));
  });

  it("refuses an event naming no group, and accepts one naming a group or none", async () => {
    const visitId = await visit();
    const event = { visitId, kind: "reordered" as const, actorId: OPERATOR, detail: {} };
    const error = await captureError(() =>
      inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, groupId: MISSING })),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    const groupId = await group({ visitId });
    await inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, groupId }));
    await inTx((tx) => tx.insert(orderGroupEvents).values({ ...event, groupId: null }));
  });

  it("refuses a line naming no group, and accepts one naming a group", async () => {
    const visitId = await visit();
    const workingOrderId = await bill(visitId);
    const error = await captureError(() => lineIn(workingOrderId, 1, MISSING));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    const groupId = await group({ visitId });
    await lineIn(workingOrderId, 1, groupId);
    const rows = await inTx((tx) =>
      tx
        .select({ groupId: workingOrderLines.groupId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId)),
    );
    expect(rows).toEqual([{ groupId }]);
  });
});
