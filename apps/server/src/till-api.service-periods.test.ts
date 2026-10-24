import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { observedOrderWriteBody } from "./testing/order-writer-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  locations,
  parties,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { loginWithPin, persons, registerModulePermissions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProductToMenu,
  createCatalogue,
  createCategory,
  createProduct,
  createExtraList,
  writeProductModifiers,
  deactivateCatalogue,
} from "@waitron/catalogue";
import {
  departmentSalePolicies,
  createServiceZone,
  menuPeriods,
  orderServiceContexts,
  replaceMenuWeek,
  routingCellPeriods,
  routingCells,
  saveMenuPeriod,
  setRoutingCell,
  updateDepartment,
  updateMenuPeriod,
  VENUE_SERVICE_PERMISSIONS,
  workingLineContexts,
  type MenuSlot,
} from "@waitron/venue-service";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { createPrinter } from "@waitron/printing";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { attachPrinterToStation } from "./station-printers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { KITCHEN_LATE_SEND_WORDS } from "./i18n/kitchen-late-send.js";
import { createTable } from "./testing/live-table.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill as rawSendAsTill,
  SIGNED_IN_TILL_LOCALE,
} from "./testing/signed-in-till.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** Monday 5 October 2026 in Madrid, which is on UTC+2 that day. */
const MONDAY_10_00 = new Date("2026-10-05T08:00:00Z");
const MONDAY_12_30 = new Date("2026-10-05T10:30:00Z");
const MONDAY_13_00 = new Date("2026-10-05T11:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

const at = (instant: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
};

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(71_000_000 + ++nifCounter);

const MENUS = ["Desayunos", "Almuerzo", "Bebidas", "Café", "Deli para llevar"] as const;
type MenuName = (typeof MENUS)[number];

interface Venue {
  cfg: TillConfig;
  app: Hono;
  cookie: string;
  personId: string;
  restaurant: string;
  deli: string;
  barZone: string;
  diningZone: string;
  terraceZone: string;
  deliCounterZone: string;
  menus: Record<MenuName, string>;
  versions: Record<MenuName, string>;
  toast: { desayunos: string; almuerzo: string };
  sandwich: string;
}

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});

async function setupVenue(options: {
  timetable: boolean;
  simulatorCard?: boolean;
}): Promise<Venue> {
  return provisionSignedInTill(suite.db, {
    taxId: nextNif(),
    dayCutover: "05:00",
    simulatorCard: options.simulatorCard,
    seed: async (tx, cfg) => {
      const restaurant = await createBareDepartment(tx, cfg, "Restaurant", MONDAY_10_00);
      const deli = await createBareDepartment(tx, cfg, "Deli", MONDAY_10_00);
      const zone = async (name: string, departmentId: string) =>
        (await createServiceZone(tx, cfg, { name, departmentId })).id;
      const barZone = await zone("Barra", restaurant);
      const diningZone = await zone("Sala", restaurant);
      const terraceZone = await zone("Terraza", restaurant);
      const deliCounterZone = await zone("Mostrador deli", deli);
      const menus = {} as Record<MenuName, string>;
      for (const name of MENUS) menus[name] = (await createCatalogue(tx, { name })).id;
      const product = (catalogueId: string, name: string, unitPrice: string) =>
        createProduct(tx, {
          catalogueId,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice,
          vatClass: "general",
        });
      const toast = await product(menus.Desayunos, "Tostada", "3.00");
      const offer = async (menu: MenuName, productId: string, grossPrice?: string) =>
        (await addProductToMenu(tx, { menuId: menus[menu], productId, grossPrice })).id;
      const toastOffers = {
        desayunos: await offer("Desayunos", toast.id, "2.50"),
        almuerzo: await offer("Almuerzo", toast.id, "4.00"),
      };
      await offer("Café", (await product(menus["Café"], "Cortado", "1.60")).id);
      await offer("Bebidas", (await product(menus.Bebidas, "Agua", "2.00")).id);
      const sandwich = await offer(
        "Deli para llevar",
        (await product(menus["Deli para llevar"], "Bocadillo", "6.50")).id,
      );
      const versions = {} as Record<MenuName, string>;
      for (const name of MENUS) versions[name] = await publishWorkingMenu(tx, menus[name]);
      await offerMenuThroughZone(tx, cfg, deliCounterZone, menus["Deli para llevar"], {
        makeDefault: true,
      });
      if (options.timetable) {
        const period = async (name: string, menu: MenuName) =>
          (
            await saveMenuPeriod(tx, cfg, restaurant, {
              name,
              menuId: menus[menu],
              staffMenuIds: [menus.Bebidas, menus["Café"]],
            })
          ).id;
        const morningPeriodId = await period("Mañanas", "Desayunos");
        const middayPeriodId = await period("Mediodía", "Almuerzo");
        await replaceMenuWeek(
          tx,
          cfg,
          restaurant,
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            slots: [
              slot(morningPeriodId, "09:00", "12:00"),
              slot(middayPeriodId, "12:00", "16:00"),
            ],
          })),
          MONDAY_10_00,
          0,
        );
      } else {
        await offerMenuThroughZone(tx, cfg, barZone, menus.Bebidas, { makeDefault: true });
        for (const menu of [menus.Desayunos, menus.Almuerzo, menus["Café"]])
          await offerMenuThroughZone(tx, cfg, barZone, menu);
      }
      return {
        departmentId: restaurant,
        startingZoneId: barZone,
        restaurant,
        deli,
        barZone,
        diningZone,
        terraceZone,
        deliCounterZone,
        menus,
        versions,
        toast: toastOffers,
        sandwich,
      };
    },
  });
}

const park = (v: Venue, zoneId: string, menuItemId: string, menuVersionId?: string) => {
  const id = randomUUID();
  return sendAsTill(v, "POST", "/api/working-orders", {
    id,
    zoneId,
    lines: [
      { menuItemId, quantity: "1", ...(menuVersionId === undefined ? {} : { menuVersionId }) },
    ],
  }).then((answer) => ({ ...answer, id }));
};

const linesOf = (tx: Transaction, workingOrderId: string) =>
  tx
    .select({
      id: workingOrderLines.id,
      unitPriceGross: workingOrderLines.unitPriceGross,
      menuName: workingLineContexts.menuName,
      menuVersionId: workingLineContexts.menuVersionId,
      departmentId: workingLineContexts.departmentId,
    })
    .from(workingOrderLines)
    .innerJoin(
      workingLineContexts,
      eq(workingLineContexts.workingOrderLineId, workingOrderLines.id),
    )
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));

async function replacePeriodMembership(
  tx: Transaction,
  cfg: TillConfig,
  departmentId: string,
  menuIds: readonly string[],
) {
  const periods = await tx
    .select({ id: menuPeriods.id, menuId: menuPeriods.menuId })
    .from(menuPeriods)
    .where(eq(menuPeriods.departmentId, departmentId));
  for (const period of periods)
    await updateMenuPeriod(tx, cfg, period.id, {
      staffMenuIds: menuIds.filter((id) => id !== period.menuId),
    });
}

