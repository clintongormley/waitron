import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { provisionBillVenue, send } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { receiptLabelsFor } from "@waitron/country-packs";
import { receiptDateTime } from "./receipt-dates.js";
import { formatMoney } from "./receipt-money.js";
import { payments } from "@waitron/payments";
import { timeZoneOffsetMinutes } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  kitchenStations,
  printJobs,
  workingOrderLines,
  products,
  orderGroups,
  sales,
  invoiceSeries,
  deviceProfiles,
} from "@waitron/db";
import { validateCapabilities } from "@waitron/layouts";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter, resendPrintJob, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import {
  writeContentLanguages,
  updateProduct,
  createProduct,
  createMenu,
  assignMenuToVenue,
} from "@waitron/menu";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups } from "./order-groups.js";
import {
  reprintOrderTickets,
  enqueueAllergyCorrectionSlips,
  enqueueHoldCorrections,
  enqueueExtraCancelled,
} from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { VENUE_SERVICE } from "./modules.js";
import { KITCHEN_ALLERGY_WORDS, ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";
import { inTx, OPERATOR, revisionOf, seat, setupPartyVenue } from "./testing/party-venue.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { republishMenus } from "./testing/publish-menu.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const text = (payload: Uint8Array) =>
  printedLines(payload)
    .map((l) => l.trim())
    .join(" ")
    .replace(/ +/g, " ");

describe("A964 language boundaries", () => {
  it.each(["en", "es"] as const)(
    "keeps recorded allergy, names and joined papers while selecting current %s frame",
    async (language) => {
      const v = await setupPartyVenue(suite.db);
      v.cfg.locale = "de-DE";
      const [station] = await v.db.select().from(kitchenStations);
      const printerId = await inTx(v, async (tx) => {
        await writeContentLanguages(tx, {
          defaultLanguage: language === "en" ? "es" : "en",
          languages: ["en", "es"],
        });
        const printer = await createPrinter(tx, {
          name: "Recorded kitchen",
          transport: "cloud_poll",
          pollId: randomUUID(),
        });
        await attachPrinterToStation(tx, {
          stationId: station!.id,
          printerId: printer.id,
        });
        await setStationPrinting(tx, { printHeldWork: true });
        await updateProduct(tx, v.productId("Burger"), {
          name: "Staff roast",
          customerName: { en: "Diner roast", es: "Diner roast" },
          kitchenName: "Pass roast",
        });
        return printer.id;
      });
      await inTx(v, (tx) => republishMenus(tx));
      const p = await seat(v, await v.table("Snapshot table"));
      for (const release of ["fire", "hold"] as const) {
        const expectedPartyRevision = await revisionOf(v, p.partyId);
        const existing = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
        await inTx(v, async (tx) =>
          submitGroups(tx, v.cfg, p.partyId, {
            submissionId: randomUUID(),
            expectedPartyRevision,
            operatorId: OPERATOR,
            expectedEdit: await readBillEditState(tx, p.tabId),
            groups: [
              {
                release,
                lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Dish note" }],
              },
            ],
            allergy: {
              party: {
                answer: "allergies",
                guests: [
                  {
                    ...(existing.guests[0] ? { id: existing.guests[0].id } : {}),
                    who: "Window guest",
                    allergens: { milk: {} },
                    note: "Separate pan",
                  },
                ],
              },
              ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
            },
          }),
        );
      }
      const before = await v.db.select().from(printJobs);
      expect(before).toHaveLength(2);
      expect(before.every((j) => text(j.payload!).includes("Pass roast"))).toBe(true);
      const tickets = await ticketItemsWithBill(v.db).where(
        eq(workingOrderLines.workingOrderId, p.tabId),
      );
      const recorded = await inTx(v, (tx) =>
        VENUE_SERVICE.readTicketAllergies(
          tx,
          tickets.map((t) => t.id),
        ),
      );
      await inTx(v, async (tx) => {
        await updateProduct(tx, v.productId("Burger"), {
          name: "New staff",
          customerName: { en: "New diner" },
          kitchenName: "New pass",
        });
        for (const t of tickets)
          await VENUE_SERVICE.setTicketAllergyCurrent(tx, t.id, {
            ...recorded.get(t.id)!.originalBlock!,
            who: "New guest",
            note: "New note",
          });
        await writeContentLanguages(tx, { defaultLanguage: language, languages: [language] });
      });
      expect(await v.db.select().from(printJobs)).toEqual(before);
      const snapshots = await inTx(v, (tx) =>
        VENUE_SERVICE.readTicketAllergies(
          tx,
          tickets.map((t) => t.id),
        ),
      );
      const savedLines = await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId));
      await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
      const after = await v.db.select().from(printJobs);
      expect(after).toHaveLength(3);
      const next = after.find((j) => !before.some((old) => old.id === j.id))!;
      expect(next.printerId).toBe(printerId);
      const paper = text(next.payload!);
      expect(paper.match(/Pass roast/g)).toHaveLength(2);
      expect(paper.match(/Window guest/g)).toHaveLength(2);
      expect(paper.match(/Separate pan/g)).toHaveLength(2);
      expect(paper).toContain(ALLERGEN_NAMES.milk[language].toUpperCase());
      expect(paper).toContain(
        KITCHEN_ALLERGY_WORDS[language].guestHeading.replace("{who}", () => "Window guest"),
      );
      expect(paper).toContain(`*** ${kitchenTicketWords(language).hold} ***`);
      for (const forbidden of [
        "New staff",
        "New diner",
        "New pass",
        "New guest",
        "New note",
        "Staff roast",
        "Diner roast",
      ])
        expect(paper).not.toContain(forbidden);
      expect(printedCommands(next.payload).filter((c) => c.name === "GS V")).toHaveLength(1);
      for (const old of before) expect(after.find((j) => j.id === old.id)).toEqual(old);
      expect(
        await inTx(v, (tx) =>
          VENUE_SERVICE.readTicketAllergies(
            tx,
            tickets.map((t) => t.id),
          ),
        ),
      ).toEqual(snapshots);
      expect(
        await v.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      ).toEqual(savedLines);
      const held = tickets.find((t) => t.firedAt === null)!;
      const heldLine = savedLines.find((l) => l.id === held.workingOrderLineId)!;
      const [group] = await v.db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.id, heldLine.groupId!));
      const heldTarget = {
        workingOrderLineId: held.workingOrderLineId,
        stationId: held.stationId!,
        quantity: 1000,
        wasStarted: false,
        group: group!.displayNumber,
        holdGroupId: heldLine.groupId!,
      };
      for (const direction of ["added", "removed"] as const) {
        await inTx(v, (tx) =>
          enqueueHoldCorrections(tx, v.cfg, p.tabId, [heldTarget], {
            kind: "HOLD CHANGED",
            direction,
          }),
        );
        const lines = printedLines((await v.db.select().from(printJobs)).at(-1)!.payload);
        expect(lines[0]).toBe(`*** ${kitchenTicketWords(language).holdChanged} ***`);
        expect(lines).toContain(`${direction === "added" ? "+" : "-"}1 x Pass roast`);
      }
      await inTx(v, (tx) =>
        enqueueHoldCorrections(tx, v.cfg, p.tabId, [heldTarget], { kind: "HOLD CANCELLED" }),
      );
      expect(printedLines((await v.db.select().from(printJobs)).at(-1)!.payload)[0]).toBe(
        `*** ${kitchenTicketWords(language).holdCancelled} ***`,
      );
      await inTx(v, (tx) => enqueueExtraCancelled(tx, v.cfg, p.tabId, heldTarget, "Pickles"));
      const extra = printedLines((await v.db.select().from(printJobs)).at(-1)!.payload);
      expect(extra[0]).toBe(`*** ${kitchenTicketWords(language).holdChanged} ***`);
      expect(extra).toContain(`  ${kitchenTicketWords(language).cancel} Pickles`);
      const fired = tickets.find((t) => t.firedAt !== null)!;
      const target = {
        workingOrderLineId: fired.workingOrderLineId,
        stationId: fired.stationId!,
        quantity: 1000,
        wasStarted: false,
      };
      const block = snapshots.get(fired.id)!.currentBlock!;
      await inTx(v, (tx) =>
        enqueueAllergyCorrectionSlips(tx, v.cfg, p.tabId, [{ ...target, allergyBlock: block }]),
      );
      const corrected = (await v.db.select().from(printJobs)).at(-1)!;
      expect(text(corrected.payload!)).toContain("New guest");
      expect(text(corrected.payload!)).not.toContain("Window guest");
      await inTx(v, (tx) =>
        enqueueAllergyCorrectionSlips(tx, v.cfg, p.tabId, [{ ...target, allergyBlock: null }]),
      );
      const removed = (await v.db.select().from(printJobs)).at(-1)!;
      expect(text(removed.payload!)).toContain(KITCHEN_ALLERGY_WORDS[language].removed);
      expect(text(removed.payload!)).not.toContain("New guest");
      await inTx(v, async (tx) => {
        await tx
          .update(printJobs)
          .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
          .where(eq(printJobs.id, before[0]!.id));
      });
      const resent = await inTx(v, (tx) => resendPrintJob(tx, before[0]!.id));
      const [copy] = await v.db.select().from(printJobs).where(eq(printJobs.id, resent.jobId));
      expect(copy!.payload).toEqual(before[0]!.payload);
      expect(copy!.printerId).toBe(before[0]!.printerId);
      expect(
        await v.db
          .select({ name: products.name })
          .from(products)
          .where(eq(products.id, v.productId("Burger"))),
      ).toEqual([{ name: "New staff" }]);
    },
  );
});

