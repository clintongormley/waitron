import { addPortionRound } from "./testing/portion-bill.js";
import { kitchenNotices } from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { nameParty } from "./testing/party-venue.js";
import * as kitchenLanguage from "./kitchen-language.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenOrder, fireLines, fireableLineColumns } from "./working-order.js";
import { sql, eq } from "drizzle-orm";
import {
  kitchenPrintJobs,
  printers,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrders,
  workingOrderLines,
  products,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeContentLanguages } from "@waitron/catalogue";
import {
  setupSplitExtrasVenue,
  useSplitExtrasDb,
  fireNewOrder,
  fireGroupedOrder,
  createOfferedOrder,
} from "./testing/split-extras-venue.js";
import { updateStation } from "./kitchen.js";
import {
  enqueueKitchenTickets,
  enqueueCorrectionSlips,
  enqueueOrderKitchenNoteChange,
  enqueueStationMoved,
  enqueueMovedSlips,
  readSentWork,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { printedLines } from "./testing/decode-ticket.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeAll(() => useSplitExtrasDb(suite.db));
afterEach(() => vi.restoreAllMocks());
const jobs = () => suite.db.select().from(printJobs);

describe("A964 venue language", () => {
  it.each(["en", "es"])(
    "prints new work from content %s despite German formatting and Spanish receipts",
    async (language) => {
      const v = await setupSplitExtrasVenue();
      const cfg = { ...v.cfg, locale: "de-DE" };
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] });
        await updateStation(tx, cfg, v.stations.grill, { showsRestOfOrder: true });
        await fireNewOrder(tx, cfg, [
          {
            productId: v.products.burger,
            quantity: "2",
            extras: [
              { listId: v.lists.burger, picks: [{ productId: v.products.chips, quantity: 1 }] },
            ],
          },
          { productId: v.products.water, quantity: "1" },
        ]);
      });
      const w = kitchenTicketWords(language);
      const papers = (await jobs()).map((j) => printedLines(j.payload));
      expect(papers).toHaveLength(3);
      const grill = papers.find((p) => p[0] === "Grill")!;
      expect(grill).toContain(`-- ${w.alsoOnOrder} --`);
      expect(grill.some((line) => line.startsWith(`  > ${w.withRef.split("{name}")[0]}`))).toBe(
        true,
      );
      expect(grill.some((line) => line.includes("BURG"))).toBe(true);
      expect(new Set((await jobs()).map((j) => j.printerId))).toEqual(
        new Set([v.printers.grill, v.printers.fryer, v.printers.pass]),
      );
      expect((await suite.db.select().from(kitchenPrintJobs)).length).toBeGreaterThan(0);
    },
  );
  it("uses English without a saved setting even with a Spanish formatter", async () => {
    const v = await setupSplitExtrasVenue();
    await withTransaction(suite.db, async (tx) => {
      await tx.run("delete from content_languages");
      await fireNewOrder(tx, v.cfg, [{ productId: v.products.burger, quantity: "1" }]);
    });
    const id = (await suite.db.select().from(ticketItems))[0]!.workingOrderId;
    await withTransaction(suite.db, (tx) => reprintOrderTickets(tx, v.cfg, id));
    expect(
      (await jobs())
        .map((j) => printedLines(j.payload))
        .filter((p) => p[0]?.startsWith("*** REPRINT")),
    ).toHaveLength(2);
  });
  it("refreshes every correction, reroute, moved slip and reprint without changing queued bytes", async () => {
    const v = await setupSplitExtrasVenue();
    const cfg = { ...v.cfg, locale: "de-DE" };
    const id = await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] });
      return fireNewOrder(tx, cfg, [{ productId: v.products.burger, quantity: "2" }]);
    });
    const original = await jobs();
    await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.writeKitchenNote(tx, { workingOrderId: id }, 0, "Recorded order note"),
    );
    const [fired] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, id));
    const target = {
      workingOrderLineId: fired!.workingOrderLineId,
      stationId: fired!.stationId!,
      quantity: 1000,
      wasStarted: false,
    };
    for (const language of ["en", "es"] as const) {
      await withTransaction(suite.db, (tx) =>
        writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] }),
      );
      const before = new Set((await jobs()).map((j) => j.id));
      await withTransaction(suite.db, async (tx) => {
        await enqueueCorrectionSlips(tx, cfg, id, [target], "VOID");
        await enqueueStationMoved(tx, cfg, id, [target], "Fryer");
        await enqueueOrderKitchenNoteChange(tx, cfg, [id], { before: "Together", after: null });
        const sent = (await readSentWork(tx, id))!;
        await enqueueMovedSlips(
          tx,
          cfg,
          { ...sent, places: { ...sent.places, orderNumber: sent.places.orderNumber + 1 } },
          id,
        );
        await reprintOrderTickets(tx, cfg, id);
      });
      const papers = (await jobs())
        .filter((j) => !before.has(j.id))
        .map((j) => printedLines(j.payload));
      const w = kitchenTicketWords(language);
      for (const heading of [w.void, `${w.movedTo} FRYER`, w.noteRemoved, w.moved])
        expect(
          papers.some((p) => p[0] === `*** ${heading} ***`),
          heading,
        ).toBe(true);
      expect(
        papers.filter((p) => p[0]?.startsWith(`*** ${w.reprint.split("{time}")[0]}`)),
      ).toHaveLength(2);
      expect(papers.flat()).toContain("1.000 x BURG");
      for (const heading of [w.void, `${w.movedTo} FRYER`, w.moved]) {
        const paper = papers.find((p) => p[0] === `*** ${heading} ***`)!;
        expect(paper).toContain(`${w.forKitchen}Recorded order note`);
      }
      const moved = papers.find((p) => p[0] === `*** ${w.moved} ***`)!;
      expect(moved).toContain(`${w.fromPlace}${w.counter}`);
      expect(moved).toContain(`${w.toPlace}${w.counter}`);
    }
    const after = await jobs();
    for (const j of original) expect(after.find((p) => p.id === j.id)?.payload).toEqual(j.payload);
  });
});

