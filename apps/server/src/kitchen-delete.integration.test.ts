import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { ticketItems, workingOrderLines, orderDraftEvents } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createCourse, createStation, listCourses, listStations } from "./kitchen.js";
import { mountManagementApi } from "./management-api.js";
import { saveDraft, readDrafts, submitDraft } from "./order-drafts.js";
import { listOrderGroups } from "./order-groups.js";
import { fireCourse, bumpCourseReady, readTabLines, listExpoQueue } from "./working-order.js";
import { readRestOfOrder } from "./rest-of-order.js";
import { inTx, setupPartyVenue, seat, OPERATOR } from "./testing/party-venue.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("keeps retained draft, group, course and ready station history through management deletion", async () => {
  const v = await setupPartyVenue(suite.db);
  const seated = await seat(v, await v.table("Mesa history"));
  const { course, station } = await inTx(v, async (tx) => {
    const createdCourse = await createCourse(tx, v.cfg, {
      name: "Recorded dessert",
      displayOrder: 3,
    });
    const station = {
      ...(await createStation(tx, v.cfg, { name: "Recorded pastry" })),
      name: "Recorded pastry",
    };
    const course = { ...createdCourse, name: "Recorded dessert", displayOrder: 3 };
    await setRoutingCell(
      tx,
      v.cfg,
      { row: { kind: "product", productId: v.productId("Flan") }, zoneId: null },
      { kind: "station", stationId: station.id },
    );
    return { course, station };
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
    removes: [],
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
  const deleted = await remove("stations", station.id);
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({
    target: { id: station.id, name: station.name },
    refusals: [],
    ends: [],
    removes: [{ key: "station_routing_cells", count: 1, targets: [] }],
  });
  expect(await history()).toEqual(before);
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
  const reused = await inTx(v, (tx) =>
    createCourse(tx, v.cfg, { name: course.name, displayOrder: 0 }),
  );
  expect(reused.id).not.toBe(course.id);
  expect((await inTx(v, (tx) => readTabLines(tx, v.cfg, submitted.tabId)))[0]!.course).toEqual(
    held!.course,
  );
});
