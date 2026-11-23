import {
  CORE_MIGRATIONS,
  incidents,
  orderDrafts,
  outgoingMail,
  parties,
  printJobs,
  printers,
  recordActivity,
  settings,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { seedPerson, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { preparePersonalData } from "@waitron/module";
import { expect, it } from "vitest";
import { personalDataServerParts } from "./personal-data-export-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const AT = "2026-11-21T19:00:00.000Z";
const LATER = "2026-11-21T19:10:00.000Z";
const FILE = "staff-actions.json";

function prepareStaffActions(personId: string) {
  const parts = personalDataServerParts([], suite.db).filter(({ part }) =>
    part.files.includes(FILE),
  );
  return suite.db.withWriteLock(() =>
    preparePersonalData(suite.db, parts, {
      personId,
      language: "en",
      at: new Date(LATER),
      timeZone: "UTC",
    }),
  );
}

it("exports only the subject's remaining non-fiscal actions after the initial write turn", async () => {
  await withTransaction(suite.db, async (tx) => {
    for (const id of ["ana", "bea", "clara"]) await seedPerson(tx, { id, displayName: id });
  });
  const build = await prepareStaffActions("ana");
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, { invoiceLocales: ["en"] });
    const order = await seedWorkingOrder(tx, {
      orderNumber: 42,
      editorId: "ana",
      billName: "Private bill",
    });
    const otherOrder = await seedWorkingOrder(tx, { orderNumber: 43, editorId: "bea" });
    await tx.insert(parties).values({ id: "party", openedBy: "bea" });
    await tx.insert(orderDrafts).values([
      { id: "draft", partyId: "party", ownerId: "ana", billId: order.id },
      { id: "other-draft", partyId: "party", ownerId: "bea", billId: otherOrder.id },
    ]);
    const line = {
      workingOrderId: order.id,
      name: "Private dish",
      descriptions: { en: "Private dish" },
      quantity: 1000,
      unitPriceGross: 600,
      lineTotal: 600,
      vatClass: "reduced",
      takeawayVatClass: "reduced",
    };
    await tx.insert(workingOrderLines).values([
      { ...line, id: "line", lineNo: 1, creditedTo: "ana" },
      { ...line, id: "other-line", lineNo: 2, creditedTo: "bea" },
    ]);
    const incident = {
      source: "dashboard",
      severity: "warning",
      detectedAt: AT,
      acknowledgedAt: LATER,
    } as const;
    await tx.insert(incidents).values([
      {
        ...incident,
        code: "printer.offline",
        acknowledgedBy: "ana",
        acknowledgedNote: "Private note",
      },
      { ...incident, code: "printer.paper", acknowledgedBy: "bea" },
    ]);
    for (const personId of ["ana", "bea"]) {
      await recordActivity(tx, {
        kind: "dashboard.signed_in",
        subjectId: personId,
        personId,
        data: { method: "password" },
        at: new Date(AT),
      });
    }
    const mail = {
      queuedAt: AT,
      nextAttemptAt: AT,
      notAfter: LATER,
      recipient: "private@example.test",
      params: { secret: "private" },
    };
    await tx.insert(outgoingMail).values([
      {
        ...mail,
        seq: 2,
        dedupeKey: "subject",
        kind: "security_change",
        personId: "ana",
        requestedBy: null,
      },
      {
        ...mail,
        seq: 1,
        dedupeKey: "requester",
        kind: "account_action",
        personId: "bea",
        requestedBy: "ana",
      },
      {
        ...mail,
        seq: 3,
        dedupeKey: "both",
        kind: "email_changed",
        personId: "ana",
        requestedBy: "ana",
        status: "sent",
        finishedAt: LATER,
        queuedAt: "2026-11-21T19:05:00.000Z",
      },
      {
        ...mail,
        seq: 4,
        dedupeKey: "other",
        kind: "daily_report",
        personId: "bea",
        requestedBy: "bea",
      },
      { ...mail, seq: 5, dedupeKey: "reminder", kind: "attendance_question", personId: "ana" },
      { ...mail, seq: 6, dedupeKey: "invoice", kind: "invoice", personId: null },
    ]);
    await tx
      .insert(printers)
      .values({ id: "printer", name: "Bar printer", transport: "network_tcp", host: "10.0.0.1" });
    const print = {
      printerId: "printer",
      payload: Buffer.from("Private print bytes"),
      status: "done",
      handedOverAt: AT,
    } as const;
    await tx.insert(printJobs).values([
      { ...print, id: "job", handedOverBy: "ana" },
      { ...print, id: "other-job", handedOverBy: "bea" },
    ]);
    const saved = { version: 1, revision: 1, updatedAt: AT, doc: { secret: "Private setting" } };
    await tx.insert(settings).values([
      { ...saved, module: "fixture_later", updatedBy: "ana" },
      { ...saved, module: "fixture_ana", updatedBy: "ana" },
      { ...saved, module: "fixture_bea", updatedBy: "bea" },
    ]);
  });

  const files = await build();
  expect(files.map((file) => file.name)).toEqual([FILE]);
  expect(JSON.parse(files[0]!.content as string)).toEqual({
    billEdits: [{ orderNumber: 42 }],
    ownedDrafts: [{ draftId: "draft" }],
    creditedLines: [{ orderNumber: 42, lineId: "line" }],
    acknowledgedAlerts: [{ code: "printer.offline", at: LATER }],
    activity: [{ kind: "dashboard.signed_in", at: AT }],
    outgoingMail: [
      { kind: "account_action", status: "pending", at: AT, yourPart: ["requester"] },
      { kind: "security_change", status: "pending", at: AT, yourPart: ["subject"] },
      {
        kind: "email_changed",
        status: "sent",
        at: "2026-11-21T19:05:00.000Z",
        yourPart: ["subject", "requester"],
      },
    ],
    receiptHandovers: [{ jobId: "job", at: AT }],
    savedSettings: [
      { module: "fixture_ana", at: AT },
      { module: "fixture_later", at: AT },
    ],
  });
  await expect((await prepareStaffActions("clara"))()).resolves.toEqual([]);
});

