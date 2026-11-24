import { randomUUID } from "node:crypto";
import { count as countRows, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printJobs, printers, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles, seedNode, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { assignMenuToVenue, createMenu, createProduct } from "@waitron/menu";
import { createPrinter, updatePrinter } from "@waitron/printing";
import { nodeId as brandNodeId, jobOrigin } from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";

import { createStation } from "./kitchen.js";
import { createOpenOrder } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { enqueueKitchenTickets } from "./kitchen-print.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { parkedRace } from "./testing/parked-race.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readScopedPassBoard } from "./pass-board.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import "./errors.js";

const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const AT_CLOCK = "13:00";

/**
 * A `updatePrinter` started while a kitchen fire is open never aborts the fire: the fire enqueues
 * its job, the deactivation lands only afterwards, and the printer ends up inactive.
 *
 * Narrower than its name: there is no hook inside `enqueueKitchenTickets`, so the fire parks AFTER
 * it returns, uncommitted. What is observed is the venue file's write queue — a second write
 * transaction does not start while the first is open — not an interleave inside this call path. The
 * mechanism is stated on `assertExtraListForWrite` (`packages/menu/src/extras.ts`).
 */
describe("print-on-fire concurrency — the write queue around the mapping read", () => {
  it("a concurrent updatePrinter runs only after the fire commits, and never aborts it", async () => {
    // ---- Setup, committed before the two contending transactions are staged ----
    await seedTaxpayer(suite.db);
    await seedLegacySellingUnits(suite.db);
    await seedVenue(suite.db, {
      name: "Bar",
      invoiceLocales: [LOCALE],
    });
    const nodeId = await seedNode(suite.db);
    const cfg: OriginConfig = {
      origin: jobOrigin("dashboard"),
      nodeId: brandNodeId(nodeId),
      locale: LOCALE,
      simplifiedInvoiceLimit: null,
    };
    const { kitchenId, printerId, orderId, lineId } = await withTransaction(
      suite.db,
      async (tx) => {
        const cat = await createMenu(tx, { name: "Menu" });
        await assignMenuToVenue(tx, cat.id);
        const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
        const { id: printerId } = await createPrinter(tx, {
          name: "Kitchen printer",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, {
          stationId: kitchen.id,
          printerId,
        });
        const { id: product } = await createProduct(tx, {
          categoryId: null,
          name: "Ribeye",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        const orderId = randomUUID();
        const offers = await offerProducts(tx);
        await createOpenOrder(
          tx,
          cfg,
          orderId,
          offers.toOfferLines([{ productId: product, quantity: "1" }]),
          null,
          { zoneId: offers.zoneId },
        );
        const [line] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        return { kitchenId: kitchen.id, printerId, orderId, lineId: line!.id };
      },
    );

    const firedItems = [{ workingOrderLineId: lineId, stationId: kitchenId }];

    // ---- The race ----
    // The fire parks uncommitted after enqueueing; the deactivate of the same printer, started
    // meanwhile, must not run before it commits.
    let deactivateDone = false;
    const settled = await parkedRace(
      suite.db,
      (txA) => enqueueKitchenTickets(txA, cfg, orderId, firedItems),
      async (txB) => {
        await updatePrinter(txB, printerId, { active: false });
        deactivateDone = true;
      },
    );
    expect(settled).toMatchObject([{ status: "fulfilled" }, { status: "fulfilled" }]);
    expect(deactivateDone).toBe(true);

    // The fire enqueued its job (proof it was never aborted), and the deactivation landed AFTER it.
    const jobs = await suite.db
      .select({ n: countRows() })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    expect(Number(jobs[0]!.n)).toBe(1);
    // Through the table definition: `printers.active` is an integer column with a boolean read
    // mapping, so a raw `select active` would return 0/1.
    const printerRow = await suite.db
      .select({ active: printers.active })
      .from(printers)
      .where(eq(printers.id, printerId));
    expect(printerRow[0]!.active).toBe(false);
  });
});

describe("A773 pass release: a printer two pass screens share", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prints once when both screens Fire the same card, and the other screen then shows it In progress", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-14T12:00:00.000Z") });
    useSplitExtrasDb(suite.db);
    const venue = await setupSplitExtrasVenue();
    const item = await withTransaction(suite.db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            {
              lines: [{ menuItemId: venue.tables.offerFor(venue.products.burger), quantity: "1" }],
              release: "fire",
            },
          ],
        })
      ).groups[0]!;
      const [row] = await tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, group.lineIds[0]!));
      return row!.id;
    });
    const screen = async (name: string): Promise<PassActor> => {
      const [profile] = await withTransaction(suite.db, (tx) =>
        seedDeviceProfiles(tx, {
          name: `${name} profile`,
          formFactor: "kds",
          capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
        }),
      );
      const joined = await enrolDeviceForTest(suite.db, venue.cfg, {
        name,
        profileId: profile!.id,
        kitchenScreen: { kind: "pass", stationIds: [venue.stations.grill], zoneIds: null },
      });
      return { deviceId: joined.deviceId, personId: null };
    };
    const board = (by: PassActor) =>
      withTransaction(suite.db, async (tx) => {
        const pass = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, by.deviceId)).find(
          (candidate) => candidate.kind === "pass",
        )!;
        return readScopedPassBoard(tx, passScopeOf(pass));
      });
    const front = await screen("Front pass");
    const back = await screen("Back pass");
    const [frontCard] = (await board(front)).toFire;
    const [backCard] = (await board(back)).toFire;
    expect([frontCard!.releaseTicketItemIds, backCard!.releaseTicketItemIds]).toEqual([
      [item],
      [item],
    ]);
    const askOf = (card: typeof frontCard) => ({
      submissionId: randomUUID(),
      target: card!.target,
      ticketItemIds: card!.releaseTicketItemIds,
      expectedContext: card!.releaseContext,
    });

    expect(
      await parkedRace(
        suite.db,
        (tx) => releasePassItems(tx, venue.cfg, front, askOf(frontCard)),
        (tx) => releasePassItems(tx, venue.cfg, back, askOf(backCard)),
      ),
    ).toMatchObject([
      { status: "fulfilled", value: { releasedTicketItemIds: [item] } },
      {
        status: "rejected",
        reason: expect.objectContaining({ code: "ticket.pass_context_changed" }),
      },
    ]);

    const fire = `Grill\nSplit extras\n1\n${AT_CLOCK}\nGROUP 1\n1 x BURG\n`;
    const printedAt = async (printerId: string) =>
      (
        await suite.db
          .select({ payload: printJobs.payload })
          .from(printJobs)
          .where(eq(printJobs.printerId, printerId))
      ).map((job) => decodeTicket(job.payload));
    expect({
      grill: await printedAt(venue.printers.grill),
      pass: await printedAt(venue.printers.pass),
    }).toEqual({ grill: [fire], pass: [fire] });
    const after = await board(back);
    expect(after.toFire).toEqual([]);
    expect(after.inProgress.map((card) => card.key)).toEqual([backCard!.key]);
  });
});
