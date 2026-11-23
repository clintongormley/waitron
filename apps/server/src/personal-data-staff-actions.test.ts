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

async function staffActions(personId: string) {
  const parts = personalDataServerParts([], suite.db).filter(({ part }) =>
    part.files.includes(FILE),
  );
  const build = await suite.db.withWriteLock(() =>
    preparePersonalData(suite.db, parts, {
      personId,
      language: "en",
      at: new Date(LATER),
      timeZone: "UTC",
    }),
  );
  return build();
}

it("exports only the subject's remaining non-fiscal actions", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx, { invoiceLocales: ["en"] });
    for (const id of ["ana", "bea", "clara"]) await seedPerson(tx, { id, displayName: id });
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
        seq: 1,
        dedupeKey: "subject",
        kind: "security_change",
        personId: "ana",
        requestedBy: "bea",
      },
      {
        ...mail,
        seq: 2,
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
      { ...saved, module: "fixture_ana", updatedBy: "ana" },
      { ...saved, module: "fixture_bea", updatedBy: "bea" },
    ]);
  });

  const files = await staffActions("ana");
  expect(files.map((file) => file.name)).toEqual([FILE]);
  expect(JSON.parse(files[0]!.content as string)).toEqual({
    billEdits: [{ orderNumber: 42 }],
    ownedDrafts: [{ draftId: "draft" }],
    creditedLines: [{ orderNumber: 42, lineId: "line" }],
    acknowledgedAlerts: [{ code: "printer.offline", at: LATER }],
    activity: [{ kind: "dashboard.signed_in", at: AT }],
    outgoingMail: [
      { kind: "security_change", status: "pending", at: AT, yourPart: ["subject"] },
      { kind: "account_action", status: "pending", at: AT, yourPart: ["requester"] },
      {
        kind: "email_changed",
        status: "sent",
        at: "2026-11-21T19:05:00.000Z",
        yourPart: ["subject", "requester"],
      },
    ],
    receiptHandovers: [{ jobId: "job", at: AT }],
    savedSettings: [{ module: "fixture_ana", at: AT }],
  });
  await expect(staffActions("clara")).resolves.toEqual([]);
});
