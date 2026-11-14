import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { kitchenStations, printJobs, withTransaction, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setMenuVariants, setProductVariants, updateProduct } from "@waitron/menu";
import type { DietaryLabel, ProductAllergens } from "@waitron/menu";
import { createPrinter } from "@waitron/printing";
import type { KitchenAllergyBlock } from "@waitron/module";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups } from "./order-groups.js";
import {
  enqueueAllergyCorrectionSlips,
  enqueueMovedSlips,
  readSentWork,
  reprintOrderTickets,
} from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  ALLERGEN_KIND_NAMES,
  ALLERGEN_NAMES,
  KITCHEN_ALLERGY_WORDS,
} from "./i18n/kitchen-allergy.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";
import {
  inTx,
  OPERATOR,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
  type ProductLine,
} from "./testing/split-extras-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
beforeAll(() => useSplitExtrasDb(suite.db));
let v: PartyVenue;
async function setupAllergyPaper() {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(and(eq(kitchenStations.isDefault, true)));
  await inTx(v, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Allergy paper",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, {
      stationId: station!.id,
      printerId: printer.id,
    });
  });
}

async function send(
  p: Awaited<ReturnType<typeof seat>>,
  release: "fire" | "hold",
  assigned = true,
) {
  const expectedPartyRevision = await revisionOf(v, p.partyId);
  const existing = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
  const guestId = existing.guests[0]?.id;
  return inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, p.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, p.tabId),
      groups: [
        { release, lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Dish note" }] },
      ],
      allergy: {
        party: {
          answer: "allergies",
          guests: [
            {
              ...(guestId === undefined ? {} : { id: guestId }),
              who: "Window guest",
              allergens: { milk: {} },
              note: "Separate pan",
            },
          ],
        },
        ticks: [
          {
            line: { kind: "submitted", groupIndex: 0, lineIndex: 0 },
            guestIndex: assigned ? 0 : null,
          },
        ],
      },
    }),
  );
}
function words(payload: Uint8Array) {
  return printedLines(payload)
    .map((line) => line.trim())
    .join(" ")
    .replace(/ +/g, " ");
}

describe("A669 paper stored copies", () => {
  beforeEach(setupAllergyPaper);

  it.each(["fire", "hold"] as const)(
    "prints the frozen original on a %s ticket",
    async (release) => {
      await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }));
      const p = await seat(v, await v.table("Kitchen allergy"));
      await send(p, release);
      const jobs = await v.db.select().from(printJobs);
      expect(jobs).toHaveLength(1);
      expect(words(jobs[0]!.payload)).toContain(
        KITCHEN_ALLERGY_WORDS.es.guestHeading.replace("{who}", "Window guest"),
      );
      expect(words(jobs[0]!.payload)).toContain("Separate pan");
    },
  );

  it("keeps old job bytes and prints the original when current instructions differ on joined reprints", async () => {
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }));
    const p = await seat(v, await v.table("Joined allergy"));
    await send(p, "fire");
    await send(p, "hold");
    const before = await v.db.select().from(printJobs);
    const tickets = await ticketItemsWithBill(v.db).where(
      eq(workingOrderLines.workingOrderId, p.tabId),
    );
    const copies = await inTx(v, (tx) =>
      VENUE_SERVICE.readTicketAllergies(
        tx,
        tickets.map((t) => t.id),
      ),
    );
    for (const ticket of tickets) {
      const original = copies.get(ticket.id)!.originalBlock!;
      await inTx(v, (tx) =>
        VENUE_SERVICE.setTicketAllergyCurrent(tx, ticket.id, {
          ...original,
          who: "New guest",
          note: "New note",
        }),
      );
    }
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
    const jobs = await v.db.select().from(printJobs);
    expect(jobs).toHaveLength(3);
    for (const old of before) expect(jobs.find((j) => j.id === old.id)).toEqual(old);
    const next = jobs.find((j) => !before.some((old) => old.id === j.id))!;
    const text = words(next.payload);
    expect(text.match(/Window guest/g)).toHaveLength(2);
    expect(text).not.toContain("New guest");
    expect(text).not.toContain("New note");
    expect(printedCommands(next.payload).filter((c) => c.name === "GS V")).toHaveLength(1);
  });

  it("leaves unticked work without a heading or guest block", async () => {
    const p = await seat(v, await v.table("Plain kitchen"));
    await send(p, "fire", false);
    const jobs = await v.db.select().from(printJobs);
    expect(jobs).toHaveLength(1);
    expect(words(jobs[0]!.payload)).not.toContain("Window guest");
    expect(words(jobs[0]!.payload)).not.toContain(KITCHEN_ALLERGY_WORDS.es.ticketHeading);
  });
});

/** The printed lines of every job queued to `printerId`, in the order they were queued. */
async function papersOn(printerId: string): Promise<string[][]> {
  const jobs = await suite.db.select().from(printJobs).where(eq(printJobs.printerId, printerId));
  return jobs.map((job) => printedLines(job.payload).map((line) => line.trim()));
}