describe("ordering uses period membership while browsing follows the timetable", () => {
  it("keeps a stored Desayunos line at its published price after its period has ended", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    const parked = await park(v, v.diningZone, v.toast.desayunos, v.versions.Desayunos);
    expect(parked.status).toBe(200);
    at(MONDAY_13_00);
    const offers = await sendAsTill(v, "GET", `/api/service-zones/${v.diningZone}/offers`);
    expect(offers.body).toMatchObject({ defaultMenuId: v.menus.Almuerzo });
    expect((await editMealLine(v, parked.id, { note: "No salt" })).status).toBe(200);
    const lines = await withTransaction(suite.db, (tx) => linesOf(tx, parked.id));
    expect(lines).toMatchObject([{ unitPriceGross: 250, menuName: "Desayunos" }]);
  });

  it("sells another department's menu in its own zones once it is in the department's periods, and only then", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_13_00);
    await withTransaction(suite.db, (tx) =>
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
        v.menus.Desayunos,
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
        v.menus["Deli para llevar"],
      ]),
    );
    const parked = await park(v, v.barZone, v.sandwich);
    expect(parked.status).toBe(200);
    const recorded = await withTransaction(suite.db, async (tx) => ({
      order: await tx
        .select({ departmentId: orderServiceContexts.departmentId })
        .from(orderServiceContexts)
        .where(eq(orderServiceContexts.workingOrderId, parked.id)),
      lines: await linesOf(tx, parked.id),
    }));
    expect(recorded.order).toEqual([{ departmentId: v.restaurant }]);
    expect(recorded.lines).toMatchObject([
      { departmentId: v.restaurant, menuName: "Deli para llevar" },
    ]);

    expect(await sendAsTill(v, "GET", `/api/service-zones/${v.deliCounterZone}/offers`)).toEqual({
      status: 403,
      body: { error: { code: "service_zone.not_allowed", params: { zoneId: v.deliCounterZone } } },
    });

    await withTransaction(suite.db, (tx) =>
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
        v.menus.Desayunos,
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
      ]),
    );
    const refused = await park(v, v.barZone, v.sandwich);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      error: {
        code: "service_zone.offer_not_allowed",
        params: { zoneId: v.barZone, menuItemId: v.sandwich },
      },
    });
  });

  it("refuses a line asserting a menu removed from the department's periods, and leaves the lines already held as they were", async () => {
    const v = await setupVenue({ timetable: false });
    at(MONDAY_10_00);
    const offers = (await sendAsTill(v, "GET", `/api/service-zones/${v.diningZone}/offers`))
      .body as {
      menus: { id: string; versionId: string }[];
    };
    const desayunos = offers.menus.find((menu) => menu.id === v.menus.Desayunos)!.versionId;
    const held = await park(v, v.diningZone, v.toast.desayunos, desayunos);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    expect(before).toMatchObject([
      { unitPriceGross: 250, menuName: "Desayunos", menuVersionId: desayunos },
    ]);

    await withTransaction(suite.db, (tx) =>
      replacePeriodMembership(tx, v.cfg, v.restaurant, [
        v.menus.Almuerzo,
        v.menus.Bebidas,
        v.menus["Café"],
      ]),
    );
    const order = (await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).body as {
      revision: number;
      lines: { workingOrderLineId: string; menuItemId: string; quantity: string }[];
    };
    const added = await sendAsTill(v, "PUT", `/api/working-orders/${held.id}`, {
      revision: order.revision,
      lines: [
        ...order.lines.map(({ workingOrderLineId, menuItemId, quantity }) => ({
          workingOrderLineId,
          menuItemId,
          quantity,
        })),
        { menuItemId: v.toast.desayunos, quantity: "1", menuVersionId: desayunos },
      ],
    });
    expect(added).toEqual({
      status: 409,
      body: {
        error: {
          code: "menu.version_changed",
          params: { menus: [{ menuId: v.menus.Desayunos, liveVersionId: null }] },
        },
      },
    });
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);

    const paid = await sendAsTill(v, "POST", "/api/sales", {
      workingOrderId: held.id,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ total: "2.50", tender: { method: "cash", change: "2.50" } });
    const [settled] = await suite.db
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, held.id));
    expect(settled).toEqual({ status: "settled" });
  });
});

async function mealVenue(weekdays: readonly number[] = [1], simulatorCard = false): Promise<Venue> {
  const v = await setupVenue({ timetable: true, simulatorCard });
  await withTransaction(suite.db, async (tx) => {
    const periods = await tx
      .select()
      .from(menuPeriods)
      .where(eq(menuPeriods.departmentId, v.restaurant));
    const lunch = periods.find((period) => period.menuId === v.menus.Almuerzo)!;
    const dinner = periods.find((period) => period.menuId === v.menus.Desayunos)!;
    await updateMenuPeriod(tx, v.cfg, lunch.id, { name: "Lunch" });
    await updateMenuPeriod(tx, v.cfg, dinner.id, { name: "Dinner" });
    await replaceMenuWeek(
      tx,
      v.cfg,
      v.restaurant,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        slots: weekdays.includes(weekday)
          ? [slot(lunch.id, "12:00", "14:00"), slot(dinner.id, "19:00", "23:00")]
          : [],
      })),
      MONDAY_10_00,
      0,
    );
  });
  return v;
}

const mondayAt = (time: string) => new Date(`2026-10-05T${time}:00+02:00`);

/** The refusal of a fresh dish whose menu sold in `periodName` earlier today, sent unconfirmed. */
const periodEnded = (v: Venue, menu: MenuName, periodName: string, menuItemId: string) => ({
  status: 409,
  body: {
    error: {
      code: "menu_period.ended",
      params: {
        departmentId: v.restaurant,
        menus: [{ menuId: v.menus[menu], periodName }],
        menuItemIds: [menuItemId],
        needsManager: false,
      },
    },
  },
});
/** A kitchen ticket prints its time in the process's own time zone (`hhmm`, kitchen-ticket.ts). */
const ticketClock = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

async function editMealLine(v: Venue, id: string, patch: { quantity?: string; note?: string }) {
  const read = await sendAsTill(v, "GET", `/api/working-orders/${id}`);
  expect(read.status).toBe(200);
  const order = read.body as {
    revision: number;
    lines: {
      workingOrderLineId: string;
      menuItemId: string;
      quantity: string;
      note: string | null;
    }[];
  };
  return sendAsTill(v, "PUT", `/api/working-orders/${id}`, {
    revision: order.revision,
    lines: order.lines.map(({ workingOrderLineId, menuItemId, quantity, note }) => ({
      workingOrderLineId,
      menuItemId,
      quantity,
      ...(note === null ? {} : { note }),
      ...patch,
    })),
  });
}

const marksOf = (workingOrderId: string) =>
  suite.db
    .select({
      unitPriceGross: workingOrderLines.unitPriceGross,
      latePeriodName: workingLineContexts.latePeriodName,
      lateConfirmedBy: workingLineContexts.lateConfirmedBy,
    })
    .from(workingOrderLines)
    .innerJoin(
      workingLineContexts,
      eq(workingLineContexts.workingOrderLineId, workingOrderLines.id),
    )
    .where(eq(workingOrderLines.workingOrderId, workingOrderId));