it("A964 language boundaries preserve saved receipt-language card bytes and fiscal rows", async () => {
  const v = await provisionBillVenue(suite.db);
  const cfg = { ...v.cfg, locale: "de-DE" };
  const offers = await inTx(v, async (tx) => {
    const cat = await createMenu(tx, { name: "Boundary menu" });
    const product = await createProduct(tx, {
      categoryId: null,
      name: "Boundary dish",
      kitchenName: "Pass boundary",
      customerName: { es: "Diner boundary", en: "Diner boundary" },
      pricingUnit: "each",
      unitPrice: "1234.56",
      vatClass: "general",
    });
    await assignMenuToVenue(tx, cat.id);
    const offered = await offerProducts(tx, cfg);
    return { zoneId: offered.zoneId, menuItemId: offered.offerFor(product.id) };
  });
  // A slip prints only on a device whose profile may print receipts.
  await inTx(v, async (tx) => {
    for (const profile of await tx.select().from(deviceProfiles))
      await tx
        .update(deviceProfiles)
        .set({ capabilities: [...validateCapabilities(profile.capabilities), "print-receipt"] })
        .where(eq(deviceProfiles.id, profile.id));
  });
  // Not the venue's default receipt language, so a dropped choice prints in another.
  const slipHeading = receiptLabelsFor("ca-ES").paymentHeading;
  expect(receiptLabelsFor("es-ES").paymentHeading).not.toBe(slipHeading);
  for (const language of ["en", "es"] as const) {
    await inTx(v, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es", "ca"] }),
    );
    const before = await v.db.select().from(printJobs);
    const frozenSales = await v.db.select().from(sales);
    const frozenSeries = await v.db.select().from(invoiceSeries);
    const frozenRecords = v.db.all(sql`select * from verifactu_records`);
    const id = randomUUID();
    const paid = await send(v.app, v.cookie, "POST", `/api/working-orders/${id}/payments`, {
      dining: "eat_in",
      submissionId: id,
      kind: "share",
      shareOf: 1,
      method: "card",
      entry: "reader",
      basket: { zoneId: offers.zoneId, lines: [{ menuItemId: offers.menuItemId, quantity: "1" }] },
      receiptLanguage: "ca-ES",
      printCardSlip: true,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.outcome).toBe("received");
    expect(paid.json).not.toHaveProperty("slipPrintFailed");
    const [payment] = await v.db.select().from(payments).where(eq(payments.workingOrderId, id));
    expect(payment!.settledAt).not.toBeNull();
    const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale!.locale).toBe("ca-ES");
    const next = (await v.db.select().from(printJobs)).filter(
      (j) => !before.some((o) => o.id === j.id) && text(j.payload!).includes(slipHeading),
    );
    expect(next).toHaveLength(1);
    const paper = text(next[0]!.payload!);
    const settledAt = payment!.settledAt!;
    const venueOffset = timeZoneOffsetMinutes("Europe/Madrid", new Date(settledAt));
    expect(paper).toContain(receiptDateTime(settledAt, "ca-ES", venueOffset));
    expect(paper).toContain(formatMoney("1234.56", "ca-ES"));
    expect(formatMoney("1234.56", "en-GB")).not.toBe(formatMoney("1234.56", "es-ES"));
    expect(receiptDateTime(payment!.settledAt!, "en-GB")).not.toBe(
      receiptDateTime(payment!.settledAt!, "es-ES"),
    );
    const after = await v.db.select().from(printJobs);
    for (const j of before) expect(after.find((o) => o.id === j.id)).toEqual(j);
    const salesAfter = await v.db.select().from(sales);
    for (const row of frozenSales) expect(salesAfter.find((o) => o.id === row.id)).toEqual(row);
    expect(salesAfter).toHaveLength(frozenSales.length + 1);
    // The new sale moves its series on; no series is added or lost.
    expect((await v.db.select().from(invoiceSeries)).map((row) => row.id).sort()).toEqual(
      frozenSeries.map((row) => row.id).sort(),
    );
    expect(v.db.all(sql`select * from verifactu_records`).slice(0, frozenRecords.length)).toEqual(
      frozenRecords,
    );
  }
});