function setAllergens(
  productId: string,
  allergens: ProductAllergens | null,
  dietaryDeclarations?: DietaryLabel[],
) {
  return withTransaction(suite.db, (tx) =>
    updateProduct(tx, productId, {
      allergens,
      ...(dietaryDeclarations === undefined ? {} : { dietaryDeclarations }),
    }),
  );
}

describe("A1517-3 a dish's own allergens on English station paper", () => {
  let s: Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
  beforeEach(async () => {
    s = await setupSplitExtrasVenue();
  });
  const fire = (lines: ProductLine[]) =>
    withTransaction(suite.db, (tx) => fireNewOrder(tx, s.cfg, lines));

  it("prints a dish's declared allergens with no guest allergy, and no allergy heading", async () => {
    await setAllergens(s.products.burger, { milk: {} });
    await fire([{ productId: s.products.burger, quantity: "1" }]);
    const [paper] = await papersOn(s.printers.grill);
    expect(paper).toContain("Contains: Milk");
    expect(paper!.indexOf("Contains: Milk")).toBe(paper!.indexOf("1 x BURG") + 1);
    expect(paper).not.toContain(KITCHEN_ALLERGY_WORDS.en.ticketHeading);
  });

  // Guard: passes before A1517-3, and must keep passing — an unreviewed dish prints nothing.
  it("guard: prints no Contains line and no Not reviewed for a dish whose allergens were never reviewed", async () => {
    await setAllergens(s.products.burger, null);
    await fire([{ productId: s.products.burger, quantity: "1" }]);
    const text = (await papersOn(s.printers.grill)).flat().join("\n");
    expect(text).toContain("1 x BURG");
    expect(text).not.toContain("Contains");
    expect(text).not.toMatch(/not reviewed/i);
  });

  // Passes before A1517-3 too: it pins that the reader's entry for a vegan dish prints no empty line.
  it("prints no Contains line for a dish checked free of allergens that is labelled vegan", async () => {
    await setAllergens(s.products.burger, {}, ["vegan"]);
    await fire([{ productId: s.products.burger, quantity: "1" }]);
    const text = (await papersOn(s.printers.grill)).flat().join("\n");
    expect(text).toContain("1 x BURG");
    expect(text).not.toContain("Contains");
    expect(text).not.toMatch(/vegan/i);
  });

  it("prints a modifier extra's own allergens beside it, and the dish's line names the dish's only", async () => {
    await setAllergens(s.products.burger, { gluten: { kinds: ["wheat"] } });
    await setAllergens(s.products.cheese, { milk: {} });
    await fire([
      {
        productId: s.products.burger,
        quantity: "1",
        extras: [
          { listId: s.lists.burger, picks: [{ productId: s.products.cheese, quantity: 1 }] },
        ],
      },
    ]);
    const [paper] = await papersOn(s.printers.grill);
    expect(paper).toContain("+ CHED - contains Milk");
    // A wrapped line continues on the next, so the dish's line is read joined.
    const text = paper!.join(" ");
    expect(text.match(/Contains:/g)).toHaveLength(1);
    expect(text).toContain("Contains: Cereals containing gluten (Wheat)");
    expect(text).not.toContain("Contains: Milk");
  });

  it("prints a variant's inherited declaration from its parent product", async () => {
    await setAllergens(s.products.burger, { gluten: { kinds: ["wheat"] } });
    await withTransaction(suite.db, async (tx) => {
      const [double] = await setProductVariants(
        tx,
        s.products.burger,
        [
          {
            name: "Double",
            customerName: null,
            kitchenName: "DBL",
            image: null,
            unitPrice: "2.00",
            available: true,
          },
        ],
        s.cfg.locale,
      );
      const offers = await offerProducts(tx, s.cfg);
      await setMenuVariants(tx, offers.offerFor(s.products.burger), [
        { variantId: double!.id, price: "2.00" },
      ]);
      await publishWorkingMenu(tx, offers.menuId);
      const lines: (ProductLine & { variantId: string })[] = [
        { productId: s.products.burger, variantId: double!.id, quantity: "1" },
      ];
      await fireNewOrder(tx, s.cfg, lines);
    });
    const [paper] = await papersOn(s.printers.grill);
    expect(paper).toContain("1 x BURG (DBL)");
    expect(paper!.join(" ")).toContain("Contains: Cereals containing gluten (Wheat)");
  });

  it("prints each station's dishes' allergens on a shared printer's ticket", async () => {
    await setAllergens(s.products.burger, { milk: {} });
    await fire([
      { productId: s.products.burger, quantity: "1" },
      { productId: s.products.chips, quantity: "1" },
    ]);
    const papers = await papersOn(s.printers.pass);
    expect(papers).toHaveLength(1);
    expect(papers[0]).toContain("Contains: Milk");
    expect(papers[0]!.join(" ")).toContain("Contains: Cereals containing gluten (Wheat)");
  });

  it("prints the dish's allergens on a moved slip", async () => {
    await setAllergens(s.products.burger, { milk: {} });
    const id = await fire([{ productId: s.products.burger, quantity: "1" }]);
    const before = (await papersOn(s.printers.grill)).length;
    await withTransaction(suite.db, async (tx) => {
      const sent = (await readSentWork(tx, id))!;
      await enqueueMovedSlips(
        tx,
        s.cfg,
        { ...sent, places: { ...sent.places, orderNumber: sent.places.orderNumber + 1 } },
        id,
      );
    });
    const moved = (await papersOn(s.printers.grill)).slice(before);
    expect(moved).toHaveLength(1);
    expect(moved[0]![0]).toBe("*** MOVED ***");
    expect(moved[0]).toContain("Contains: Milk");
  });
});