describe("service periods gate only added dishes and added stored quantities", () => {
  it("after Lunch ends, a fresh Lunch line and a stored increase are both refused and nothing changes", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const before = await sendAsTill(v, "GET", `/api/working-orders/${held.id}`);
    at(mondayAt("14:05"));
    const lunchEnded = {
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      },
    };
    expect(await park(v, v.diningZone, v.toast.almuerzo)).toMatchObject(
      periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo),
    );
    const otherRoot = await park(v, v.diningZone, v.toast.desayunos);
    expect(otherRoot).toMatchObject({
      status: 400,
      body: { error: { code: "menu_period.not_running", params: { menuId: v.menus.Desayunos } } },
    });
    expect(await editMealLine(v, held.id, { quantity: "2" })).toEqual(lunchEnded);
    expect(await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
    expect((await editMealLine(v, held.id, { note: "No salt" })).status).toBe(200);
  });

  const savedTableDraft = async (v: Venue) => {
    await suite.db
      .update(departmentSalePolicies)
      .set({ orderStart: "table" })
      .where(eq(departmentSalePolicies.departmentId, v.restaurant));
    const { id: tableId } = await withTransaction(suite.db, (tx) =>
      createTable(tx, v.cfg, { label: "Late table", zoneId: v.diningZone }),
    );
    const seated = await sendAsTill(v, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
    expect(seated.status).toBe(200);
    const { partyId, tabId } = seated.body as { partyId: string; tabId: string };
    const saved = await sendAsTill(v, "PUT", `/api/parties/${partyId}/drafts`, {
      billId: tabId,
      personId: v.personId,
      draftId: null,
      revision: 0,
      lines: [
        {
          clientLineId: randomUUID(),
          menuItemId: v.toast.almuerzo,
          quantity: "1",
          menuVersionId: v.versions.Almuerzo,
        },
      ],
    });
    expect(saved.status).toBe(200);
    const { draft } = saved.body as {
      draft: { id: string; revision: number; lines: { id: string }[] };
    };
    const [party] = await suite.db
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    return {
      partyId,
      tabId,
      submitUrl: `/api/parties/${partyId}/drafts/${draft.id}/submit`,
      submit: (submissionId: string) => ({
        submissionId,
        draftRevision: draft.revision,
        expectedPartyRevision: party!.revision,
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
      }),
    };
  };

  it("a table draft saved during Lunch is refused at 14:05 and writes no line", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { tabId, submitUrl, submit } = await savedTableDraft(v);
    at(mondayAt("14:05"));
    const submitted = await sendAsTill(v, "POST", submitUrl, submit(randomUUID()));
    expect(submitted).toMatchObject(periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo));
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toEqual([]);
  });

  it("a table draft saved during Lunch is sent at 14:05 when the till confirms its menu, marked and fired", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { tabId, submitUrl, submit } = await savedTableDraft(v);
    at(mondayAt("14:05"));
    const submitted = await sendAsTill(v, "POST", submitUrl, {
      ...submit(randomUUID()),
      lateSend: { menuIds: [v.menus.Almuerzo] },
    });
    expect(submitted.status).toBe(200);
    expect((submitted.body as { groups: { state: string }[] }).groups).toMatchObject([
      { state: "fired" },
    ]);
    expect(await marksOf(tabId)).toEqual([
      { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: v.personId },
    ]);
  });

  it("a confirmed table draft submission replays its answer when retried without the confirmation", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { tabId, submitUrl, submit } = await savedTableDraft(v);
    at(mondayAt("14:05"));
    const body = submit(randomUUID());
    const submitted = await sendAsTill(v, "POST", submitUrl, {
      ...body,
      lateSend: { menuIds: [v.menus.Almuerzo] },
    });
    expect(submitted.status).toBe(200);
    expect(await sendAsTill(v, "POST", submitUrl, body)).toEqual(submitted);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toHaveLength(1);
  });

  it("a table's held group is sent at 14:05 when the till confirms its menu, marked and held", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { partyId, tabId } = await savedTableDraft(v);
    at(mondayAt("14:05"));
    const [party] = await suite.db
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    const submitted = await sendAsTill(v, "POST", `/api/parties/${partyId}/groups`, {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [{ lines: [{ menuItemId: v.toast.almuerzo, quantity: "1" }], release: "hold" }],
      lateSend: { menuIds: [v.menus.Almuerzo] },
    });
    expect(submitted.status).toBe(200);
    expect((submitted.body as { groups: { state: string }[] }).groups).toMatchObject([
      { state: "held" },
    ]);
    expect(await marksOf(tabId)).toEqual([
      { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: v.personId },
    ]);
  });

  it("a confirmed table group replays its answer when retried without the confirmation", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { partyId, tabId } = await savedTableDraft(v);
    at(mondayAt("14:05"));
    const [party] = await suite.db
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    const body = {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: party!.revision,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [{ lines: [{ menuItemId: v.toast.almuerzo, quantity: "1" }], release: "hold" }],
    };
    const url = `/api/parties/${partyId}/groups`;
    const submitted = await sendAsTill(v, "POST", url, {
      ...body,
      lateSend: { menuIds: [v.menus.Almuerzo] },
    });
    expect(submitted.status).toBe(200);
    expect(await sendAsTill(v, "POST", url, body)).toEqual(submitted);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toHaveLength(1);
  });

  it("a table draft sent during Lunch replays the same submission after Lunch ends", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const { tabId, submitUrl, submit } = await savedTableDraft(v);
    const body = submit(randomUUID());
    at(mondayAt("13:55"));
    const submitted = await sendAsTill(v, "POST", submitUrl, body);
    expect(submitted.status).toBe(200);
    at(mondayAt("14:05"));
    expect(await sendAsTill(v, "POST", submitUrl, body)).toEqual(submitted);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toHaveLength(1);
    expect(await sendAsTill(v, "POST", submitUrl, submit(randomUUID()))).toMatchObject({
      status: 409,
      body: { error: { code: "draft.out_of_date" } },
    });
  });

  it.each([
    ["13:45", true, true, true],
    ["14:00", false, false, false],
    ["14:05", false, false, false],
  ] as const)(
    "polling reports one window for orderable and sendable at %s",
    async (time, open, orderable, sendable) => {
      at(mondayAt("13:00"));
      const v = await mealVenue();
      at(mondayAt(time));
      const state = await sendAsTill(v, "GET", `/api/menu-state?zoneId=${v.barZone}`);
      expect(state.status).toBe(200);
      expect(state.body).toMatchObject({
        service: { open, periodName: open ? "Lunch" : null },
        menus: expect.arrayContaining([
          expect.objectContaining({
            menuId: v.menus.Almuerzo,
            versionId: v.versions.Almuerzo,
            orderable,
            sendable,
          }),
        ]),
      });
      const offers = await sendAsTill(v, "GET", `/api/service-zones/${v.barZone}/offers`);
      expect(offers.status).toBe(200);
      expect(offers.body).toMatchObject({
        menus: expect.arrayContaining([
          expect.objectContaining({ id: v.menus.Almuerzo, orderable, sendable }),
        ]),
      });
    },
  );

  it.each(["13:50", "17:00"])(
    "accepts Lunch only during its period at %s, preserving its published price",
    async (time) => {
      at(mondayAt(time));
      const v = await mealVenue();
      const held = await park(v, v.diningZone, v.toast.almuerzo, v.versions.Almuerzo);
      if (time === "17:00") {
        expect(held).toMatchObject(periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo));
        expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
        return;
      }
      expect(held.status).toBe(200);
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
        { unitPriceGross: 400, menuName: "Almuerzo", menuVersionId: v.versions.Almuerzo },
      ]);
    },
  );

  it("refuses a Dinner line before Dinner starts and writes no order", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.desayunos, v.versions.Desayunos);
    expect(held).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(
      await suite.db
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.id, held.id)),
    ).toEqual([]);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
  });

  it.each([
    ["2026-10-05T13:00:00+02:00", "Desayunos", "desayunos", [0, 1, 2, 3, 4, 5, 6], false],
    ["2026-10-04T13:00:00+02:00", "Almuerzo", "almuerzo", [1, 2, 3, 4, 5, 6], false],
    ["2026-10-05T14:00:00+02:00", "Almuerzo", "almuerzo", [1], true],
    ["2026-10-05T17:00:00+02:00", "Almuerzo", "almuerzo", [1], true],
  ] as const)(
    "at %s refuses %s outside its own period",
    async (instant, menu, item, weekdays, endedToday) => {
      at(new Date(instant));
      const v = await mealVenue(weekdays);
      const held = await park(v, v.diningZone, v.toast[item], v.versions[menu]);
      expect(held).toMatchObject(
        endedToday
          ? periodEnded(v, menu, "Lunch", v.toast[item])
          : {
              status: 400,
              body: {
                error: {
                  code: "menu_period.not_running",
                  params: { departmentId: v.restaurant, menuId: v.menus[menu] },
                },
              },
            },
      );
      expect(
        await suite.db
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(eq(workingOrders.id, held.id)),
      ).toEqual([]);
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
    },
  );

  it("accepts a stored Lunch quantity increase while Lunch runs, keeping its id and price", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    at(mondayAt("13:55"));
    expect((await editMealLine(v, held.id, { quantity: "2" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    const rows = await suite.db
      .select({ quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(rows).toEqual([{ quantity: 2000 }]);
  });

  it.each(["14:00", "14:05", "19:05"])(
    "refuses a stored Lunch quantity increase at %s without changing the order",
    async (time) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      const held = await park(v, v.diningZone, v.toast.almuerzo);
      expect(held.status).toBe(200);
      const before = await sendAsTill(v, "GET", `/api/working-orders/${held.id}`);
      at(mondayAt(time));
      expect(await editMealLine(v, held.id, { quantity: "2" })).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
          },
        },
      });
      expect(await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
    },
  );

  it("edits a stored Lunch note after Lunch ends, without repricing the dish", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    at(mondayAt("15:00"));
    expect((await editMealLine(v, held.id, { note: "No salt" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    const rows = await suite.db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(rows).toEqual([{ note: "No salt" }]);
  });

  it("refuses a new line on a business day when no period has run", async () => {
    at(new Date("2026-10-04T13:00:00+02:00"));
    const v = await mealVenue();
    expect(await park(v, v.diningZone, v.toast.almuerzo)).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      },
    });
  });

  it("uses one service resolution for repeated new lines", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const resolve = vi.spyOn(VENUE_SERVICE, "resolveDepartmentService");
    try {
      const id = randomUUID();
      expect(
        (
          await sendAsTill(v, "POST", "/api/working-orders", {
            id,
            zoneId: v.diningZone,
            lines: [1, 2, 3].map(() => ({ menuItemId: v.toast.almuerzo, quantity: "1" })),
          })
        ).status,
      ).toBe(200);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0]![2]).toBe(v.restaurant);
      expect(
        (await withTransaction(suite.db, (tx) => linesOf(tx, id))).map(
          (line) => line.unitPriceGross,
        ),
      ).toEqual([400, 400, 400]);
    } finally {
      resolve.mockRestore();
    }
  });

  it("refuses a future-period fresh line appended to a stored order without changing it", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const before = await sendAsTill(v, "GET", `/api/working-orders/${held.id}`);
    const order = before.body as {
      revision: number;
      lines: { workingOrderLineId: string; menuItemId: string; quantity: string }[];
    };
    expect(
      await sendAsTill(v, "PUT", `/api/working-orders/${held.id}`, {
        revision: order.revision,
        lines: [
          ...order.lines.map(({ workingOrderLineId, menuItemId, quantity }) => ({
            workingOrderLineId,
            menuItemId,
            quantity,
          })),
          { menuItemId: v.toast.desayunos, quantity: "1" },
        ],
      }),
    ).toEqual({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
  });

  it("refuses a future-period direct sale before storing an order", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    const id = randomUUID();
    expect(
      await sendAsTill(v, "POST", "/api/sales", {
        id,
        zoneId: v.diningZone,
        lines: [{ menuItemId: v.toast.desayunos, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      }),
    ).toEqual({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
        },
      },
    });
    expect(
      await suite.db
        .select({ id: workingOrders.id })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    ).toEqual([]);
  });

  it("keeps Lunch quantity decreases and notes editable when its timetable is cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    expect((await editMealLine(v, held.id, { quantity: "2" })).status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
        0,
      ),
    );
    at(mondayAt("15:00"));
    expect((await editMealLine(v, held.id, { quantity: "1", note: "No salt" })).status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual(before);
    expect(
      await suite.db
        .select({ quantity: workingOrderLines.quantity, note: workingOrderLines.note })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, held.id)),
    ).toEqual([{ quantity: 1000, note: "No salt" }]);
  });

  it.each(["13:00", "17:00"])("gates a period's staff menu at %s", async (time) => {
    at(mondayAt(time));
    const v = await mealVenue();
    const read = await sendAsTill(v, "GET", `/api/service-zones/${v.diningZone}/offers`);
    const offers = read.body.offers as { id: string; menuId: string }[];
    const water = offers.find((offer) => offer.menuId === v.menus.Bebidas)!;
    const held = await park(v, v.diningZone, water.id);
    if (time === "17:00") {
      expect(held).toMatchObject(periodEnded(v, "Bebidas", "Lunch", water.id));
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toEqual([]);
      return;
    }
    expect(held.status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
      { menuName: "Bebidas", unitPriceGross: 200 },
    ]);
  });

  it("accepts all period menus when the location clock cannot be read", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    await suite.db
      .update(locations)
      .set({ timeZone: "Unreadable/Zone" })
      .where(eq(locations.id, v.cfg.locationId));
    const held = await park(v, v.diningZone, v.toast.desayunos);
    expect(held.status).toBe(200);
    expect(await withTransaction(suite.db, (tx) => linesOf(tx, held.id))).toMatchObject([
      { menuName: "Desayunos", unitPriceGross: 250 },
    ]);
  });

  it.each(["fired", "adjusted"] as const)(
    "refuses more of a %s Lunch line after Lunch ends",
    async (kind) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      let id: string;
      let path: string;
      if (kind === "fired") {
        await suite.db
          .update(departmentSalePolicies)
          .set({ orderStart: "table" })
          .where(eq(departmentSalePolicies.departmentId, v.restaurant));
        const { id: tableId } = await withTransaction(suite.db, (tx) =>
          createTable(tx, v.cfg, { label: "Fired meal table", zoneId: v.diningZone }),
        );
        const seated = await sendAsTill(v, "POST", `/api/tables/${tableId}/seat`, {
          guestCount: 2,
        });
        expect(seated.status).toBe(200);
        const { partyId, tabId, revision } = seated.body as {
          partyId: string;
          tabId: string;
          revision: number;
        };
        const saved = await sendAsTill(v, "PUT", `/api/parties/${partyId}/drafts`, {
          billId: tabId,
          personId: v.personId,
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.toast.almuerzo, quantity: "1" }],
        });
        expect(saved.status).toBe(200);
        const { draft } = saved.body as {
          draft: { id: string; revision: number; lines: { id: string }[] };
        };
        const sent = await sendAsTill(
          v,
          "POST",
          `/api/parties/${partyId}/drafts/${draft.id}/submit`,
          {
            submissionId: randomUUID(),
            draftRevision: draft.revision,
            expectedPartyRevision: revision,
            allergy: { party: { answer: "none", guests: [] }, ticks: [] },
            groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
          },
        );
        expect(sent.status).toBe(200);
        id = tabId;
        path = `/api/working-orders/${id}/lines`;
        expect(
          await suite.db
            .select({ sentAt: workingOrderLines.sentAt })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, id)),
        ).toEqual([{ sentAt: mondayAt("13:50").toISOString() }]);
      } else {
        const held = await park(v, v.diningZone, v.toast.almuerzo);
        expect(held.status).toBe(200);
        id = held.id;
        await suite.db
          .update(workingOrderLines)
          .set({ listUnitPriceGross: 400 })
          .where(eq(workingOrderLines.workingOrderId, id));
        path = `/api/working-orders/${id}`;
      }
      const before = await sendAsTill(v, "GET", path);
      expect(before.status).toBe(200);
      at(mondayAt("14:05"));
      expect(
        await sendAsTill(v, "PUT", `/api/working-orders/${id}/lines/1`, {
          revision: before.body.revision,
          quantity: "2",
        }),
      ).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
          },
        },
      });
      expect(await sendAsTill(v, "GET", path)).toEqual(before);
    },
  );

  it.each(["lunch", "dinner"] as const)(
    "retains a %s draft after Lunch ends and gates its submission",
    async (meal) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      await suite.db
        .update(departmentSalePolicies)
        .set({ orderStart: "table" })
        .where(eq(departmentSalePolicies.departmentId, v.restaurant));
      const { id: tableId } = await withTransaction(suite.db, (tx) =>
        createTable(tx, v.cfg, { label: "Meal table", zoneId: v.diningZone }),
      );
      const seated = await sendAsTill(v, "POST", `/api/tables/${tableId}/seat`, { guestCount: 2 });
      expect(seated.status).toBe(200);
      const { partyId, tabId } = seated.body as { partyId: string; tabId: string };
      const menuItemId = meal === "lunch" ? v.toast.almuerzo : v.toast.desayunos;
      const saved = await sendAsTill(v, "PUT", `/api/parties/${partyId}/drafts`, {
        billId: tabId,
        personId: v.personId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId, quantity: "1" }],
      });
      expect(saved.status).toBe(200);
      const { draft } = saved.body as {
        draft: { id: string; revision: number; lines: { id: string }[] };
      };
      at(mondayAt("17:00"));
      const read = await sendAsTill(v, "GET", `/api/parties/${partyId}/drafts`);
      expect(read.status).toBe(200);
      expect(read.body).toEqual({ drafts: [draft], billEdits: [saved.body.edit] });
      expect(draft).toMatchObject({
        lines: [{ menuItemId, quantity: "1.000", unavailable: false }],
      });
      const [party] = await suite.db
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId));
      const submitted = await sendAsTill(
        v,
        "POST",
        `/api/parties/${partyId}/drafts/${draft.id}/submit`,
        {
          submissionId: randomUUID(),
          draftRevision: draft.revision,
          expectedPartyRevision: party!.revision,
          allergy: { party: { answer: "none", guests: [] }, ticks: [] },
          groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
        },
      );
      expect(submitted).toEqual(
        meal === "lunch"
          ? periodEnded(v, "Almuerzo", "Lunch", menuItemId)
          : {
              status: 400,
              body: {
                error: {
                  code: "menu_period.not_running",
                  params: { departmentId: v.restaurant, menuId: v.menus.Desayunos },
                },
              },
            },
      );
      expect(await sendAsTill(v, "GET", `/api/parties/${partyId}/drafts`)).toEqual(read);
      expect(await withTransaction(suite.db, (tx) => linesOf(tx, tabId))).toEqual([]);
    },
  );

  it("adds an extra to a stored Lunch dish after all its periods are cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const read = await sendAsTill(v, "GET", `/api/service-zones/${v.diningZone}/offers`);
    const dish = (read.body.offers as { id: string; productId: string }[]).find(
      (offer) => offer.id === v.toast.almuerzo,
    )!;
    const { extraId, listId } = await withTransaction(suite.db, async (tx) => {
      const extra = await createProduct(tx, {
        catalogueId: v.menus.Almuerzo,
        categoryId: null,
        name: "Butter",
        pricingUnit: "each",
        unitPrice: "0.50",
        vatClass: "general",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Spreads",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: extra.id, maxQuantity: 1, preselected: false, price: "0.50" }],
        },
        SIGNED_IN_TILL_LOCALE,
      );
      await writeProductModifiers(tx, dish.productId, [{ kind: "extras", id: list.id }]);
      await publishWorkingMenu(tx, v.menus.Almuerzo);
      return { extraId: extra.id, listId: list.id };
    });
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const before = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
        0,
      ),
    );
    at(mondayAt("15:00"));
    expect(
      (
        await sendAsTill(v, "PUT", `/api/working-orders/${held.id}/lines/1`, {
          revision: 0,
          extras: [{ listId, picks: [{ productId: extraId, quantity: 1 }] }],
        })
      ).status,
    ).toBe(200);
    const after = await suite.db
      .select({
        id: workingOrderLines.id,
        parentLineId: workingOrderLines.parentLineId,
        productId: workingOrderLines.productId,
        unitPriceGross: workingOrderLines.unitPriceGross,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, held.id));
    expect(after).toEqual(
      expect.arrayContaining([
        { id: before[0]!.id, parentLineId: null, productId: dish.productId, unitPriceGross: 400 },
        {
          id: expect.any(String),
          parentLineId: before[0]!.id,
          productId: extraId,
          unitPriceGross: 50,
        },
      ]),
    );
    expect(after).toHaveLength(2);
  });

  it("previews routing of an unchanged stored line when its periods have been cleared", async () => {
    at(mondayAt("13:50"));
    const v = await mealVenue();
    const held = await park(v, v.diningZone, v.toast.almuerzo);
    expect(held.status).toBe(200);
    const [line] = await withTransaction(suite.db, (tx) => linesOf(tx, held.id));
    await withTransaction(suite.db, (tx) =>
      replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: [] })),
        MONDAY_10_00,
        0,
      ),
    );
    at(mondayAt("15:00"));
    const before = await sendAsTill(v, "GET", `/api/working-orders/${held.id}`);
    expect(
      await sendAsTill(v, "POST", "/api/dead-ends/sale", {
        workingOrderId: held.id,
        step: "edit",
        lines: [{ workingOrderLineId: line!.id, menuItemId: v.toast.almuerzo, quantity: "1" }],
      }),
    ).toMatchObject({ status: 200, body: { sends: true, deadEnds: [] } });
    expect(await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
  });

  it("keeps the zone refusal for an item on no period's menu", async () => {
    at(mondayAt("13:00"));
    const v = await mealVenue();
    expect(await park(v, v.diningZone, v.sandwich)).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "service_zone.offer_not_allowed",
          params: { zoneId: v.diningZone, menuItemId: v.sandwich },
        },
      },
    });
  });
});

