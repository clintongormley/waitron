import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import {
  ticketItems,
  workingOrderLines,
  orderDraftEvents,
  devices,
  deviceProfiles,
  products,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  setRoutingCell,
  saveMenuPeriod,
  listDepartments,
  setProfileKitchenScreens,
  setDeviceKitchenScreens,
  routingCells,
  routingCellPeriods,
} from "@waitron/venue-service";
import {
  createCourse,
  createStation,
  listCourses,
  listStations,
  setProductCourse,
} from "./kitchen.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { deleteCourse, readCourseDeleteImpact } from "./course-delete.js";
import { deleteStation, readStationDeleteImpact } from "./station-delete.js";
import { eq } from "drizzle-orm";
import { republishMenus } from "./testing/publish-menu.js";
import { mountManagementApi } from "./management-api.js";
import { saveDraft, readDrafts, submitDraft } from "./order-drafts.js";
import { listOrderGroups } from "./order-groups.js";
import {
  fireCourse,
  bumpCourseReady,
  readTabLines,
  listExpoQueue,
  advanceTicketItem,
  addTabRound,
} from "./working-order.js";
import { readRestOfOrder } from "./rest-of-order.js";
import { inTx, setupPartyVenue, seat, OPERATOR } from "./testing/party-venue.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("keeps retained draft, group, course and ready station history through management deletion", async () => {
  const v = await setupPartyVenue(suite.db);
  const seated = await seat(v, await v.table("Mesa history"));
  const { course, station, defaultStation } = await inTx(v, async (tx) => {
    const createdCourse = await createCourse(tx, v.cfg, {
      name: "Recorded dessert",
      displayOrder: 3,
    });
    const station = {
      ...(await createStation(tx, v.cfg, { name: "Recorded pastry" })),
      name: "Recorded pastry",
    };
    const course = { ...createdCourse, name: "Recorded dessert", displayOrder: 3 };
    const defaultStation = (await listStations(tx, v.cfg)).find((row) => row.isDefault)!;
    const department = (await listDepartments(tx, v.cfg))[0]!;
    const period = await saveMenuPeriod(tx, v.cfg, department.id, {
      name: "Dessert service",
      menuId: v.tables.menuId,
      staffMenuIds: [],
    });
    await setProductCourse(tx, v.cfg, v.productId("Flan"), course.id);
    await republishMenus(tx);
    const [flan] = await tx
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(eq(products.id, v.productId("Flan")));
    await setRoutingCell(
      tx,
      v.cfg,
      { row: { kind: "category", categoryId: flan!.categoryId! }, zoneId: null },
      { kind: "station", stationId: defaultStation.id },
    );
    await setRoutingCell(
      tx,
      v.cfg,
      { row: { kind: "product", productId: v.productId("Flan") }, zoneId: null },
      { kind: "station", stationId: station.id },
      [{ periodId: period.id, target: { kind: "station", stationId: defaultStation.id } }],
    );
    return { course, station, defaultStation };
  });
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: v.db,
      cfg: v.cfg,
      venueCfg: v.cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  mountCatalogueApi(app, { db: v.db, venueCfg: v.cfg }, () => {});
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "dashPass123" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const remove = (kind: string, id: string) =>
    app.request(`/management-api/${kind}/${id}`, { method: "DELETE", headers: { cookie } });
  const draft = await inTx(v, (tx) =>
    saveDraft(tx, v.cfg, seated.partyId, OPERATOR, {
      draftId: null,
      revision: 0,
      lines: [
        {
          menuItemId: v.item("Flan"),
          variantId: null,
          menuVersionId: null,
          options: [],
          extras: [],
          note: null,
          quantity: "1",
          courseId: course.id,
          noMerge: false,
        },
      ],
    }),
  );
  const courseDelete = await remove("courses", course.id);
  expect(courseDelete.status).toBe(200);
  expect(await courseDelete.json()).toEqual({
    target: { id: course.id, name: course.name },
    refusals: [],
    ends: [],
    removes: [{ key: "course_products", count: 1, targets: [] }],
  });
  const [retained] = await inTx(v, (tx) => readDrafts(tx, v.cfg, seated.partyId));
  expect(retained!.lines).toEqual([
    {
      ...draft.lines[0],
      course: { id: course.id, name: course.name, displayOrder: course.displayOrder },
    },
  ]);
  const submitted = await inTx(v, (tx) =>
    submitDraft(tx, v.cfg, seated.partyId, draft.id, {
      operatorId: OPERATOR,
      submissionId: randomUUID(),
      expectedPartyRevision: seated.revision,
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map((line) => line.id), release: "hold" }],
    }),
  );
  expect(submitted.groups).toHaveLength(1);
  const [held] = await inTx(v, (tx) => readTabLines(tx, v.cfg, submitted.tabId));
  expect(held!.course).toEqual({ id: course.id, name: course.name, displayOrder: 3 });
  expect(submitted.groups[0]!.lineIds).toEqual([held!.id]);
  const refused = await remove("stations", station.id);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({
    error: { code: "station.work_in_progress", params: { stationId: station.id, count: 1 } },
  });
  await inTx(v, (tx) => fireCourse(tx, v.cfg, submitted.tabId, course.id, { personId: OPERATOR }));
  const [preparingTicket] = await v.db.select().from(ticketItems);
  await inTx(v, (tx) => advanceTicketItem(tx, v.cfg, preparingTicket!.id, "preparing"));
  const preparing = await remove("stations", station.id);
  expect(preparing.status).toBe(409);
  expect(await preparing.json()).toEqual({
    error: { code: "station.work_in_progress", params: { stationId: station.id, count: 1 } },
  });
  await inTx(v, (tx) => bumpCourseReady(tx, v.cfg, submitted.tabId, course.id));
  const history = async () => ({
    tickets: await v.db.select().from(ticketItems),
    lines: await v.db.select().from(workingOrderLines),
    events: await v.db.select().from(orderDraftEvents),
    groups: await inTx(v, (tx) => listOrderGroups(tx, seated.partyId)),
    tab: await inTx(v, (tx) => readTabLines(tx, v.cfg, submitted.tabId)),
    pass: await inTx(v, (tx) => listExpoQueue(tx, v.cfg)),
    rest: await inTx(v, (tx) => readRestOfOrder(tx, [submitted.tabId])),
  });
  const before = await history();
  const display = await inTx(v, async (tx) => {
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: "Dessert KDS", formFactor: "kds" })
      .returning();
    await setProfileKitchenScreens(tx, v.cfg, profile!.id, {
      station: { stationIds: null, zoneIds: null },
    });
    const [device] = await tx
      .insert(devices)
      .values({
        locationId: v.cfg.locationId,
        deviceProfileId: profile!.id,
        label: "Off dessert display",
        active: false,
        tokenHash: randomUUID(),
      })
      .returning();
    await setDeviceKitchenScreens(tx, v.cfg, {
      deviceId: device!.id,
      profileId: profile!.id,
      screens: [{ kind: "station", stationIds: [station.id], zoneIds: null }],
    });
    return device!;
  });
  const bound = await remove("stations", station.id);
  expect(bound.status).toBe(409);
  expect(await bound.json()).toEqual({
    error: { code: "station.screen_in_use", params: { stationId: station.id, count: 1 } },
  });
  expect(await history()).toEqual(before);
  await inTx(v, (tx) =>
    setDeviceKitchenScreens(tx, v.cfg, {
      deviceId: display.id,
      profileId: display.deviceProfileId!,
      screens: [{ kind: "station", stationIds: null, zoneIds: null }],
    }),
  );
  const deleted = await remove("stations", station.id);
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({
    target: { id: station.id, name: station.name },
    refusals: [],
    ends: [],
    removes: [
      { key: "station_routing_cells", count: 1, targets: [] },
      { key: "station_routing_periods", count: 1, targets: [] },
    ],
  });
  expect(await history()).toEqual(before);
  expect(await v.db.select().from(routingCellPeriods)).toEqual([]);
  expect((await v.db.select().from(routingCells)).map((row) => row.stationId)).toEqual([
    defaultStation.id,
  ]);
  const madeAt = await app.request("/management-api/products/made-at", { headers: { cookie } });
  expect(madeAt.status).toBe(200);
  expect((await madeAt.json())[v.productId("Flan")]).toEqual({
    stationId: defaultStation.id,
    stationName: defaultStation.name,
    noPreparation: false,
    noReplacement: false,
    unavailableStationId: null,
    variesByZone: false,
  });
  expect(before.rest.get(submitted.tabId)![0]).toEqual({
    ticketItemId: before.tickets[0]!.id,
    orderId: submitted.tabId,
    workingOrderLineId: held!.id,
    stationId: station.id,
    stationName: station.name,
    name: "FLAN",
    quantity: "1.000",
    unitName: before.rest.get(submitted.tabId)![0]!.unitName,
    unitPrecision: 0,
    state: "ready",
    held: false,
  });
  expect(await inTx(v, (tx) => listCourses(tx, v.cfg))).toEqual([]);
  expect(
    (await inTx(v, (tx) => listStations(tx, v.cfg))).some((row) => row.id === station.id),
  ).toBe(false);
  const oldEdit = await app.request(`/management-api/stations/${station.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: "{}",
  });
  expect(oldEdit.status).toBe(404);
  expect(await oldEdit.json()).toEqual({
    error: { code: "station.not_found", params: { stationId: station.id } },
  });
  const reusedStation = await inTx(v, (tx) => createStation(tx, v.cfg, { name: station.name }));
  expect(reusedStation.id).not.toBe(station.id);
  await inTx(v, (tx) => republishMenus(tx));
  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, submitted.tabId, [
      { menuItemId: v.item("Flan"), quantity: "1", note: "fresh after deletion" },
    ]),
  );
  const freshTickets = await v.db.select().from(ticketItems);
  expect(freshTickets).toHaveLength(2);
  const freshTicket = freshTickets.find((row) => row.id !== before.tickets[0]!.id)!;
  expect(freshTicket.stationId).toBe(defaultStation.id);
  expect(freshTicket.firedAt).not.toBeNull();
  const freshLine = (await v.db.select().from(workingOrderLines)).find(
    (row) => row.id === freshTicket.workingOrderLineId,
  )!;
  expect(freshLine.courseId).toBeNull();
  expect(freshTickets.find((row) => row.id === before.tickets[0]!.id)).toEqual(before.tickets[0]);
  const reused = await inTx(v, (tx) =>
    createCourse(tx, v.cfg, { name: course.name, displayOrder: 0 }),
  );
  expect(reused.id).not.toBe(course.id);
  expect((await inTx(v, (tx) => readTabLines(tx, v.cfg, submitted.tabId)))[0]!.course).toEqual(
    held!.course,
  );
});

it("recomputes course impact after a queued product-default write commits", async () => {
  const v = await setupPartyVenue(suite.db);
  const course = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Queued dessert" }));
  expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, course.id))).toEqual({
    target: { id: course.id, name: "Queued dessert" },
    refusals: [],
    ends: [],
    removes: [],
  });
  const entered = deferred();
  const release = deferred();
  const writer = inTx(v, async (tx) => {
    entered.resolve();
    await release.promise;
    await setProductCourse(tx, v.cfg, v.productId("Flan"), course.id);
  });
  await entered.promise;
  const asked = deferred();
  const realLock = v.db.withWriteLock.bind(v.db);
  const lock = vi.spyOn(v.db, "withWriteLock").mockImplementation(<T>(body: () => Promise<T>) => {
    asked.resolve();
    return realLock(body);
  });
  let deletion: ReturnType<typeof deleteCourse>;
  try {
    deletion = inTx(v, (tx) => deleteCourse(tx, v.cfg, course.id));
    await asked.promise;
  } finally {
    lock.mockRestore();
    release.resolve();
  }
  await writer;
  expect(await deletion!).toEqual({
    target: { id: course.id, name: "Queued dessert" },
    refusals: [],
    ends: [],
    removes: [{ key: "course_products", count: 1, targets: [] }],
  });
  expect(
    await v.db
      .select({ courseId: products.courseId })
      .from(products)
      .where(eq(products.id, v.productId("Flan"))),
  ).toEqual([{ courseId: null }]);
});

it("refuses a queued station delete after another writer sends preparing food", async () => {
  const v = await setupPartyVenue(suite.db);
  const station = await inTx(v, async (tx) => {
    const row = await createStation(tx, v.cfg, { name: "Queued pastry" });
    await setRoutingCell(
      tx,
      v.cfg,
      { row: { kind: "product", productId: v.productId("Flan") }, zoneId: null },
      { kind: "station", stationId: row.id },
    );
    return row;
  });
  const seated = await seat(v, await v.table("Mesa queued"));
  expect((await inTx(v, (tx) => readStationDeleteImpact(tx, v.cfg, station.id))).refusals).toEqual(
    [],
  );
  const entered = deferred();
  const release = deferred();
  const writer = inTx(v, async (tx) => {
    entered.resolve();
    await release.promise;
    await addTabRound(tx, v.cfg, seated.tabId, [{ menuItemId: v.item("Flan"), quantity: "1" }]);
    const [item] = await tx.select().from(ticketItems);
    await advanceTicketItem(tx, v.cfg, item!.id, "preparing");
  });
  await entered.promise;
  const asked = deferred();
  const realLock = v.db.withWriteLock.bind(v.db);
  const lock = vi.spyOn(v.db, "withWriteLock").mockImplementation(<T>(body: () => Promise<T>) => {
    asked.resolve();
    return realLock(body);
  });
  let result: Promise<unknown>;
  try {
    result = inTx(v, (tx) => deleteStation(tx, v.cfg, station.id)).catch((error: unknown) => error);
    await asked.promise;
  } finally {
    lock.mockRestore();
    release.resolve();
  }
  await writer;
  const beforeTickets = await v.db.select().from(ticketItems);
  expect(await result!).toMatchObject({
    code: "station.work_in_progress",
    params: { stationId: station.id, count: 1 },
  });
  expect(await v.db.select().from(ticketItems)).toEqual(beforeTickets);
  expect(
    (await inTx(v, (tx) => listStations(tx, v.cfg))).some((row) => row.id === station.id),
  ).toBe(true);
  expect((await v.db.select().from(routingCells)).map((row) => row.stationId)).toEqual([
    station.id,
  ]);
});