describe("A1517-3 a dish's own allergens on Spanish paper beside a guest block", () => {
  beforeEach(setupAllergyPaper);
  const contiene = (allergens: string) =>
    KITCHEN_ALLERGY_WORDS.es.contains.replace("{allergens}", () => allergens);
  const glutenWheat = `${ALLERGEN_NAMES.gluten.es} (${ALLERGEN_KIND_NAMES.wheat!.es})`;

  it("prints Contiene with Spanish names, sorted by allergen", async () => {
    await setAllergens(v.productId("Burger"), { nuts: { kinds: ["walnuts"] }, milk: {} });
    const p = await seat(v, await v.table("Spanish allergens"));
    await send(p, "fire", false);
    const [job] = await v.db.select().from(printJobs);
    const lines = printedLines(job!.payload).map((line) => line.trim());
    expect(lines.join(" ")).toContain(
      contiene(
        `${ALLERGEN_NAMES.milk.es}, ${ALLERGEN_NAMES.nuts.es} (${ALLERGEN_KIND_NAMES.walnuts!.es})`,
      ),
    );
    expect(lines.some((line) => line.startsWith("Contains"))).toBe(false);
  });

  it("reprints the declaration as it is now, while the guest block keeps its original text", async () => {
    await setAllergens(v.productId("Burger"), { gluten: { kinds: ["wheat"] } });
    const p = await seat(v, await v.table("Edited dish"));
    await send(p, "fire");
    const [first] = await v.db.select().from(printJobs);
    await setAllergens(v.productId("Burger"), { eggs: {} });
    const [ticket] = await ticketItemsWithBill(v.db).where(
      eq(workingOrderLines.workingOrderId, p.tabId),
    );
    const original = (
      await inTx(v, (tx) => VENUE_SERVICE.readTicketAllergies(tx, [ticket!.id]))
    ).get(ticket!.id)!.originalBlock!;
    await inTx(v, (tx) =>
      VENUE_SERVICE.setTicketAllergyCurrent(tx, ticket!.id, { ...original, note: "New note" }),
    );
    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, p.tabId));
    const jobs = await v.db.select().from(printJobs);
    expect(jobs.find((job) => job.id === first!.id)).toEqual(first);
    expect(printedLines(first!.payload).map((l) => l.trim())).toContain(contiene(glutenWheat));
    const reprint = printedLines(jobs.find((job) => job.id !== first!.id)!.payload).map((l) =>
      l.trim(),
    );
    expect(reprint.filter((line) => line.startsWith(contiene("")))).toEqual([
      contiene(ALLERGEN_NAMES.eggs.es),
    ]);
    expect(reprint.join(" ")).toContain("Separate pan");
    expect(reprint.join(" ")).not.toContain("New note");
  });

  it("prints the dish's allergens on an ALLERGY CHANGED slip", async () => {
    await setAllergens(v.productId("Burger"), { gluten: { kinds: ["wheat"] } });
    const p = await seat(v, await v.table("Changed allergy"));
    await send(p, "fire");
    const before = await v.db.select().from(printJobs);
    const [ticket] = await ticketItemsWithBill(v.db).where(
      eq(workingOrderLines.workingOrderId, p.tabId),
    );
    const block: KitchenAllergyBlock = {
      who: "Corrected guest",
      allergens: { milk: {} },
      note: null,
      clashes: {},
      labels: {
        en: { avoids: ["Milk"], clashes: [] },
        es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [] },
      },
    };
    await inTx(v, (tx: Transaction) =>
      enqueueAllergyCorrectionSlips(tx, v.cfg, p.tabId, [
        {
          workingOrderLineId: ticket!.workingOrderLineId,
          stationId: ticket!.stationId!,
          quantity: 1000,
          wasStarted: false,
          allergyBlock: block,
        },
      ]),
    );
    const slips = (await v.db.select().from(printJobs)).filter(
      (job) => !before.some((old) => old.id === job.id),
    );
    expect(slips).toHaveLength(1);
    const lines = printedLines(slips[0]!.payload).map((line) => line.trim());
    expect(lines.join("\n")).toContain(KITCHEN_ALLERGY_WORDS.es.changed);
    expect(lines).toContain(contiene(glutenWheat));
  });
});