describe("a dish whose period ended earlier today", () => {
  const parkWith = (
    v: Venue,
    menuItemId: string,
    extra: Record<string, unknown>,
    id = randomUUID(),
  ) =>
    sendAsTill(v, "POST", "/api/working-orders", {
      id,
      zoneId: v.diningZone,
      lines: [{ menuItemId, quantity: "1" }],
      ...extra,
    }).then((answer) => ({ ...answer, id }));
  const orderRows = (id: string) =>
    suite.db.select({ id: workingOrders.id }).from(workingOrders).where(eq(workingOrders.id, id));

  it("is refused unconfirmed at 14:05 and writes no order", async () => {
    at(mondayAt("14:05"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, {});
    expect(held).toMatchObject(periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo));
    expect(await orderRows(held.id)).toEqual([]);
  });

  it("is parked at 14:05 when the till confirms its menu, priced as published and marked by the signed-in person", async () => {
    at(mondayAt("14:05"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, { lateSend: { menuIds: [v.menus.Almuerzo] } });
    expect(held.status).toBe(200);
    expect(await marksOf(held.id)).toEqual([
      { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: v.personId },
    ]);
  });

  it("is refused when the confirmation names another menu, naming Almuerzo, and writes no order", async () => {
    at(mondayAt("14:05"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, { lateSend: { menuIds: [v.menus.Bebidas] } });
    expect(held).toMatchObject(periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo));
    expect(await orderRows(held.id)).toEqual([]);
  });

  it("is refused not_running the next morning, even confirmed, and writes no order", async () => {
    at(new Date("2026-10-06T10:00:00+02:00"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, { lateSend: { menuIds: [v.menus.Almuerzo] } });
    expect(held).toMatchObject({
      status: 400,
      body: {
        error: {
          code: "menu_period.not_running",
          params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
        },
      },
    });
    expect(await orderRows(held.id)).toEqual([]);
  });

  it.each(["19:00", "19:30"])(
    "is parked at %s at its own 4.00, unmarked and unconfirmed, while Dinner sells the Tostada",
    async (time) => {
      at(mondayAt(time));
      const v = await mealVenue();
      const held = await parkWith(v, v.toast.almuerzo, {});
      expect(held.status).toBe(200);
      expect(await marksOf(held.id)).toEqual([
        { unitPriceGross: 400, latePeriodName: null, lateConfirmedBy: null },
      ]);
    },
  );

  it.each([
    ["null", null],
    ["an empty menu list", { menuIds: [] }],
    ["a menu id that is not a UUID", { menuIds: ["not-a-uuid"] }],
    ["an array", []],
  ] as const)("refuses a lateSend that is %s and writes no order", async (_shape, lateSend) => {
    at(mondayAt("14:05"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, { lateSend });
    expect(held).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "lateSend" } } },
    });
    expect(await orderRows(held.id)).toEqual([]);
  });

  it("replays a retried confirmed park with the same body", async () => {
    at(mondayAt("14:05"));
    const v = await mealVenue();
    const body = { lateSend: { menuIds: [v.menus.Almuerzo] } };
    const first = await parkWith(v, v.toast.almuerzo, body);
    expect(first.status).toBe(200);
    const retried = await parkWith(v, v.toast.almuerzo, body, first.id);
    expect(retried).toMatchObject({ status: 200, body: first.body });
    expect(retried.body).toEqual({ id: first.id, orderNumber: expect.any(Number) });
    expect(await marksOf(first.id)).toHaveLength(1);
  });

  it("accepts a confirmation at 19:00 when nothing is late, unmarked", async () => {
    at(mondayAt("19:00"));
    const v = await mealVenue();
    const held = await parkWith(v, v.toast.almuerzo, { lateSend: { menuIds: [v.menus.Almuerzo] } });
    expect(held.status).toBe(200);
    expect(await marksOf(held.id)).toEqual([
      { unitPriceGross: 400, latePeriodName: null, lateConfirmedBy: null },
    ]);
  });

  describe("on a counter sale", () => {
    const counterVenue = async () => {
      at(mondayAt("14:05"));
      return mealVenue([1], true);
    };
    const toast = (v: Venue) => [{ menuItemId: v.toast.almuerzo, quantity: "1" }];
    const cashSale = (v: Venue, id: string, extra: Record<string, unknown>) =>
      sendAsTill(v, "POST", "/api/sales", {
        workingOrderId: id,
        zoneId: v.diningZone,
        lines: toast(v),
        tender: { method: "cash", amount: "5.00" },
        ...extra,
      });
    const cardSale = (v: Venue, id: string, extra: Record<string, unknown>) =>
      sendAsTill(v, "POST", "/api/pay", {
        id,
        zoneId: v.diningZone,
        lines: toast(v),
        simulationOutcome: "captured",
        ...extra,
      });
    const filingRows = async () => (await suite.db.select().from(registrosFacturacion)).length;

    it("refuses an unconfirmed cash sale at 14:05 and writes no order", async () => {
      const v = await counterVenue();
      const id = randomUUID();
      const filed = await filingRows();
      expect(await cashSale(v, id, {})).toMatchObject(
        periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo),
      );
      expect(await orderRows(id)).toEqual([]);
      expect(await filingRows()).toBe(filed);
    });

    it("takes a confirmed cash sale at 14:05 at its published 4.00, marked by the signed-in person", async () => {
      const v = await counterVenue();
      const id = randomUUID();
      const paid = await cashSale(v, id, { lateSend: { menuIds: [v.menus.Almuerzo] } });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({
        total: "4.00",
        tender: { method: "cash", change: "1.00" },
      });
      expect(await marksOf(id)).toEqual([
        { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: v.personId },
      ]);
    });

    it("refuses an unconfirmed simulator card pay at 14:05 and writes no order", async () => {
      const v = await counterVenue();
      const id = randomUUID();
      const filed = await filingRows();
      expect(await cardSale(v, id, {})).toMatchObject(
        periodEnded(v, "Almuerzo", "Lunch", v.toast.almuerzo),
      );
      expect(await orderRows(id)).toEqual([]);
      expect(await filingRows()).toBe(filed);
    });

    it("takes a confirmed simulator card pay at 14:05 at its published 4.00, marked by the signed-in person", async () => {
      const v = await counterVenue();
      const id = randomUUID();
      const paid = await cardSale(v, id, { lateSend: { menuIds: [v.menus.Almuerzo] } });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ outcome: "captured", ticket: { total: "4.00" } });
      expect(await marksOf(id)).toEqual([
        { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: v.personId },
      ]);
    });

    it.each(["/api/sales", "/api/pay"])(
      "refuses %s with a lateSend that is null and writes no order",
      async (path) => {
        const v = await counterVenue();
        const id = randomUUID();
        const sent = path === "/api/sales" ? cashSale : cardSale;
        expect(await sent(v, id, { lateSend: null })).toMatchObject({
          status: 400,
          body: { error: { code: "management.request_invalid", params: { field: "lateSend" } } },
        });
        expect(await orderRows(id)).toEqual([]);
      },
    );
  });

  describe("when the restaurant asks for a manager", () => {
    const managerVenue = async (time: string) => {
      at(mondayAt(time));
      const v = await mealVenue();
      await withTransaction(suite.db, (tx) =>
        updateDepartment(tx, v.cfg, v.restaurant, { lateSendNeedsManager: true }),
      );
      const [manager] = await suite.db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.displayName, "Administradora"));
      return { v, manager: manager!.id };
    };
    /** The same till signed in as `personId`, keeping its device cookie. */
    const signedInAs = async (v: Venue, personId: string, pin: string): Promise<Venue> => {
      const [, devicePart] = v.cookie.split("; ");
      const deviceId = devicePart!.split("=")[1]!.split(".")[0]!;
      const session = await withTransaction(suite.db, (tx) =>
        loginWithPin(tx, { deviceId, personId, pin }),
      );
      return { ...v, cookie: `${SESSION_COOKIE}=${session.token}; ${devicePart}` };
    };

    it("names needsManager in the refusal of an unconfirmed dish", async () => {
      const { v } = await managerVenue("14:05");
      const held = await parkWith(v, v.toast.almuerzo, {});
      expect(held).toMatchObject({
        status: 409,
        body: { error: { code: "menu_period.ended", params: { needsManager: true } } },
      });
      expect(await orderRows(held.id)).toEqual([]);
    });

    it("refuses a staff confirmation with no manager override and writes no order", async () => {
      const { v } = await managerVenue("14:05");
      const held = await parkWith(v, v.toast.almuerzo, {
        lateSend: { menuIds: [v.menus.Almuerzo] },
      });
      expect(held).toMatchObject({
        status: 403,
        body: { error: { code: "authorization.not_permitted" } },
      });
      expect(await orderRows(held.id)).toEqual([]);
    });

    it("throttles wrong manager PINs for a late send on the same device", async () => {
      const { v, manager } = await managerVenue("14:05");
      for (let i = 0; i < 4; i++) {
        const held = await parkWith(v, v.toast.almuerzo, {
          lateSend: { menuIds: [v.menus.Almuerzo], override: { personId: manager, pin: "9999" } },
        });
        expect(held.status).toBe(401);
        expect(held.body).toMatchObject({ error: { code: "pin.invalid" } });
        expect(await orderRows(held.id)).toEqual([]);
      }
      const held = await parkWith(v, v.toast.almuerzo, {
        lateSend: { menuIds: [v.menus.Almuerzo], override: { personId: manager, pin: "1234" } },
      });
      expect(held.status).toBe(429);
      expect(held.body).toMatchObject({ error: { code: "pin.throttled" } });
      expect(await orderRows(held.id)).toEqual([]);
    });

    it("parks with the manager's PIN, marked as confirmed by the manager", async () => {
      const { v, manager } = await managerVenue("14:05");
      const held = await parkWith(v, v.toast.almuerzo, {
        lateSend: { menuIds: [v.menus.Almuerzo], override: { personId: manager, pin: "1234" } },
      });
      expect(held.status).toBe(200);
      expect(await marksOf(held.id)).toEqual([
        { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: manager },
      ]);
    });

    it("parks for a signed-in manager with no override, marked as confirmed by the manager", async () => {
      const { v, manager } = await managerVenue("14:05");
      const asManager = await signedInAs(v, manager, "1234");
      const held = await parkWith(asManager, v.toast.almuerzo, {
        lateSend: { menuIds: [v.menus.Almuerzo] },
      });
      expect(held.status).toBe(200);
      expect(await marksOf(held.id)).toEqual([
        { unitPriceGross: 400, latePeriodName: "Lunch", lateConfirmedBy: manager },
      ]);
    });

    it("counts a wrong manager PIN sent when nothing is late, while still parking the order", async () => {
      const { v, manager } = await managerVenue("19:00");
      for (let i = 0; i < 4; i++) {
        const held = await parkWith(v, v.toast.almuerzo, {
          lateSend: { menuIds: [v.menus.Almuerzo], override: { personId: manager, pin: "9999" } },
        });
        expect(held.status).toBe(200);
        expect(await marksOf(held.id)).toEqual([
          { unitPriceGross: 400, latePeriodName: null, lateConfirmedBy: null },
        ]);
      }
      at(mondayAt("14:05"));
      const late = await parkWith(v, v.toast.almuerzo, {
        lateSend: { menuIds: [v.menus.Almuerzo], override: { personId: manager, pin: "1234" } },
      });
      expect(late.status).toBe(429);
      expect(late.body).toMatchObject({ error: { code: "pin.throttled" } });
      expect(await orderRows(late.id)).toEqual([]);
    });
  });

  describe("a held order's save", () => {
    /** A Lunch Tostada parked at 13:50, then at 14:05 the save of `lines` beside the stored one. */
    const saveAfterLunch = async (
      storedQuantity: string,
      confirmed: boolean,
      managerPin?: string,
    ) => {
      at(mondayAt("13:50"));
      const v = await mealVenue();
      let override: { personId: string; pin: string } | undefined;
      if (managerPin !== undefined) {
        await withTransaction(suite.db, (tx) =>
          updateDepartment(tx, v.cfg, v.restaurant, { lateSendNeedsManager: true }),
        );
        const [manager] = await suite.db
          .select({ id: persons.id })
          .from(persons)
          .where(eq(persons.displayName, "Administradora"));
        override = { personId: manager!.id, pin: managerPin };
      }
      const held = await park(v, v.diningZone, v.toast.almuerzo);
      expect(held.status).toBe(200);
      const before = await sendAsTill(v, "GET", `/api/working-orders/${held.id}`);
      const order = before.body as {
        revision: number;
        lines: { workingOrderLineId: string; menuItemId: string }[];
      };
      at(mondayAt("14:05"));
      const saved = await sendAsTill(v, "PUT", `/api/working-orders/${held.id}`, {
        revision: order.revision,
        lines: [
          {
            workingOrderLineId: order.lines[0]!.workingOrderLineId,
            menuItemId: order.lines[0]!.menuItemId,
            quantity: storedQuantity,
          },
          { menuItemId: v.toast.almuerzo, quantity: "1" },
        ],
        ...(confirmed ? { lateSend: { menuIds: [v.menus.Almuerzo], override } } : {}),
      });
      return {
        v,
        held,
        before,
        saved,
        storedLineId: order.lines[0]!.workingOrderLineId,
        manager: override?.personId,
      };
    };
    const lineMarks = (workingOrderId: string) =>
      suite.db
        .select({
          id: workingOrderLines.id,
          quantity: workingOrderLines.quantity,
          latePeriodName: workingLineContexts.latePeriodName,
          lateConfirmedBy: workingLineContexts.lateConfirmedBy,
        })
        .from(workingOrderLines)
        .innerJoin(
          workingLineContexts,
          eq(workingLineContexts.workingOrderLineId, workingOrderLines.id),
        )
        .where(eq(workingOrderLines.workingOrderId, workingOrderId));

    it("at 14:05 with a fresh Lunch dish and a confirmation marks only the new line", async () => {
      const { v, held, saved, storedLineId } = await saveAfterLunch("1", true);
      expect(saved.status).toBe(200);
      const rows = await lineMarks(held.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === storedLineId)).toEqual({
        id: storedLineId,
        quantity: 1000,
        latePeriodName: null,
        lateConfirmedBy: null,
      });
      expect(rows.find((row) => row.id !== storedLineId)).toMatchObject({
        quantity: 1000,
        latePeriodName: "Lunch",
        lateConfirmedBy: v.personId,
      });
    });

    it("at 14:05 with a fresh Lunch dish, where the restaurant asks for a manager, marks the new line confirmed by the manager whose PIN was sent", async () => {
      const { v, held, saved, storedLineId, manager } = await saveAfterLunch("1", true, "1234");
      expect(saved.status).toBe(200);
      expect(manager).not.toBe(v.personId);
      const rows = await lineMarks(held.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === storedLineId)).toMatchObject({
        latePeriodName: null,
        lateConfirmedBy: null,
      });
      expect(rows.find((row) => row.id !== storedLineId)).toMatchObject({
        quantity: 1000,
        latePeriodName: "Lunch",
        lateConfirmedBy: manager,
      });
    });

    it("at 14:05 that also raises the stored Lunch line is refused not_running even confirmed, and changes nothing", async () => {
      const { v, held, before, saved } = await saveAfterLunch("2", true);
      expect(saved).toEqual({
        status: 400,
        body: {
          error: {
            code: "menu_period.not_running",
            params: { departmentId: v.restaurant, menuId: v.menus.Almuerzo },
          },
        },
      });
      expect(await sendAsTill(v, "GET", `/api/working-orders/${held.id}`)).toEqual(before);
      expect(await lineMarks(held.id)).toHaveLength(1);
    });
  });
});