it("A964 venue language reads once per rendering root, outside printer loops", async () => {
  const v = await setupSplitExtrasVenue();
  const id = await withTransaction(suite.db, (tx) =>
    fireNewOrder(tx, v.cfg, [{ productId: v.products.burger, quantity: "2" }]),
  );
  const [fired] = await suite.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, id));
  const item = {
    workingOrderLineId: fired!.workingOrderLineId,
    stationId: fired!.stationId!,
    quantity: 1000,
    wasStarted: false,
  };
  const reader = vi.spyOn(kitchenLanguage, "readKitchenLanguage");
  await withTransaction(suite.db, async (tx) => {
    await enqueueKitchenTickets(tx, v.cfg, id, []);
    expect(reader).not.toHaveBeenCalled();
    await enqueueKitchenTickets(tx, v.cfg, id, [item]);
    expect(reader).toHaveBeenCalledExactlyOnceWith(tx);
    reader.mockClear();
    await enqueueCorrectionSlips(tx, v.cfg, id, [item], "VOID");
    expect(reader).toHaveBeenCalledExactlyOnceWith(tx);
    reader.mockClear();
    const sent = (await readSentWork(tx, id))!;
    await enqueueMovedSlips(
      tx,
      v.cfg,
      { ...sent, places: { ...sent.places, orderNumber: sent.places.orderNumber + 1 } },
      id,
    );
    expect(reader).toHaveBeenCalledExactlyOnceWith(tx);
    reader.mockClear();
    await reprintOrderTickets(tx, v.cfg, id);
    expect(reader).toHaveBeenCalledExactlyOnceWith(tx);
  });
  expect((await jobs()).length).toBeGreaterThan(2);
});

