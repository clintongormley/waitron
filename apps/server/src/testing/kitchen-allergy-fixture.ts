import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  orderDraftLines,
  orderDrafts,
  orderGroups,
  parties,
  partyTables,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import {
  allergyLineTicks,
  kitchenNotices,
  partyAllergy,
  partyAllergyGuests,
  ticketItemAllergies,
} from "@waitron/venue-service";
import type { KitchenAllergyBlock } from "@waitron/module";
import { readBillEditState } from "../bill-editing.js";
import { ALLERGEN_NAMES } from "../i18n/kitchen-allergy.js";
import { VENUE_SERVICE } from "../modules.js";
import { submitGroups } from "../order-groups.js";
import { attachPrinterToStation } from "../station-printers.js";
import { mountTillApi } from "../till-api.js";
import { SESSION_COOKIE } from "../till-session.js";
import { saveDraftForTest } from "./draft-command-fixture.js";
import { OPERATOR, counterOrder, inTx, revisionOf, seat, setupPartyVenue } from "./party-venue.js";

export const kitchenOriginal: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
  clashes: {},
  labels: {
    en: { avoids: ["Milk"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [] },
  },
};
export const kitchenCurrent: KitchenAllergyBlock = { ...kitchenOriginal, note: "Fresh tools" };
export type KitchenCaller = "edit" | "groups" | "draft" | "release" | "move";
export const kitchenCallers: KitchenCaller[] = ["edit", "groups", "draft", "release", "move"];

export async function kitchenFixture(db: Database) {
  const v = await setupPartyVenue(db);
  await db.insert(persons).values({ id: OPERATOR, displayName: "Test operator", role: "staff" });
  const token = randomUUID();
  await db
    .update(sessions)
    .set({ tokenHash: hashSessionToken(token) })
    .where(eq(sessions.id, v.operator.sessionId));
  const tableId = await v.table("Atomic kitchen");
  const party = await seat(v, tableId);
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, party.tabId),
      groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "3" }] }],
      allergy: {
        party: { answer: "allergies", guests: [kitchenOriginal] },
        ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
      },
    }),
  );
  const [ticket] = await db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, party.tabId));
  await inTx(v, async (tx) => {
    const printer = await createPrinter(tx, v.cfg, {
      name: "Atomic printer",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, {
      locationId: v.cfg.locationId,
      stationId: ticket!.stationId,
      printerId: printer.id,
    });
  });
  const app = new Hono();
  mountTillApi(
    app,
    {
      db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      venueLocale: "en-GB",
      secureCookies: false,
    },
    () => {},
  );
  return { v, party, tableId, ticket: ticket!, app, token, cookie: `${SESSION_COOKIE}=${token}` };
}
export type KitchenFixture = Awaited<ReturnType<typeof kitchenFixture>>;
export interface KitchenCommand {
  url: string;
  method: "PUT" | "POST";
  body: Record<string, unknown>;
}

export async function kitchenCommand(
  f: KitchenFixture,
  caller: KitchenCaller,
): Promise<KitchenCommand> {
  const { v, party } = f;
  const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, party.partyId));
  const allergy = {
    party: { answer: "allergies", guests: [{ ...snapshot.guests[0]!, note: kitchenCurrent.note }] },
    ticks: [],
  };
  if (caller === "move") {
    const billId = await counterOrder(v, "Burger");
    return {
      url: `/api/bills/${billId}/move`,
      method: "POST",
      body: {
        submissionId: randomUUID(),
        partyId: null,
        otherPartyId: party.partyId,
        expectedOtherPartyRevision: await revisionOf(v, party.partyId),
        bills: "separate",
        to: { tableId: f.tableId },
        allergy,
        expectedEdits: await inTx(v, async (tx) =>
          [await readBillEditState(tx, billId), await readBillEditState(tx, party.tabId)].sort(
            (a, b) => a.billId.localeCompare(b.billId),
          ),
        ),
      },
    };
  }
  const body = {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, party.partyId),
    allergy,
  };
  if (caller === "edit")
    return { url: `/api/parties/${party.partyId}/allergy`, method: "PUT", body };
  if (caller === "release") {
    const held = await inTx(v, async (tx) =>
      submitGroups(tx, v.cfg, party.partyId, {
        ...body,
        operatorId: OPERATOR,
        allergy: undefined,
        expectedEdit: await readBillEditState(tx, party.tabId),
        groups: [
          {
            release: "hold",
            lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Held dish" }],
          },
        ],
      }),
    );
    return {
      url: `/api/parties/${party.partyId}/groups/${held.groups[0]!.id}/fire`,
      method: "POST",
      body: {
        ...body,
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(v, party.partyId),
      },
    };
  }
  if (caller === "draft") {
    const draft = await inTx(v, (tx) =>
      saveDraftForTest(tx, v.cfg, party.partyId, OPERATOR, {
        billId: party.tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            sourceLineId: null,
            menuItemId: v.item("Burger"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: "Draft dish",
            quantity: "1",
            courseId: null,
            noMerge: true,
            slot: 0,
            joinGroupId: null,
            afterGroupId: null,
          },
        ],
      }),
    );
    return {
      url: `/api/parties/${party.partyId}/drafts/${draft.id}/submit`,
      method: "POST",
      body: {
        ...body,
        expectedPartyRevision: await revisionOf(v, party.partyId),
        draftRevision: draft.revision,
        expectedEdit: await inTx(v, (tx) => readBillEditState(tx, party.tabId)),
        groups: [{ release: "fire", lineIds: draft.lines.map((line) => line.id) }],
      },
    };
  }
  return {
    url: `/api/parties/${party.partyId}/groups`,
    method: "POST",
    body: {
      ...body,
      expectedEdit: await inTx(v, (tx) => readBillEditState(tx, party.tabId)),
      groups: [
        {
          release: "fire",
          lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "New dish" }],
        },
      ],
    },
  };
}

export function requestKitchen(f: KitchenFixture, command: KitchenCommand) {
  return f.app.request(command.url, {
    method: command.method,
    headers: { cookie: f.cookie, "content-type": "application/json" },
    body: JSON.stringify(command.body),
  });
}

export async function kitchenState(db: Database) {
  return inTx({ db }, async (tx) => ({
    answers: await tx.select().from(partyAllergy),
    guests: await tx.select().from(partyAllergyGuests),
    ticks: await tx.select().from(allergyLineTicks),
    copies: await tx.select().from(ticketItemAllergies),
    notices: await tx.select().from(kitchenNotices),
    jobs: await tx.select().from(printJobs),
    parties: await tx.select().from(parties),
    tables: await tx.select().from(partyTables),
    bills: await tx.select().from(workingOrders),
    lines: await tx.select().from(workingOrderLines),
    groups: await tx.select().from(orderGroups),
    tickets: await tx.select().from(ticketItems),
    drafts: await tx.select().from(orderDrafts),
    draftLines: await tx.select().from(orderDraftLines),
    commands: await tx.select().from(serviceCommands),
  }));
}