describe("GET /api/menu-state", () => {
  const defaultMenu = async (v: Venue, query: string) => {
    const answer = await sendAsTill(v, "GET", `/api/menu-state${query}`);
    expect(answer.status).toBe(200);
    return answer.body.defaultMenuId;
  };

  it("names the zone's default menu at the moment it is read", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    expect(await defaultMenu(v, `?zoneId=${v.barZone}`)).toBe(v.menus.Desayunos);
    expect(await defaultMenu(v, `?zoneId=${v.diningZone}`)).toBe(v.menus.Desayunos);
    vi.setSystemTime(MONDAY_12_30);
    expect(await defaultMenu(v, `?zoneId=${v.barZone}`)).toBe(v.menus.Almuerzo);
  });

  it("names the starting zone's default when no zone is asked for", async () => {
    const v = await setupVenue({ timetable: true });
    at(MONDAY_10_00);
    expect(await defaultMenu(v, "")).toBe(v.menus.Desayunos);
  });
});

describe("menu-state follows department service periods", () => {
  const setupPeriods = async () => {
    const v = await setupVenue({ timetable: true });
    await withTransaction(suite.db, async (tx) => {
      const lunch = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Lunch",
        menuId: v.menus.Almuerzo,
        staffMenuIds: [v.menus.Bebidas],
      });
      const afternoon = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Afternoon",
        menuId: v.menus["Café"],
        staffMenuIds: [],
      });
      const night = await saveMenuPeriod(tx, v.cfg, v.restaurant, {
        name: "Night",
        menuId: v.menus.Desayunos,
        staffMenuIds: [],
      });
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots: [
            slot(lunch.id, "12:00", "14:00"),
            slot(afternoon.id, "14:00", "19:00"),
            slot(night.id, "21:00", "03:00"),
          ],
        })),
        MONDAY_10_00,
        0,
      );
    });
    return v;
  };

  it.each([
    ["2026-10-09T11:59:00Z", "Lunch", "Almuerzo"],
    ["2026-10-09T12:00:00Z", "Afternoon", "Café"],
    ["2026-10-10T00:30:00Z", "Night", "Desayunos"],
  ] as const)("reports the running department period at %s", async (instant, periodName, menu) => {
    const v = await setupPeriods();
    at(new Date(instant));
    for (const query of ["", `?zoneId=${v.barZone}`, `?zoneId=${v.diningZone}`]) {
      const answer = await sendAsTill(v, "GET", `/api/menu-state${query}`);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        defaultMenuId: v.menus[menu],
        service: { open: true, periodName },
        menus: expect.arrayContaining([
          { menuId: v.menus[menu], versionId: v.versions[menu], orderable: true, sendable: true },
        ]),
        unavailable: { products: [], optionLabels: [] },
      });
    }
  });

  it("reports a closed department without choosing an all-day default", async () => {
    const v = await setupPeriods();
    at(new Date("2026-10-09T18:00:00Z"));
    const answer = await sendAsTill(v, "GET", `/api/menu-state?zoneId=${v.barZone}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: null,
      service: { open: false, zoneOpen: true, periodName: null, periodOccurrenceKey: null },
    });
    expect(answer.body.menus).toEqual([
      { menuId: v.menus["Café"], versionId: v.versions["Café"], orderable: false, sendable: false },
      {
        menuId: v.menus.Almuerzo,
        versionId: v.versions.Almuerzo,
        orderable: false,
        sendable: false,
      },
      {
        menuId: v.menus.Desayunos,
        versionId: v.versions.Desayunos,
        orderable: false,
        sendable: false,
      },
      { menuId: v.menus.Bebidas, versionId: v.versions.Bebidas, orderable: false, sendable: false },
    ]);
  });
  it.each([
    ["2026-10-09T11:59:00Z", "Almuerzo", "Bebidas", "Lunch"],
    ["2026-10-09T12:00:00Z", "Café", null, "Afternoon"],
  ] as const)(
    "never falls back to another period after %s loses its customer menu",
    async (instant, inactive, fallback, periodName) => {
      const v = await setupPeriods();
      await withTransaction(suite.db, (tx) => deactivateCatalogue(tx, v.menus[inactive]));
      at(new Date(instant));
      const answer = await sendAsTill(v, "GET", `/api/menu-state?zoneId=${v.diningZone}`);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({
        defaultMenuId: fallback === null ? null : v.menus[fallback],
        service: { open: true, periodName },
      });
    },
  );

  it("reports open service when the location clock cannot be read", async () => {
    const v = await setupPeriods();
    await suite.db
      .update(locations)
      .set({ timeZone: "not/a-zone" })
      .where(eq(locations.id, v.cfg.locationId));
    at(new Date("2026-10-09T18:00:00Z"));
    const answer = await sendAsTill(v, "GET", `/api/menu-state?zoneId=${v.diningZone}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      defaultMenuId: null,
      service: { open: true, zoneOpen: true, periodName: null, periodOccurrenceKey: null },
    });
  });
});

