import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createAdjustmentReason,
  deleteAdjustmentReason,
  listAdjustmentReasons,
  reorderAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReason,
  type AdjustmentReasonInput,
  STARTER_REASON_NAMES as expected,
} from "@waitron/adjustments";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { lineIdOf, rowsOf } from "./testing/adjustment-venue.js";
import "./errors.js";

// A venue straight out of provisioning, with no reason added by anyone: its till can still cancel.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

describe("a newly set-up venue's till", () => {
  it("offers the nine starter reasons, and a staff member cancels a dish with the first without a PIN", async () => {
    const listed = await send(venue.app, venue.cookie, "GET", "/api/adjustment-reasons");
    expect(listed.status).toBe(200);
    const every = ["staff", "supervisor", "manager", "admin"];
    const supervisorUp = ["supervisor", "manager", "admin"];
    const managerUp = ["manager", "admin"];
    const allOff = ["comp", "discount_percent", "discount_amount"];
    const voidReason = (name: string, noteRequired = false) => ({
      id: expect.any(String),
      name,
      kind: "void",
      actions: ["cancel"],
      noteRequired,
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
      startsFinishTable: name === expected["Not served"].es,
    });
    const compReason = (
      name: string,
      applyRoles: string[],
      approverRoles: string[],
      actions = allOff,
      maxPercentBp: number | null = null,
    ) => ({
      id: expect.any(String),
      name,
      kind: "comp",
      actions,
      noteRequired: false,
      maxPercentBp,
      maxAmount: null,
      applyRoles,
      approverRoles,
      startsFinishTable: false,
    });
    expect(listed.json).toEqual([
      voidReason(expected["Entry error"].es),
      voidReason(expected["Item not available"].es),
      voidReason(expected["Customer changed mind"].es),
      voidReason(expected["Not served"].es),
      voidReason(expected.Other.es, true),
      compReason(expected.Complaint.es, supervisorUp, supervisorUp),
      compReason(expected["On the house"].es, managerUp, managerUp),
      compReason(
        expected["Staff meal"].es,
        every,
        managerUp,
        ["discount_percent", "discount_amount"],
        5000,
      ),
      compReason(expected.Discount.es, managerUp, managerUp),
    ]);
    const reasonId = (listed.json as unknown as { id: string }[])[0]!.id;

    const billId = await tabWith(venue, "Ensalada", "Caña");
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      {
        expectedEdit: await readBillEditState(venue.db, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: await lineIdOf(venue, billId, 1),
        reasonId,
        action: "cancel",
        note: null,
      },
    );

    expect(cancelled.status).toBe(200);
    expect((await rowsOf(venue, billId)).map((row) => row.name)).toEqual(["Caña"]);
  });
});

describe("the reason Finish table starts on", () => {
  type Listed = { id: string; name: string; startsFinishTable: boolean };
  const marked = async () =>
    (
      (await send(venue.app, venue.cookie, "GET", "/api/adjustment-reasons"))
        .json as unknown as Listed[]
    )
      .filter((reason) => reason.startsFinishTable)
      .map((reason) => reason.id);
  const inputOf = (reason: AdjustmentReason): AdjustmentReasonInput => ({
    name: reason.name,
    names: reason.names,
    kind: reason.kind,
    actions: reason.actions,
    maxPercentBp: reason.maxPercentBp,
    maxAmount: reason.maxAmount,
    applyRoles: reason.applyRoles,
    approverRoles: reason.approverRoles,
    noteRequired: reason.noteRequired,
  });
  const notServed = async () =>
    (await inTx(venue, listAdjustmentReasons)).find((reason) => reason.names.en === "Not served")!;
  const voidInput = (name: string, en: string): AdjustmentReasonInput => ({
    name,
    names: { en },
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    noteRequired: false,
  });

  it("marks the Void reason whose English name is Not served as Finish table's start", async () => {
    const listed = (await send(venue.app, venue.cookie, "GET", "/api/adjustment-reasons"))
      .json as unknown as Listed[];
    expect(
      listed.filter((reason) => reason.startsFinishTable).map((reason) => reason.name),
    ).toEqual([expected["Not served"].es]);
    expect(listed.every((reason) => typeof reason.startsFinishTable === "boolean")).toBe(true);
  });

  it("does not mark a Comp reason whose English name is Not served", async () => {
    const starter = await notServed();
    await inTx(venue, (tx) =>
      updateAdjustmentReason(tx, starter.id, {
        ...inputOf(starter),
        name: "Left uneaten",
        names: { en: "Left uneaten" },
      }),
    );
    const comp = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: "Not served comp",
        names: { en: "Not served" },
        kind: "comp",
        actions: ["comp"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: ["manager", "admin"],
        approverRoles: ["manager", "admin"],
        noteRequired: false,
      }),
    );
    try {
      expect(await marked()).toEqual([]);
    } finally {
      await inTx(venue, async (tx) => {
        await deleteAdjustmentReason(tx, comp.id);
        await updateAdjustmentReason(tx, starter.id, inputOf(starter));
      });
    }
  });

  it("marks it by its name when it has no English name", async () => {
    const starter = await notServed();
    await inTx(venue, (tx) =>
      updateAdjustmentReason(tx, starter.id, {
        ...inputOf(starter),
        name: "Not served",
        names: {},
      }),
    );
    try {
      expect(await marked()).toEqual([starter.id]);
    } finally {
      await inTx(venue, (tx) => updateAdjustmentReason(tx, starter.id, inputOf(starter)));
    }
  });

  it("with two such reasons, marks the first in the venue's order", async () => {
    const starter = await notServed();
    const second = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, voidInput("Never arrived", "Not served")),
    );
    const order = (await inTx(venue, listAdjustmentReasons)).map((reason) => reason.id);
    try {
      expect(await marked()).toEqual([starter.id]);
      await inTx(venue, (tx) =>
        reorderAdjustmentReasons(tx, [second.id, ...order.filter((id) => id !== second.id)]),
      );
      expect(await marked()).toEqual([second.id]);
    } finally {
      await inTx(venue, async (tx) => {
        await reorderAdjustmentReasons(tx, order);
        await deleteAdjustmentReason(tx, second.id);
      });
    }
  });

  it("marks none once it is renamed", async () => {
    const starter = await notServed();
    await inTx(venue, (tx) =>
      updateAdjustmentReason(tx, starter.id, {
        ...inputOf(starter),
        name: "Not served",
        names: { en: "Never reached the table" },
      }),
    );
    try {
      expect(await marked()).toEqual([]);
    } finally {
      await inTx(venue, (tx) => updateAdjustmentReason(tx, starter.id, inputOf(starter)));
    }
  });
});