it("lists several actions of each kind in a fixed order, whatever order they were written in", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedPerson(tx, { id: "ana", displayName: "ana" });
  });
  const build = await prepareStaffActions("ana");
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, { invoiceLocales: ["en"] });
    const later = await seedWorkingOrder(tx, { orderNumber: 45, editorId: "ana" });
    const earlier = await seedWorkingOrder(tx, { orderNumber: 44, editorId: "ana" });
    await tx.insert(parties).values({ id: "party", openedBy: "ana" });
    await tx.insert(orderDrafts).values([
      { id: "z-draft", partyId: "party", ownerId: "ana", billId: later.id },
      { id: "a-draft", partyId: "party", ownerId: "ana", billId: earlier.id },
    ]);
    const line = {
      name: "Dish",
      descriptions: { en: "Dish" },
      quantity: 1000,
      unitPriceGross: 600,
      lineTotal: 600,
      vatClass: "reduced",
      takeawayVatClass: "reduced",
      creditedTo: "ana",
    };
    await tx.insert(workingOrderLines).values([
      { ...line, workingOrderId: later.id, id: "b-line", lineNo: 1 },
      { ...line, workingOrderId: later.id, id: "a-line", lineNo: 2 },
      { ...line, workingOrderId: earlier.id, id: "c-line", lineNo: 1 },
    ]);
    const incident = { source: "dashboard", severity: "warning", detectedAt: AT } as const;
    await tx.insert(incidents).values([
      { ...incident, code: "printer.paper", acknowledgedAt: LATER, acknowledgedBy: "ana" },
      { ...incident, code: "printer.offline", acknowledgedAt: LATER, acknowledgedBy: "ana" },
      { ...incident, code: "printer.unknown", acknowledgedAt: AT, acknowledgedBy: "ana" },
    ]);
    for (const at of [LATER, AT]) {
      await recordActivity(tx, {
        kind: "dashboard.signed_out",
        subjectId: "ana",
        personId: "ana",
        data: { reason: "signed_out" },
        at: new Date(at),
      });
    }
    await recordActivity(tx, {
      kind: "dashboard.signed_in",
      subjectId: "ana",
      personId: "ana",
      data: { method: "password" },
      at: new Date(AT),
    });
    await tx
      .insert(printers)
      .values({ id: "printer", name: "Bar printer", transport: "network_tcp", host: "10.0.0.1" });
    const print = { printerId: "printer", payload: Buffer.from("x"), status: "done" } as const;
    await tx.insert(printJobs).values([
      { ...print, id: "z-job", handedOverBy: "ana", handedOverAt: LATER },
      { ...print, id: "b-job", handedOverBy: "ana", handedOverAt: AT },
      { ...print, id: "a-job", handedOverBy: "ana", handedOverAt: AT },
    ]);
  });

  const exported = JSON.parse((await build())[0]!.content as string);
  expect(exported.billEdits).toEqual([{ orderNumber: 44 }, { orderNumber: 45 }]);
  expect(exported.ownedDrafts).toEqual([{ draftId: "a-draft" }, { draftId: "z-draft" }]);
  expect(exported.creditedLines).toEqual([
    { orderNumber: 44, lineId: "c-line" },
    { orderNumber: 45, lineId: "a-line" },
    { orderNumber: 45, lineId: "b-line" },
  ]);
  expect(exported.acknowledgedAlerts).toEqual([
    { code: "printer.unknown", at: AT },
    { code: "printer.offline", at: LATER },
    { code: "printer.paper", at: LATER },
  ]);
  expect(exported.activity).toEqual([
    { kind: "dashboard.signed_in", at: AT },
    { kind: "dashboard.signed_out", at: AT },
    { kind: "dashboard.signed_out", at: LATER },
  ]);
  expect(exported.receiptHandovers).toEqual([
    { jobId: "a-job", at: AT },
    { jobId: "b-job", at: AT },
    { jobId: "z-job", at: LATER },
  ]);
});