describe("kitchen routing follows the period running when a dish goes on the order", () => {
  /** Cocktails' Every zone cell: Upstairs bar; Lunch (12:00–14:00) → Downstairs bar; Afternoon
   * (14:00–19:00) has no line. Each station has its own printer. */
  async function cocktailVenue() {
    const v = await mealVenue();
    await suite.db
      .update(departmentSalePolicies)
      .set({ orderStart: "table" })
      .where(eq(departmentSalePolicies.departmentId, v.restaurant));
    const setup = await withTransaction(suite.db, async (tx) => {
      const periods = await tx
        .select()
        .from(menuPeriods)
        .where(eq(menuPeriods.departmentId, v.restaurant));
      const lunch = periods.find((period) => period.name === "Lunch")!;
      const dinner = periods.find((period) => period.name === "Dinner")!;
      const afternoon = (
        await saveMenuPeriod(tx, v.cfg, v.restaurant, {
          name: "Afternoon",
          menuId: v.menus.Bebidas,
          staffMenuIds: [],
        })
      ).id;
      await replaceMenuWeek(
        tx,
        v.cfg,
        v.restaurant,
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          slots:
            weekday === 1
              ? [
                  slot(lunch.id, "12:00", "14:00"),
                  slot(afternoon, "14:00", "19:00"),
                  slot(dinner.id, "19:00", "23:00"),
                ]
              : [],
        })),
        MONDAY_10_00,
        0,
      );
      const cocktails = (await createCategory(tx, { name: "Cocktails" })).id;
      const mojito = await createProduct(tx, {
        catalogueId: v.menus.Almuerzo,
        categoryId: cocktails,
        name: "Mojito",
        pricingUnit: "each",
        unitPrice: "8.00",
        vatClass: "general",
      });
      const offer = (await addProductToMenu(tx, { menuId: v.menus.Almuerzo, productId: mojito.id }))
        .id;
      await publishWorkingMenu(tx, v.menus.Almuerzo);
      const stationWithPrinter = async (name: string) => {
        const stationId = (await createStation(tx, v.cfg, { name })).id;
        const printerId = (
          await createPrinter(
            tx,
            { locationId: v.cfg.locationId },
            { name: `${name} printer`, transport: "cloud_poll", pollId: randomUUID() },
          )
        ).id;
        await attachPrinterToStation(tx, { locationId: v.cfg.locationId, stationId, printerId });
        return { stationId, printerId };
      };
      const upstairs = await stationWithPrinter("Upstairs bar");
      const downstairs = await stationWithPrinter("Downstairs bar");
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "category", categoryId: cocktails }, zoneId: null },
        { kind: "station", stationId: upstairs.stationId },
      );
      const [cell] = await tx
        .select({ id: routingCells.id })
        .from(routingCells)
        .where(eq(routingCells.categoryId, cocktails));
      await tx.insert(routingCellPeriods).values({
        cellId: cell!.id,
        periodId: lunch.id,
        departmentId: v.restaurant,
        stationId: downstairs.stationId,
      });
      const table = await createTable(tx, v.cfg, { label: "Cocktail table", zoneId: v.diningZone });
      return { offer, upstairs, downstairs, tableId: table.id };
    });
    const seated = await sendAsTill(v, "POST", `/api/tables/${setup.tableId}/seat`, {
      guestCount: 2,
    });
    expect(seated.status).toBe(200);
    const { partyId, tabId } = seated.body as { partyId: string; tabId: string };
    return { v, ...setup, partyId, tabId };
  }

  const partyRevision = async (partyId: string) =>
    (
      await suite.db
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId))
    )[0]!.revision;

  const stationOf = async (lineId: string) =>
    (
      await suite.db
        .select({ stationId: ticketItems.stationId, firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, lineId))
    )[0];

  const printed = async (printerId: string) =>
    (
      await suite.db
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
    ).map((job) => decodeTicket(job.payload));

  it("makes a cocktail sent during Lunch Downstairs, and keeps one sent held in Lunch there when released after Lunch", async () => {
    at(mondayAt("13:00"));
    const c = await cocktailVenue();
    const submit = async (release: "fire" | "hold") => {
      const answer = await sendAsTill(c.v, "POST", `/api/parties/${c.partyId}/groups`, {
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, c.tabId)),
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(c.partyId),
        allergy: { party: { answer: "none", guests: [] }, ticks: [] },
        groups: [{ lines: [{ menuItemId: c.offer, quantity: "1" }], release }],
      });
      expect(answer.status).toBe(200);
      return (answer.body as { groups: { id: string; lineIds: string[] }[] }).groups[0]!;
    };

    const fired = await submit("fire");
    expect(await stationOf(fired.lineIds[0]!)).toMatchObject({
      stationId: c.downstairs.stationId,
    });

    expect(await printed(c.downstairs.printerId)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Downstairs bar\\n[^]*\\n${ticketClock(mondayAt("13:00"))}\\nGROUP 1\\n1\\.000 x Mojito\\n$`,
        ),
      ),
    ]);

    at(mondayAt("13:55"));
    const held = await submit("hold");
    expect(await stationOf(held.lineIds[0]!)).toEqual({
      stationId: c.downstairs.stationId,
      firedAt: null,
    });

    at(mondayAt("14:10"));
    const before = (await printed(c.downstairs.printerId)).length;
    const released = await sendAsTill(
      c.v,
      "POST",
      `/api/parties/${c.partyId}/groups/${held.id}/fire`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(c.partyId),
      },
    );
    expect(released.status).toBe(200);
    expect(await stationOf(held.lineIds[0]!)).toEqual({
      stationId: c.downstairs.stationId,
      firedAt: mondayAt("14:10").toISOString(),
    });
    expect((await printed(c.downstairs.printerId)).slice(before)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Downstairs bar\\n[^]*\\n${ticketClock(mondayAt("14:10"))}\\nGROUP 2\\n1\\.000 x Mojito\\n$`,
        ),
      ),
    ]);
    expect(await printed(c.upstairs.printerId)).toEqual([]);
  });

  it("makes a table's cocktail confirmed late at 14:05 at the Upstairs bar, not Lunch's Downstairs bar", async () => {
    at(mondayAt("13:00"));
    const c = await cocktailVenue();
    at(mondayAt("14:05"));
    const answer = await sendAsTill(c.v, "POST", `/api/parties/${c.partyId}/groups`, {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, c.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevision(c.partyId),
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [{ lines: [{ menuItemId: c.offer, quantity: "1" }], release: "fire" }],
      lateSend: { menuIds: [c.v.menus.Almuerzo] },
    });
    expect(answer.status).toBe(200);
    const fired = (answer.body as { groups: { lineIds: string[] }[] }).groups[0]!;
    expect(await stationOf(fired.lineIds[0]!)).toMatchObject({ stationId: c.upstairs.stationId });
    expect(await marksOf(c.tabId)).toEqual([
      { unitPriceGross: 800, latePeriodName: "Lunch", lateConfirmedBy: c.v.personId },
    ]);
    expect(await printed(c.upstairs.printerId)).toEqual([
      expect.stringMatching(/^Upstairs bar\n[^]*\n1\.000 x Mojito\n/),
    ]);
    expect(await printed(c.downstairs.printerId)).toEqual([]);
  });

  /** The venue's tickets print in its Spanish locale; the mark's words come from the table. */
  const lunchMark = `\\*\\* ${KITCHEN_LATE_SEND_WORDS.es.mark.replace("{period}", "Lunch").toLocaleUpperCase("es")} \\*\\*`;

  const lateGroup = async (
    c: Awaited<ReturnType<typeof cocktailVenue>>,
    release: "fire" | "hold",
  ) => {
    const answer = await sendAsTill(c.v, "POST", `/api/parties/${c.partyId}/groups`, {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, c.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevision(c.partyId),
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [{ lines: [{ menuItemId: c.offer, quantity: "1" }], release }],
      lateSend: { menuIds: [c.v.menus.Almuerzo] },
    });
    expect(answer.status).toBe(200);
    return (answer.body as { groups: { id: string }[] }).groups[0]!;
  };

  it("prints the mark above a dish confirmed late on its station's ticket", async () => {
    at(mondayAt("13:00"));
    const c = await cocktailVenue();
    at(mondayAt("14:05"));
    await lateGroup(c, "fire");
    expect(await printed(c.upstairs.printerId)).toEqual([
      expect.stringMatching(new RegExp(`\\nGROUP 1\\n${lunchMark}\\n1\\.000 x Mojito\\n$`)),
    ]);
  });

  it("prints the mark on the own station's ticket of an extra on a dish confirmed late", async () => {
    at(mondayAt("13:00"));
    const c = await cocktailVenue();
    const read = await sendAsTill(c.v, "GET", `/api/service-zones/${c.v.diningZone}/offers`);
    const mojito = (read.body.offers as { id: string; productId: string }[]).find(
      (offer) => offer.id === c.offer,
    )!;
    const { listId, mintId } = await withTransaction(suite.db, async (tx) => {
      const garnish = (await createCategory(tx, { name: "Garnish" })).id;
      await setRoutingCell(
        tx,
        c.v.cfg,
        { row: { kind: "category", categoryId: garnish }, zoneId: null },
        { kind: "station", stationId: c.downstairs.stationId },
      );
      const mint = await createProduct(tx, {
        catalogueId: c.v.menus.Almuerzo,
        categoryId: garnish,
        name: "Mint",
        pricingUnit: "each",
        unitPrice: "0.50",
        vatClass: "general",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Garnishes",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: mint.id, maxQuantity: 1, preselected: false, price: "0.50" }],
        },
        SIGNED_IN_TILL_LOCALE,
      );
      await writeProductModifiers(tx, mojito.productId, [{ kind: "extras", id: list.id }]);
      await publishWorkingMenu(tx, c.v.menus.Almuerzo);
      return { listId: list.id, mintId: mint.id };
    });
    at(mondayAt("14:05"));
    const answer = await sendAsTill(c.v, "POST", `/api/parties/${c.partyId}/groups`, {
      expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, c.tabId)),
      submissionId: randomUUID(),
      expectedPartyRevision: await partyRevision(c.partyId),
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
      groups: [
        {
          lines: [
            {
              menuItemId: c.offer,
              quantity: "1",
              extras: [{ listId, picks: [{ productId: mintId, quantity: 1 }] }],
            },
          ],
          release: "fire",
        },
      ],
      lateSend: { menuIds: [c.v.menus.Almuerzo] },
    });
    expect(answer.status).toBe(200);
    expect(await printed(c.downstairs.printerId)).toEqual([
      expect.stringMatching(new RegExp(`\\nGROUP 1\\n${lunchMark}\\n1\\.000 x Mint\\n`)),
    ]);
  });

  it("prints the mark on the FIRE paper of a dish confirmed late and sent on hold", async () => {
    at(mondayAt("13:00"));
    const c = await cocktailVenue();
    at(mondayAt("14:05"));
    const held = await lateGroup(c, "hold");
    const before = (await printed(c.upstairs.printerId)).length;
    at(mondayAt("14:10"));
    const released = await sendAsTill(
      c.v,
      "POST",
      `/api/parties/${c.partyId}/groups/${held.id}/fire`,
      { submissionId: randomUUID(), expectedPartyRevision: await partyRevision(c.partyId) },
    );
    expect(released.status).toBe(200);
    expect((await printed(c.upstairs.printerId)).slice(before)).toEqual([
      expect.stringMatching(
        new RegExp(
          `\\n${ticketClock(mondayAt("14:10"))}\\nGROUP 1\\n${lunchMark}\\n1\\.000 x Mojito\\n$`,
        ),
      ),
    ]);
  });
});

const sendAsTill: typeof rawSendAsTill = async (till, method, path, body) =>
  rawSendAsTill(
    till,
    method,
    path,
    (await observedDraftCommandBody(
      suite.db,
      method,
      path,
      await observedOrderWriteBody(suite.db, method, path, body),
    )) as object | undefined,
  );
