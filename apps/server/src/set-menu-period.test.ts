import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createMenu, updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { replaceMenuWeek, resolveZoneContext, saveMenuPeriod } from "@waitron/venue-service";
import { fireGroup } from "./order-groups.js";
import { submitDraft, type Draft } from "./order-drafts.js";
import { expectedDraftEditForTest, saveDraftForTest } from "./testing/draft-command-fixture.js";
import {
  commandFor,
  inTx,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
const serviceDate = new Date("2026-11-19T10:00:00+01:00");
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    daily = await inTx(venue, async (tx) => {
      const menu = await setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan"));
      const { departmentId } = await resolveZoneContext(tx, venue.tables.zoneId);
      const dinner = await createMenu(tx, { name: "Dinner menu" });
      await publishWorkingMenu(tx, dinner.id);
      const lunchPeriod = await saveMenuPeriod(tx, departmentId, {
        name: "Lunch",
        menuId: menu.fullMenuId,
        staffMenuIds: [],
      });
      const dinnerPeriod = await saveMenuPeriod(tx, departmentId, {
        name: "Dinner",
        menuId: dinner.id,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        departmentId,
        Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: [
            { periodId: lunchPeriod.id, startsAt: "12:00", endsAt: "15:00" },
            { periodId: dinnerPeriod.id, startsAt: "15:00", endsAt: "21:00" },
          ],
        })),
        serviceDate,
        1,
      );
      return menu;
    });
  },
});

afterEach(() => vi.useRealTimers());

function at(time: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`2026-11-19T${time}:00+01:00`));
}

async function draftMenuDish(recorded: boolean, time = "14:00") {
  at("14:00");
  const { tabId, partyId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  if (recorded) await inTx(venue, (tx) => seedBillSetMenu(tx, tabId, daily, 1));
  at(time);
  return inTx(venue, (tx) =>
    saveDraftForTest(tx, venue.cfg, partyId, venue.operator.personId, {
      billId: tabId,
      draftId: null,
      revision: 0,
      lines: [
        {
          menuItemId: daily.menuItemId,
          menuVersionId: daily.versionId,
          setMenuId: daily.menuId,
          quantity: "1",
        },
      ],
    }),
  );
}

async function send(draft: Draft, release: "fire" | "hold") {
  const command = await commandFor(venue, draft.partyId);
  return inTx(venue, async (tx) =>
    submitDraft(tx, venue.cfg, draft.partyId, draft.id, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: [draft.lines[0]!.id], release }],
    }),
  );
}

it("sends a recorded set-menu dessert after its period ended", async () => {
  const draft = await draftMenuDish(true, "15:30");
  const sent = await send(draft, "fire");
  expect(sent.groups[0]).toMatchObject({ state: "fired", lineIds: [expect.any(String)] });
});

it("refuses a dish from a set menu the bill never recorded once its period ended", async () => {
  const draft = await draftMenuDish(false);
  at("15:30");
  await expect(send(draft, "fire")).rejects.toMatchObject({
    code: "menu_period.not_running",
    params: { menuId: daily.fullMenuId },
  });
});

it("asks before firing a held set-menu dish after its full-menu period ended", async () => {
  const draft = await draftMenuDish(true);
  const { groups } = await send(draft, "hold");
  at("15:30");
  const command = await commandFor(venue, draft.partyId);
  const release = (lateSend?: Parameters<typeof fireGroup>[4]["lateSend"]) =>
    inTx(venue, (tx) =>
      fireGroup(tx, venue.cfg, draft.partyId, groups[0]!.id, {
        ...command,
        submissionId: crypto.randomUUID(),
        lateSend,
      }),
    );
  await expect(release()).rejects.toMatchObject({
    code: "menu_period.ended",
    params: { menuItemIds: [daily.menuItemId], workingOrderLineIds: groups[0]!.lineIds },
  });
  await release({
    menuIds: new Set([daily.fullMenuId]),
    confirm: async () => venue.operator.personId,
  });
  const [dish] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, groups[0]!.lineIds[0]!));
  expect(dish).toMatchObject({
    latePeriodName: "Lunch",
    lateConfirmedBy: venue.operator.personId,
  });
});

it("keeps the recorded version when the full menu is republished", async () => {
  const draft = await draftMenuDish(true);
  const latest = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: "17.00" });
    return publishWorkingMenu(tx, daily.fullMenuId);
  });
  expect(latest).not.toBe(daily.versionId);
  at("15:30");
  const sent = await send(draft, "fire");
  const [dish] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, sent.groups[0]!.lineIds[0]!));
  expect(dish).toMatchObject({
    setMenuRole: "dish",
    menuId: daily.fullMenuId,
    menuVersionId: daily.versionId,
    unitPriceGross: 0,
  });
});
