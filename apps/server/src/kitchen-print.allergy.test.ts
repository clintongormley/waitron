import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { kitchenStations, printJobs, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { writePrintHeldWork } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups } from "./order-groups.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { attachPrinterToStation } from "./station-printers.js";
import { VENUE_SERVICE } from "./modules.js";
import { KITCHEN_ALLERGY_WORDS } from "./i18n/kitchen-allergy.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";
import {
  inTx,
  OPERATOR,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, v.cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  await inTx(v, async (tx) => {
    const printer = await createPrinter(tx, v.cfg, {
      name: "Allergy paper",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, {
      locationId: v.cfg.locationId,
      stationId: station!.id,
      printerId: printer.id,
    });
  });
});

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
  it.each(["fire", "hold"] as const)(
    "prints the frozen original on a %s ticket",
    async (release) => {
      await inTx(v, (tx) => writePrintHeldWork(tx, true));
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
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const p = await seat(v, await v.table("Joined allergy"));
    await send(p, "fire");
    await send(p, "hold");
    const before = await v.db.select().from(printJobs);
    const tickets = await v.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, p.tabId));
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