it("A964 language boundaries keep weighted units and all recorded presentation names independent of frame language", async () => {
  const v = await setupSplitExtrasVenue();
  const cfg = { ...v.cfg, locale: "de-DE" };
  const id = await withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] });
    const id = crypto.randomUUID();
    const { lineRows } = await createOfferedOrder(tx, cfg, id, [
      { productId: v.products.burger, quantity: "1" },
    ]);
    const lineId = lineRows[0]!.id!;
    await tx
      .update(workingOrderLines)
      .set({
        name: "Staff roast",
        descriptions: { [cfg.invoiceLocales[0]!]: "Diner roast" },
        kitchenName: "Pass roast",
        variantName: "Staff size",
        variantKitchenName: "Pass size",
        variantDescriptions: { [cfg.invoiceLocales[0]!]: "Diner size" },
        unitName: { "de-DE": "DE-unit", en: "EN-unit" },
        optionSnapshots: [
          {
            listName: { en: "Staff list" },
            listCustomerName: { en: "Diner list" },
            listKitchenName: "Pass list",
            labelName: { en: "Staff choice" },
            labelCustomerName: { en: "Diner choice" },
            labelKitchenName: "Pass choice",
          },
        ],
      })
      .where(eq(workingOrderLines.id, lineId));
    await tx.execute(
      sql`update working_line_contexts set sold_in_each = 0 where working_order_line_id = ${lineId}`,
    );
    const lines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, lineId));
    await fireLines(tx, cfg, id, lines);
    return id;
  });
  const before = await jobs();
  expect(before).toHaveLength(2);
  for (const j of before) {
    expect(printedLines(j.payload)).toContain("1.000 DE-unit x Pass roast (Pass size)");
    expect(printedLines(j.payload)).toContain("  + Pass list: Pass choice");
  }
  await withTransaction(suite.db, async (tx) => {
    await tx
      .update(products)
      .set({ name: "New roast", kitchenName: "New pass" })
      .where(eq(products.id, v.products.burger));
    await writeContentLanguages(tx, { defaultLanguage: "es", languages: ["es"] });
  });
  await withTransaction(suite.db, (tx) => reprintOrderTickets(tx, cfg, id));
  const added = (await jobs()).filter((j) => !before.some((old) => old.id === j.id));
  expect(added).toHaveLength(2);
  for (const j of added) {
    const lines = printedLines(j.payload);
    expect(lines[0]).toContain(kitchenTicketWords("es").reprint.split("{time}")[0]);
    expect(lines).toContain("1.000 DE-unit x Pass roast (Pass size)");
    expect(lines).toContain("  + Pass list: Pass choice");
    for (const word of [
      "Staff roast",
      "Diner roast",
      "Staff size",
      "Diner size",
      "Staff list",
      "Diner list",
      "Staff choice",
      "Diner choice",
      "EN-unit",
      "New pass",
    ])
      expect(lines.join("\n")).not.toContain(word);
  }
});

it.each(["en", "es"] as const)(
  "A964 venue language keeps named-table and delivered-counter labels with %s frames",
  async (language) => {
    const v = await setupSplitExtrasVenue();
    const cfg = { ...v.cfg, locale: "de-DE" };
    await nameParty({ db: suite.db }, v.party.partyId, "Alex");
    const ids = await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] });
      await addTabRound(
        tx,
        cfg,
        v.party.tabId,
        v.tables.toOfferLines([{ productId: v.products.burger, quantity: "1" }]),
      );
      const [named] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, v.party.tabId));
      const counter = crypto.randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        counter,
        v.counter.toOfferLines([{ productId: v.products.burger, quantity: "1" }]),
        null,
        { zoneId: v.counter.zoneId, deliveryTableId: v.party.tableId },
      );
      const [delivered] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, counter));
      for (const id of [counter]) {
        const lines = await tx
          .select(fireableLineColumns)
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id));
        await fireLines(tx, cfg, id, lines);
      }
      return { named: named!.orderNumber, delivered: delivered!.orderNumber };
    });
    const papers = (await jobs()).map((j) => printedLines(j.payload));
    expect(papers).toHaveLength(4);
    expect(
      papers.filter((p) => p.includes(`${kitchenTicketWords(language).order} ${ids.named} · Alex`)),
    ).toHaveLength(2);
    expect(papers.filter((p) => p.includes(String(ids.delivered)))).toHaveLength(2);
    for (const paper of papers) {
      expect(paper).toContain("Split extras");
      expect(paper).toContain("1.000 x BURG");
    }
  },
);

