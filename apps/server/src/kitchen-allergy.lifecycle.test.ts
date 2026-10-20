import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { kitchenStations, products, printJobs, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import type { AllergyPatch, KitchenAllergyBlock } from "@waitron/module";
import {
  OPERATOR,
  inTx,
  commandFor,
  join,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { splitBill, mergeBills } from "./testing/bill-action-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { writePrintHeldWork } from "@waitron/venue-service";
import {
  createExtraList,
  createProduct,
  readContentLanguages,
  writeProductModifiers,
} from "@waitron/catalogue";
import { routeProductTo } from "./testing/zone-offers.js";
import { republishMenus } from "./testing/publish-menu.js";
import { submitGroups, fireGroup } from "./order-groups.js";
import { submitDraft } from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
import {
  recallLines,
  sendLines,
  splitLinesWithinOrder,
  splitUnitsWithinOrder,
} from "./working-order.js";
import { moveDishesToStation } from "./station-move.js";
import { createStation } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { VENUE_SERVICE } from "./modules.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import { allergyTargets, applyPartyAllergyPatch, readPartyAllergyView } from "./party-allergy.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;
const original: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
  clashes: {},
  labels: {
    en: { avoids: ["Milk"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [] },
  },
};
const current: KitchenAllergyBlock = { ...original, who: "Corrected guest", note: "New tools" };
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, v.cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  stationId = station!.id;
  await inTx(v, async (tx) => {
    const p = await createPrinter(tx, v.cfg, {
      name: "Lifecycle paper",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, { locationId: v.cfg.locationId, stationId, printerId: p.id });
  });
});
async function sent(
  release: "fire" | "hold" = "fire",
  extras?: { listId: string; picks: { productId: string; quantity: number }[] }[],
) {
  const p = await seat(v, await v.table("Lifecycle"));
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, p.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: p.revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, p.tabId),
      groups: [
        {
          release,
          lines: [
            {
              menuItemId: v.item("Burger"),
              quantity: "3",
              note: "Dish note",
              ...(extras === undefined ? {} : { extras }),
            },
          ],
        },
      ],
      allergy: {
        party: {
          answer: "allergies",
          guests: [{ who: original.who, allergens: original.allergens, note: original.note }],
        },
        ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
      },
    }),
  );
  const [ticket] = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, p.tabId));
  return { ...p, ticket: ticket! };
}
type Sent = Awaited<ReturnType<typeof sent>>;
async function edit(p: Sent, remove = false) {
  await inTx(v, async (tx) => {
    const view = await readPartyAllergyView(tx, v.cfg, p.partyId);
    const allergy: AllergyPatch = remove
      ? { party: { answer: "none", guests: [] }, ticks: [] }
      : {
          party: {
            answer: "allergies",
            guests: [{ ...view.snapshot.guests[0]!, who: current.who, note: current.note }],
          },
          ticks: [],
        };
    const changes = await applyPartyAllergyPatch(
      tx,
      p.partyId,
      allergy,
      OPERATOR,
      allergyTargets(view),
    );
    await enqueueKitchenAllergyChanges(tx, v.cfg, changes);
  });
}
async function copies(p: Sent) {
  const tickets = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, p.tabId));
  const rows = await inTx(v, (tx) =>
    VENUE_SERVICE.readTicketAllergies(
      tx,
      tickets.map((t) => t.id),
    ),
  );
  return tickets.map((ticket) => ({ ticket, copy: rows.get(ticket.id) }));
}
async function resend(p: Sent) {
  await inTx(v, async (tx) =>
    sendLines(tx, v.cfg, p.tabId, [1], {
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, p.tabId),
    }),
  );
}
async function notices(id: string) {
  return inTx(v, (tx) => VENUE_SERVICE.listStationNotices(tx, v.cfg, id));
}

