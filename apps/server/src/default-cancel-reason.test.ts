import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
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
    });
    expect(listed.json).toEqual([
      voidReason("Error al marcar"),
      voidReason("Producto agotado"),
      voidReason("Cambio del cliente"),
      voidReason("No servido"),
      voidReason("Otro motivo", true),
      compReason("Queja del cliente", supervisorUp, supervisorUp),
      compReason("Invitación", managerUp, managerUp),
      compReason(
        "Comida de personal",
        every,
        managerUp,
        ["discount_percent", "discount_amount"],
        5000,
      ),
      compReason("Descuento", managerUp, managerUp),
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