// `grouped`: a counter line written before portions, which no no-printer path reads the language
// for. `portions`: folding identical dishes (`foldPortionNotices`) reads it, as on a table's portions,
// and every such read is the venue's language, never the frame's.
it.each(["grouped", "portions"] as const)(
  "A964 venue language leaves no-printer reads and counter notices independent of the frame fallback (%s)",
  async (shape) => {
    const v = await setupSplitExtrasVenue();
    const cfg = { ...v.cfg, locale: "de-DE" };
    const fire = shape === "grouped" ? fireGroupedOrder : fireNewOrder;
    const id = await withTransaction(suite.db, (tx) =>
      fire(tx, cfg, [{ productId: v.products.burger, quantity: "1" }]),
    );
    const [fired] = await suite.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, id));
    const target = {
      workingOrderLineId: fired!.workingOrderLineId,
      stationId: fired!.stationId!,
      quantity: 1000,
      wasStarted: false,
    };
    const beforeJobs = await jobs();
    await withTransaction(suite.db, (tx) => tx.update(printers).set({ active: false }));
    const reader = vi.spyOn(kitchenLanguage, "readKitchenLanguage");
    for (const language of ["en", "es"] as const) {
      reader.mockClear();
      await withTransaction(suite.db, async (tx) => {
        await writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] });
        await enqueueKitchenTickets(tx, cfg, id, [target]);
        await enqueueCorrectionSlips(tx, cfg, id, [target], "VOID");
        const sent = (await readSentWork(tx, id))!;
        await enqueueMovedSlips(
          tx,
          cfg,
          { ...sent, places: { ...sent.places, orderNumber: sent.places.orderNumber + 1 } },
          id,
        );
      });
      if (shape === "grouped") expect(reader).not.toHaveBeenCalled();
      else {
        const read = await Promise.all(reader.mock.results.map((result) => result.value));
        expect(read).toEqual(read.map(() => language));
      }
      const notices = await suite.db
        .select({ kind: kitchenNotices.kind, movedTo: kitchenNotices.movedTo })
        .from(kitchenNotices)
        .where(eq(kitchenNotices.workingOrderId, id));
      expect(notices.slice(-2)).toEqual([
        { kind: "void", movedTo: null },
        { kind: "moved", movedTo: null },
      ]);
      expect(await jobs()).toEqual(beforeJobs);
    }
  },
);

it.each(["en", "es"] as const)(
  "A964 portion corrections keep cached cross-references in content %s and fold identical dishes",
  async (language) => {
    const v = await setupSplitExtrasVenue();
    const cfg = { ...v.cfg, locale: "de-DE" };
    await withTransaction(suite.db, async (tx) => {
      await writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] });
      await addPortionRound(
        tx,
        cfg,
        v.party.tabId,
        v.tables.toOfferLines([
          {
            productId: v.products.burger,
            quantity: "2",
            extras: [
              { listId: v.lists.burger, picks: [{ productId: v.products.chips, quantity: 1 }] },
            ],
          },
        ]),
        { fire: true },
      );
    });
    const fired = (await suite.db.select().from(ticketItems)).filter(
      (item) => item.workingOrderId === v.party.tabId && item.stationId === v.stations.grill,
    );
    expect(fired).toHaveLength(2);
    const before = new Set((await jobs()).map((job) => job.id));
    const reader = vi.spyOn(kitchenLanguage, "readKitchenLanguage");
    await withTransaction(suite.db, (tx) =>
      enqueueCorrectionSlips(
        tx,
        cfg,
        v.party.tabId,
        fired.map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId!,
          quantity: 1000,
          wasStarted: false,
        })),
        "VOID",
      ),
    );
    const added = (await jobs()).filter((job) => !before.has(job.id));
    expect(new Set(added.map((job) => job.printerId))).toEqual(
      new Set([v.printers.grill, v.printers.pass]),
    );
    expect(added).toHaveLength(2);
    for (const job of added) {
      const paper = printedLines(job.payload);
      expect(paper[0]).toBe(`*** ${kitchenTicketWords(language).void} ***`);
      expect(paper.filter((line) => line.includes("x BURG"))).toEqual(["2.000 x BURG"]);
      expect(paper).toContain(
        "  > " +
          kitchenTicketWords(language)
            .withRef.replace("{name}", "CHIPS")
            .replace("{station}", "Fryer"),
      );
    }
    expect(reader).toHaveBeenCalledTimes(1);
    const notices = await suite.db
      .select()
      .from(kitchenNotices)
      .where(eq(kitchenNotices.workingOrderId, v.party.tabId));
    expect(
      notices.filter((notice) => notice.kind === "void").map((notice) => notice.quantity),
    ).toEqual([2000]);
  },
);