describe("A669 lifecycle", () => {
  it.each(["partial", "units"] as const)(
    "%s splits retain both blocks, assignments and financial totals",
    async (kind) => {
      const p = await sent();
      await edit(p);
      const jobs = await v.db.select().from(printJobs);
      await inTx(v, (tx) =>
        kind === "units"
          ? splitUnitsWithinOrder(tx, v.cfg, p.tabId, 1)
          : splitLinesWithinOrder(tx, v.cfg, p.tabId, [{ lineNo: 1, quantity: "1" }]).then(
              () => {},
            ),
      );
      const rows = await copies(p);
      expect(rows.map((row) => row.copy)).toEqual(
        Array.from({ length: kind === "units" ? 3 : 2 }, () => ({
          originalBlock: original,
          currentBlock: current,
        })),
      );
      const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
      expect(snapshot.ticks.map((tick) => tick.workingLineId).sort()).toEqual(
        rows.map((row) => row.ticket.workingOrderLineId).sort(),
      );
      const lines = await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      expect(lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(3000);
      expect(lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(3600);
      expect(lines.map((line) => line.unitPriceGross)).toEqual(Array(lines.length).fill(1200));
      expect(await v.db.select().from(printJobs)).toEqual(jobs);
      await edit(p, true);
      expect(
        (await notices(stationId))
          .filter((notice) => notice.kind === "allergy_removed")
          .map((notice) => notice.quantity)
          .sort(),
      ).toEqual(kind === "units" ? ["1.000", "1.000", "1.000"] : ["1.000", "2.000"]);
    },
  );
  it.each([false, true])(
    "legacy recall preserves the original and sends its current correction on resend (remove %s)",
    async (remove) => {
      const p = await sent();
      await inTx(v, async (tx) =>
        recallLines(tx, v.cfg, p.tabId, [1], {
          operatorId: OPERATOR,
          expectedEdit: await readBillEditState(tx, p.tabId),
        }),
      );
      await edit(p, remove);
      expect(
        (await notices(stationId)).filter((notice) => notice.kind.startsWith("allergy_")),
      ).toEqual([]);
      const before = await v.db.select().from(printJobs);
      await resend(p);
      expect((await copies(p)).map((row) => row.copy)).toEqual([
        { originalBlock: original, currentBlock: remove ? null : current },
      ]);
      expect(
        (await notices(stationId))
          .filter((notice) => notice.kind.startsWith("allergy_"))
          .map(({ kind, allergyBlock }) => ({ kind, allergyBlock })),
      ).toEqual([
        {
          kind: remove ? "allergy_removed" : "allergy_changed",
          allergyBlock: remove ? null : current,
        },
      ]);
      const after = await v.db.select().from(printJobs);
      expect(after.slice(0, before.length)).toEqual(before);
    },
  );
  it("rerouting unchanged instructions adds no allergy notice and a later edit reaches only the new cook", async () => {
    const p = await sent();
    const destination = await inTx(v, (tx) =>
      createStation(tx, v.cfg, { name: "Unchanged destination" }),
    );
    await inTx(v, (tx) =>
      moveDishesToStation(
        tx,
        v.cfg,
        p.tabId,
        {
          submissionId: randomUUID(),
          lineIds: [p.ticket.workingOrderLineId],
          stationId: destination.id,
        },
        { kind: "kitchen", deviceId: null, personId: OPERATOR },
      ),
    );
    expect(
      (await notices(destination.id)).filter((row) => row.kind.startsWith("allergy_")),
    ).toEqual([]);
    await edit(p);
    expect(
      (await notices(destination.id))
        .filter((row) => row.kind === "allergy_changed")
        .map((row) => row.allergyBlock),
    ).toEqual([current]);
    expect((await notices(stationId)).filter((row) => row.kind.startsWith("allergy_"))).toEqual([]);
  });
  it.each([false, true])(
    "a reroute gives the new cook the original plus correction even after acknowledgement (remove %s)",
    async (remove) => {
      const p = await sent();
      await edit(p, remove);
      const old = (await notices(stationId)).find((row) => row.kind.startsWith("allergy_"))!;
      await inTx(v, (tx) =>
        VENUE_SERVICE.acknowledgeKitchenNotice(tx, v.cfg, old.id, { stationId }),
      );
      const destination = await inTx(v, (tx) => createStation(tx, v.cfg, { name: "New cook" }));
      const request = {
        submissionId: randomUUID(),
        lineIds: [p.ticket.workingOrderLineId],
        stationId: destination.id,
      };
      const actor = { kind: "kitchen" as const, deviceId: null, personId: OPERATOR };
      const before = await v.db.select().from(printJobs);
      await inTx(v, (tx) => moveDishesToStation(tx, v.cfg, p.tabId, request, actor));
      expect((await copies(p)).map((row) => row.copy)).toEqual([
        { originalBlock: original, currentBlock: remove ? null : current },
      ]);
      expect(
        (await notices(destination.id)).map(({ kind, allergyBlock }) => ({ kind, allergyBlock })),
      ).toEqual([
        {
          kind: remove ? "allergy_removed" : "allergy_changed",
          allergyBlock: remove ? null : current,
        },
      ]);
      expect((await notices(stationId)).some((row) => row.kind.startsWith("allergy_"))).toBe(false);
      const all = await v.db.select().from(printJobs);
      expect(all.slice(0, before.length)).toEqual(before);
      await inTx(v, (tx) => moveDishesToStation(tx, v.cfg, p.tabId, request, actor));
      expect(await v.db.select().from(printJobs)).toEqual(all);
      expect(await notices(destination.id)).toHaveLength(1);
    },
  );
  it.each([false, true])(
    "releasing corrected HOLD work delivers a correction only when rerouted (%s)",
    async (reroute) => {
      await inTx(v, (tx) => writePrintHeldWork(tx, true));
      const p = await sent("hold");
      await edit(p);
      const old = (await notices(stationId)).find((row) => row.kind === "allergy_changed")!;
      await inTx(v, (tx) => VENUE_SERVICE.acknowledgeKitchenNotice(tx, v.cfg, old.id));
      const destination = reroute
        ? await inTx(v, async (tx) => {
            const station = await createStation(tx, v.cfg, { name: "Release cook" });
            await routeProductTo(tx, v.cfg, v.productId("Burger"), station.id);
            await tx
              .update(kitchenStations)
              .set({ active: false })
              .where(eq(kitchenStations.id, stationId));
            return station.id;
          })
        : stationId;
      const [line] = await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, p.ticket.workingOrderLineId));
      const revision = await revisionOf(v, p.partyId);
      await inTx(v, (tx) =>
        fireGroup(tx, v.cfg, p.partyId, line!.groupId!, {
          submissionId: randomUUID(),
          expectedPartyRevision: revision,
          operatorId: OPERATOR,
        }),
      );
      expect((await copies(p)).map((row) => row.copy)).toEqual([
        { originalBlock: original, currentBlock: current },
      ]);
      expect(
        (await notices(destination))
          .filter((row) => row.kind.startsWith("allergy_"))
          .map((row) => row.allergyBlock),
      ).toEqual(reroute ? [current] : []);
    },
  );
  it("a partial split copies routed extras and the parent assignment, with the same financial total", async () => {
    const extra = await inTx(v, async (tx) => {
      const [parent] = await tx
        .select()
        .from(products)
        .where(eq(products.id, v.productId("Burger")));
      const { defaultLanguage } = await readContentLanguages(tx, v.cfg.locale);
      const side = await createProduct(tx, {
        catalogueId: parent!.catalogueId,
        categoryId: null,
        name: "Side staff",
        customerName: { [defaultLanguage]: "Side customer" },
        kitchenName: "SIDE COOK",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "reduced",
        allergens: { eggs: {} },
      });
      const list = await createExtraList(
        tx,
        {
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 2,
          active: true,
          items: [{ productId: side.id, maxQuantity: 2, preselected: false, price: "1.00" }],
        },
        v.cfg.locale,
      );
      await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
      const station = await createStation(tx, v.cfg, { name: "Side cook" });
      await routeProductTo(tx, v.cfg, side.id, station.id);
      await republishMenus(tx);
      return { list, side, station };
    });
    const p = await sent("fire", [
      { listId: extra.list.id, picks: [{ productId: extra.side.id, quantity: 2 }] },
    ]);
    await inTx(v, (tx) =>
      splitLinesWithinOrder(tx, v.cfg, p.tabId, [{ lineNo: 1, quantity: "1" }], {
        splitExtras: true,
      }),
    );
    expect((await copies(p)).map((row) => row.copy)).toEqual(
      Array.from({ length: 4 }, () => ({ originalBlock: original, currentBlock: original })),
    );
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    expect(lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(4200);
    await edit(p);
    expect(
      (await notices(stationId))
        .filter((row) => row.kind === "allergy_changed")
        .map((row) => row.quantity)
        .sort(),
    ).toEqual(["1.000", "2.000"]);
    expect(
      (await notices(extra.station.id))
        .filter((row) => row.kind === "allergy_changed")
        .map((row) => row.quantity)
        .sort(),
    ).toEqual(["2.000", "4.000"]);
  });
  it("a partial bill split and merge keep both copies and both assignments", async () => {
    const p = await sent();
    const command = await commandFor(v, p.partyId);
    const split = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, p.tabId, [{ lineNo: 1, quantity: "1" }], command),
    );
    expect((await copies({ ...p, tabId: split.billId })).map((row) => row.copy)).toEqual([
      { originalBlock: original, currentBlock: original },
    ]);
    await edit(p);
    expect(
      (await notices(stationId))
        .filter((row) => row.kind === "allergy_changed")
        .map((row) => row.quantity)
        .sort(),
    ).toEqual(["1.000", "2.000"]);
    const mergeCommand = await commandFor(v, p.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, p.tabId, split.billId, mergeCommand));
    expect((await copies(p)).map((row) => row.copy)).toEqual(
      Array.from({ length: 2 }, () => ({ originalBlock: original, currentBlock: current })),
    );
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    expect(lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(3600);
  });
  it("a table split keeps copied guest identity separate while retaining the sent original", async () => {
    const p = await sent();
    const command = await commandFor(v, p.partyId);
    const split = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, p.tabId, [{ lineNo: 1, quantity: "1" }], command),
    );
    const table = await v.table("Leaving table");
    await join(v, p.partyId, table);
    const splitCommand = await commandFor(v, p.partyId);
    const target = await inTx(v, (tx) =>
      splitTable(tx, v.cfg, p.partyId, table, split.billId, splitCommand),
    );
    const leaving = { ...p, partyId: target.partyId, tabId: split.billId };
    await edit(leaving);
    expect((await copies(p)).map((row) => row.copy)).toEqual([
      { originalBlock: original, currentBlock: original },
    ]);
    expect((await copies(leaving)).map((row) => row.copy)).toEqual([
      { originalBlock: original, currentBlock: current },
    ]);
    expect(
      (await notices(stationId))
        .filter((row) => row.kind === "allergy_changed")
        .map(({ workingOrderId, quantity }) => ({ workingOrderId, quantity })),
    ).toEqual([{ workingOrderId: split.billId, quantity: "1.000" }]);
  });
  it("reprints alone do not send another allergy notice", async () => {
    const p = await sent();
    await edit(p);
    const before = await notices(stationId);
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
    expect(await notices(stationId)).toEqual(before);
    expect((await copies(p)).map((row) => row.copy)).toEqual([
      { originalBlock: original, currentBlock: current },
    ]);
  });
  it("recall to draft creates a fresh original on resend and preserves old print payloads", async () => {
    const p = await sent();
    const revision = await revisionOf(v, p.partyId);
    const result = await inTx(v, async (tx) =>
      recallToDraft(tx, v.cfg, p.partyId, p.ticket.workingOrderLineId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
      }),
    );
    await edit(p);
    expect(
      (await notices(stationId)).filter((notice) => notice.kind.startsWith("allergy_")),
    ).toEqual([]);
    const before = await v.db.select().from(printJobs);
    const nextRevision = await revisionOf(v, p.partyId);
    await inTx(v, async (tx) =>
      submitDraft(tx, v.cfg, p.partyId, result.draft.id, {
        submissionId: randomUUID(),
        expectedPartyRevision: nextRevision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
        draftRevision: result.draft.revision,
        groups: [{ release: "fire", lineIds: result.draft.lines.map((line) => line.id) }],
      }),
    );
    const rows = await copies(p);
    expect(rows.map((row) => row.copy)).toEqual([
      { originalBlock: current, currentBlock: current },
    ]);
    expect(rows[0]!.ticket.id).not.toBe(p.ticket.id);
    expect((await v.db.select().from(printJobs)).slice(0, before.length)).toEqual(before);
  });
});
