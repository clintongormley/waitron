import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatInvoiceNumber } from "@waitron/core";
import {
  billPaymentRefunds,
  billPayments,
  drawerOpens,
  invoiceSeries,
  locations,
  nodes,
  sales,
  saleVoids,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { selectTimeRecordExport } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { jobOrigin } from "@waitron/shared";
import { departments } from "@waitron/venue-service";
import {
  WorkforceBackend,
  absences,
  attendanceMail,
  attendanceOperationFacts,
  attendanceQuestions,
  availability,
  employments,
  localWallClock,
  rosterVersions,
  shiftSwaps,
  shifts,
  timeEntries,
} from "@waitron/workforce";
import { mountAttendanceExportApi } from "./attendance-export-api.js";
import { mountMeApi } from "./me-api.js";
import { ALL_MODULES } from "./modules.js";
import { personalDataReadme } from "./personal-data-readme.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NODE_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/management-api/me/personal-data/export";
/** The route's clock: the venue's date (Europe/Madrid) is 2026-06-01. */
const AT = new Date("2026-06-01T10:00:00.000Z");
const SESSION_OPENED_AT = "2026-06-01T10:19:19.993Z";
/** Marta's first time entry's local day (00:30 at +01:00); its UTC date is 2026-03-02. */
const FIRST_DAY = "2026-03-03";
/** The day after the venue's date, which is later than her last entry. */
const BEFORE = "2026-06-02";
const MARTA_CLAIM_TOKEN = "holder-7:3f9c2b1e-claim-token";
const MODULE_JSON = [
  "employment.json",
  "rota.json",
  "absences.json",
  "attendance.json",
  "staff-roles.json",
];
const FILES = [
  "profile.json",
  "sign-in.json",
  "employment.json",
  "rota.json",
  "absences.json",
  "attendance.json",
  "staff-roles.json",
  "time-record.pdf",
  "time-record.csv",
  "actions.json",
];

const MARTA = {
  name: "Marta Canary",
  email: "marta.canary@example.test",
  passkeyOfferedAt: "2026-02-27T11:11:11.000Z",
};
/** Every clock-in and clock-out the fixture records is at this offset. */
const CLOCK_OFFSET_MINUTES = 60;
const COLLEAGUE = {
  name: "Colleague Ruiz",
  email: "colleague.ruiz@example.test",
  passkeyOfferedAt: "2026-03-13T13:13:13.000Z",
  payRateCents: 1999,
  employmentCreatedAt: "2023-05-25T07:30:00.000Z",
  absenceNote: "Colleague moving house",
  shift: { startsAt: "2026-03-05T02:17:00Z", offsetMinutes: 60 },
  availabilityCreatedAt: "2026-02-27T06:56:00.000Z",
  swapCreatedAt: "2026-04-04T04:04:00.000Z",
  questionCreatedAt: "2026-04-26T04:02:00.000Z",
  reminderRecipient: "ruiz.mail@example.test",
  responseReason: "Colleague was on a delivery run",
  fact: { at: "2026-04-25T20:47:00.000Z", offsetMinutes: 180 },
  staffRole: "Sommelier",
  area: "Cellar",
  clockInAt: "2026-03-04T09:07:00.000Z",
  voidSale: { code: "TA", number: 74, total: 8642 },
  voidedAt: "2026-05-11T15:26:00.000Z",
  refundSale: { code: "TB", number: 85, total: 6420 },
  refundAmountCents: 2109,
  refundedAt: "2026-05-12T20:31:00.000Z",
  drawerSale: { code: "TA", number: 96, total: 1975 },
  drawerOpenedAt: "2026-05-13T13:47:00.000Z",
  billSale: { code: "TB", number: 38, total: 7458 },
  billRefundAmountCents: 3197,
  billRefundedAt: "2026-05-16T21:52:00.000Z",
};
const MARTA_ACTIONS = {
  voidSale: { code: "TA", number: 41, total: 2468 },
  voidedAt: "2026-05-04T08:21:00.000Z",
  refundSale: { code: "TB", number: 52, total: 3579 },
  refundAmountCents: 1357,
  refundedAt: "2026-05-06T19:44:00.000Z",
  drawerSale: { code: "TA", number: 63, total: 4091 },
  drawerOpenedAt: "2026-05-09T12:34:56.000Z",
  billSale: { code: "TB", number: 27, total: 5321 },
  billRefundAmountCents: 2864,
  billRefundedAt: "2026-05-15T18:03:00.000Z",
};
const ADMIN = { name: "Ana Admin", email: "ana.admin@example.test" };
const MANAGER = { name: "Luis Manager", email: "luis.manager@example.test" };

/** One of Marta's values per file and table, each beside the file it must be found in. */
const MARTA_VALUES: [file: string, value: string][] = [
  ["profile.json", MARTA.email],
  ["sign-in.json", MARTA.passkeyOfferedAt],
  ["employment.json", '"payRate": "12.34"'],
  ["employment.json", "2025-02-20T09:15:00.000Z"],
  ["absences.json", "Family wedding"],
  ["rota.json", "2026-02-14T04:41:00+01:00"],
  ["rota.json", '"rota": "published"'],
  ["rota.json", "2026-01-25T09:35:00.000Z"],
  ["rota.json", "2026-02-01T10:00:00.000Z"],
  ["attendance.json", "2026-04-19T04:00:00.000Z"],
  ["attendance.json", "marta.reminders@example.test"],
  ["attendance.json", "Forgot to clock in after the delivery"],
  ["attendance.json", "2026-03-07T22:30:00+01:00"],
  ["staff-roles.json", '"name": "Bartender"'],
  ["staff-roles.json", '"staffRole": "Barback"'],
  ["staff-roles.json", "Rooftop bar"],
  ["time-record.csv", "2026-03-03T00:30:00+01:00"],
  ["actions.json", `"sale": "TA/41"`],
  ["actions.json", '"amount": "24.68"'],
  ["actions.json", MARTA_ACTIONS.voidedAt],
  ["actions.json", `"sale": "TB/52"`],
  ["actions.json", '"amount": "13.57"'],
  ["actions.json", MARTA_ACTIONS.refundedAt],
  ["actions.json", `"sale": "TA/63"`],
  ["actions.json", MARTA_ACTIONS.drawerOpenedAt],
  ["actions.json", `"sale": "TB/27"`],
  ["actions.json", '"amount": "28.64"'],
  ["actions.json", MARTA_ACTIONS.billRefundedAt],
];

/** The colleague's values in the same places as Marta's. */
const COLLEAGUE_VALUES = [
  COLLEAGUE.email,
  COLLEAGUE.passkeyOfferedAt,
  (COLLEAGUE.payRateCents / 100).toFixed(2),
  COLLEAGUE.employmentCreatedAt,
  COLLEAGUE.absenceNote,
  localWallClock(COLLEAGUE.shift.startsAt, COLLEAGUE.shift.offsetMinutes),
  COLLEAGUE.availabilityCreatedAt,
  COLLEAGUE.swapCreatedAt,
  COLLEAGUE.questionCreatedAt,
  COLLEAGUE.reminderRecipient,
  COLLEAGUE.responseReason,
  localWallClock(COLLEAGUE.fact.at, COLLEAGUE.fact.offsetMinutes),
  COLLEAGUE.staffRole,
  COLLEAGUE.area,
  localWallClock(COLLEAGUE.clockInAt, CLOCK_OFFSET_MINUTES),
  formatInvoiceNumber(COLLEAGUE.voidSale.code, COLLEAGUE.voidSale.number),
  (COLLEAGUE.voidSale.total / 100).toFixed(2),
  COLLEAGUE.voidedAt,
  formatInvoiceNumber(COLLEAGUE.refundSale.code, COLLEAGUE.refundSale.number),
  (COLLEAGUE.refundAmountCents / 100).toFixed(2),
  COLLEAGUE.refundedAt,
  formatInvoiceNumber(COLLEAGUE.drawerSale.code, COLLEAGUE.drawerSale.number),
  COLLEAGUE.drawerOpenedAt,
  formatInvoiceNumber(COLLEAGUE.billSale.code, COLLEAGUE.billSale.number),
  (COLLEAGUE.billRefundAmountCents / 100).toFixed(2),
  COLLEAGUE.billRefundedAt,
];

const logger = vi.fn();
let locationId: string, martaId: string, colleagueId: string, managerId: string, cookie: string;
let adminCookie: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["es"],
      operationDescription: "Sale on premises",
      timeZone: "Europe/Madrid",
    })
    .returning({ id: locations.id });
  locationId = location!.id;
  await suite.db.insert(nodes).values({ id: NODE_ID, locationId, name: "Box" });
  const [marta, colleague, manager, admin] = await suite.db
    .insert(persons)
    .values([
      {
        displayName: MARTA.name,
        email: MARTA.email,
        pinHash: hashPin("4821"),
        passkeyOfferedAt: MARTA.passkeyOfferedAt,
      },
      {
        displayName: COLLEAGUE.name,
        email: COLLEAGUE.email,
        pinHash: hashPin("9137"),
        passkeyOfferedAt: COLLEAGUE.passkeyOfferedAt,
      },
      { displayName: MANAGER.name, email: MANAGER.email, role: "manager" },
      { displayName: ADMIN.name, email: ADMIN.email, role: "admin" },
    ])
    .returning({ id: persons.id });
  martaId = marta!.id;
  colleagueId = colleague!.id;
  managerId = manager!.id;

  const backend = new WorkforceBackend();
  const clock = async (personId: string, inAt: string, outAt: string) => {
    const event = (at: string) => ({
      nodeId: NODE_ID,
      locationId,
      personId,
      offsetMinutes: CLOCK_OFFSET_MINUTES,
      origin: jobOrigin("dashboard"),
      at,
    });
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event(inAt)));
    await withTransaction(suite.db, (tx) => backend.clockOut(tx, event(outAt)));
  };
  await clock(martaId, "2026-03-02T23:30:00.000Z", "2026-03-03T07:15:00.000Z");
  await clock(colleagueId, COLLEAGUE.clockInAt, "2026-03-04T17:43:00.000Z");

  const [entry] = await suite.db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(eq(timeEntries.personId, martaId))
    .limit(1);

  await suite.db.insert(employments).values([
    {
      personId: martaId,
      contractedMinutesPerWeek: 1200,
      contractType: "part_time",
      startDate: "2025-03-01",
      payRate: 1234,
      createdAt: "2025-02-20T09:15:00.000Z",
    },
    {
      personId: colleagueId,
      contractedMinutesPerWeek: 1800,
      contractType: "seasonal",
      startDate: "2023-06-01",
      payRate: COLLEAGUE.payRateCents,
      createdAt: COLLEAGUE.employmentCreatedAt,
    },
  ]);

  await suite.db.insert(absences).values([
    {
      personId: martaId,
      kind: "holiday",
      startsOn: "2026-05-18",
      endsOn: "2026-05-22",
      status: "approved",
      note: "Family wedding",
      decidedByPersonId: managerId,
      decidedAt: "2026-04-02T16:20:00.000Z",
      createdAt: "2026-04-01T11:05:00.000Z",
    },
    {
      personId: colleagueId,
      kind: "leave",
      startsOn: "2025-11-11",
      endsOn: "2025-11-13",
      status: "rejected",
      note: COLLEAGUE.absenceNote,
      decidedByPersonId: managerId,
      decidedAt: "2025-10-30T12:00:00.000Z",
      createdAt: "2025-10-29T13:40:00.000Z",
    },
  ]);

  const [published] = await suite.db
    .insert(rosterVersions)
    .values({
      locationId,
      periodStart: "2026-02-09",
      periodEnd: "2026-02-15",
      status: "published",
      publishedAt: "2026-02-05T10:00:00.000Z",
    })
    .returning({ id: rosterVersions.id });
  const [martaShift, colleagueShift] = await suite.db
    .insert(shifts)
    .values([
      {
        personId: martaId,
        locationId,
        startsAt: "2026-02-14T03:41:00Z",
        startsOffsetMinutes: 60,
        endsAt: "2026-02-14T11:41:00Z",
        endsOffsetMinutes: 60,
        rosterVersionId: published!.id,
        createdAt: "2025-12-15T08:20:00.000Z",
      },
      {
        personId: colleagueId,
        locationId,
        startsAt: COLLEAGUE.shift.startsAt,
        startsOffsetMinutes: COLLEAGUE.shift.offsetMinutes,
        endsAt: "2026-03-05T09:17:00Z",
        endsOffsetMinutes: 60,
        rosterVersionId: null,
        createdAt: "2026-02-20T06:59:00.000Z",
      },
    ])
    .returning({ id: shifts.id });

  await suite.db.insert(availability).values([
    {
      personId: martaId,
      weekday: 2,
      availableFromMinute: 1050,
      availableToMinute: 1305,
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-06-30",
      createdAt: "2026-01-25T09:35:00.000Z",
    },
    {
      personId: colleagueId,
      weekday: 3,
      availableFromMinute: 370,
      availableToMinute: 710,
      effectiveFrom: "2026-03-03",
      effectiveTo: "2026-09-09",
      createdAt: COLLEAGUE.availabilityCreatedAt,
    },
  ]);

  await suite.db.insert(shiftSwaps).values([
    {
      requestedByPersonId: martaId,
      fromShiftId: martaShift!.id,
      toPersonId: colleagueId,
      toShiftId: colleagueShift!.id,
      status: "approved",
      decidedByPersonId: managerId,
      decidedAt: "2026-02-03T12:12:00.000Z",
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    {
      requestedByPersonId: colleagueId,
      fromShiftId: colleagueShift!.id,
      toPersonId: managerId,
      status: "requested",
      createdAt: COLLEAGUE.swapCreatedAt,
    },
  ]);

  const martaQuestion = "00000000-0000-4000-8000-0000000000a1";
  const colleagueQuestion = "00000000-0000-4000-8000-0000000000c1";
  await suite.db.insert(attendanceQuestions).values([
    {
      id: martaQuestion,
      personId: martaId,
      locationId,
      businessDay: "2026-04-18",
      startAt: "2026-04-18T04:00:00.000Z",
      endAt: "2026-04-19T04:00:00.000Z",
      shiftKey: "shift:marta-0418",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["order:evidence-marta-1"],
      createdAt: "2026-04-19T04:00:00.000Z",
    },
    {
      id: colleagueQuestion,
      personId: colleagueId,
      locationId,
      businessDay: "2026-04-25",
      startAt: "2026-04-25T04:00:00.000Z",
      endAt: "2026-04-26T04:00:00.000Z",
      shiftKey: "shift:colleague-0425",
      kind: "missing-times",
      missingKinds: ["out"],
      evidenceKeys: ["order:evidence-colleague"],
      createdAt: COLLEAGUE.questionCreatedAt,
    },
  ]);
  await suite.db.insert(attendanceMail).values([
    {
      questionId: martaQuestion,
      status: "sent",
      claimToken: MARTA_CLAIM_TOKEN,
      claimedAt: "2026-04-19T04:01:00.000Z",
      nextAttemptAt: "2026-04-19T04:00:00.000Z",
      recipient: "marta.reminders@example.test",
      outcome: "sent",
    },
    {
      questionId: colleagueQuestion,
      status: "rejected",
      claimToken: "holder-9:colleague-claim-token",
      claimedAt: "2026-04-26T04:03:00.000Z",
      nextAttemptAt: "2026-04-26T04:18:00.000Z",
      recipient: COLLEAGUE.reminderRecipient,
      outcome: "rejected",
    },
  ]);
  // The table is not exported from @waitron/workforce, so its rows are written with bound values.
  const response = async (row: {
    id: string;
    by: string;
    personId: string;
    questionId: string | null;
    action: string;
    input: unknown;
    createdAt: string;
  }) => {
    await suite.db.run(
      sql`insert into attendance_response_commands (id, requested_by_person_id, authorized_by_person_id, person_id, location_id, question_id, action, input, entry_ids, created_at) values (${row.id}, ${row.by}, ${row.by}, ${row.personId}, ${locationId}, ${row.questionId}, ${row.action}, ${JSON.stringify(row.input)}, ${JSON.stringify([entry!.id])}, ${row.createdAt})`,
    );
  };
  await response({
    id: "00000000-0000-4000-8000-0000000000b1",
    by: martaId,
    personId: martaId,
    questionId: martaQuestion,
    action: "request",
    input: {
      action: "request",
      questionId: martaQuestion,
      locationId,
      changes: [
        { target: { missingKind: "in" }, at: "2026-04-18T15:58:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Forgot to clock in after the delivery",
    },
    createdAt: "2026-04-19T08:30:00.000Z",
  });
  await response({
    id: "00000000-0000-4000-8000-0000000000b2",
    by: managerId,
    personId: martaId,
    questionId: null,
    action: "propose",
    input: {
      action: "propose",
      personId: martaId,
      locationId,
      changes: [
        { target: { missingKind: "out" }, at: "2026-04-19T00:10:00.000Z", offsetMinutes: 120 },
      ],
      reason: "Till log shows a later finish",
    },
    createdAt: "2026-04-20T10:05:00.000Z",
  });
  await response({
    id: "00000000-0000-4000-8000-0000000000c2",
    by: colleagueId,
    personId: colleagueId,
    questionId: null,
    action: "disagree",
    input: {
      action: "disagree",
      itemId: "00000000-0000-4000-8000-0000000000c9",
      reason: COLLEAGUE.responseReason,
    },
    createdAt: "2026-04-27T09:11:00.000Z",
  });
  await suite.db.insert(attendanceOperationFacts).values([
    {
      source: "clock",
      key: "clock:marta-2",
      personId: martaId,
      locationId,
      kind: "break",
      at: "2026-03-07T21:30:00.000Z",
      offsetMinutes: 60,
      businessDay: "2026-03-07",
      outcome: "pending",
    },
    {
      source: "order",
      key: "order:colleague-1",
      personId: colleagueId,
      locationId,
      kind: "order",
      at: COLLEAGUE.fact.at,
      offsetMinutes: COLLEAGUE.fact.offsetMinutes,
      businessDay: "2026-04-25",
      outcome: "refused",
    },
  ]);

  // @waitron/staffing is not a dependency of the server, so its rows are written with bound values.
  const [rooftop, cellar] = await suite.db
    .insert(departments)
    .values([
      { locationId, name: "Rooftop bar", tradingName: "Rooftop bar" },
      { locationId, name: COLLEAGUE.area, tradingName: COLLEAGUE.area },
    ])
    .returning({ id: departments.id });
  const bartender = "00000000-0000-4000-8000-000000000001";
  const sommelier = "00000000-0000-4000-8000-000000000002";
  const barback = "00000000-0000-4000-8000-000000000003";
  for (const [id, name] of [
    [bartender, "Bartender"],
    [sommelier, COLLEAGUE.staffRole],
    [barback, "Barback"],
  ] as const)
    await suite.db.run(
      sql`insert into staff_roles (id, location_id, name) values (${id}, ${locationId}, ${name})`,
    );
  for (const [personId, roleId] of [
    [martaId, bartender],
    [colleagueId, sommelier],
  ] as const)
    await suite.db.run(
      sql`insert into person_staff_roles (person_id, staff_role_id) values (${personId}, ${roleId})`,
    );
  for (const [shiftId, departmentId, roleId] of [
    [martaShift!.id, rooftop!.id, barback],
    [colleagueShift!.id, cellar!.id, sommelier],
  ] as const)
    await suite.db.run(
      sql`insert into shift_assignments (shift_id, department_id, staff_role_id) values (${shiftId}, ${departmentId}, ${roleId})`,
    );

  await seedActions(colleagueId);

  const sessionCookie = (personId: string) =>
    withTransaction(
      suite.db,
      async (tx) =>
        `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId })).token}`,
    );
  cookie = await sessionCookie(martaId);
  adminCookie = await sessionCookie(admin!.id);
  await suite.db
    .update(managementSessions)
    .set({ createdAt: SESSION_OPENED_AT })
    .where(eq(managementSessions.personId, martaId));
});

type Sale = { code: string; number: number; total: number };

/**
 * Marta's sale void, refund, drawer opening and bill-payment refund, and the colleague's, each on a
 * sale of its own. Marta's refunds are authorised by the colleague and the colleague's by the manager.
 */
async function seedActions(colleague: string): Promise<void> {
  const { deviceId } = await seedDevice(suite.db, { locationId });
  const series: Record<string, string> = {};
  for (const code of ["TA", "TB"]) {
    const [row] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: NODE_ID, code, purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    series[code] = row!.id;
  }
  const sale = async (s: Sale, workingOrderId?: string) => {
    const [row] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId: NODE_ID,
        seriesId: series[s.code]!,
        invoiceNumber: s.number,
        issuedAt: "2026-05-01T08:00:00.000Z",
        issuedOffsetMinutes: 120,
        total: s.total,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
        ...(workingOrderId === undefined ? {} : { workingOrderId }),
      })
      .returning({ id: sales.id });
    const [tender] = await suite.db
      .insert(tenders)
      .values({
        saleId: row!.id,
        method: "cash",
        amount: s.total,
        settledAt: "2026-05-01T08:00:00.000Z",
      })
      .returning({ id: tenders.id });
    return { saleId: row!.id, tenderId: tender!.id };
  };
  const rows = [
    { personId: martaId, authorizer: colleague, a: MARTA_ACTIONS },
    { personId: colleague, authorizer: managerId, a: COLLEAGUE },
  ];
  for (const { personId, authorizer, a } of rows) {
    const voided = await sale(a.voidSale);
    await suite.db.insert(saleVoids).values({
      saleId: voided.saleId,
      voidedBy: personId,
      voidedAt: a.voidedAt,
      reason: "Rang up the wrong table",
    });
    const refunded = await sale(a.refundSale);
    await suite.db.insert(tenderRefunds).values({
      saleId: refunded.saleId,
      tenderId: refunded.tenderId,
      submissionId: crypto.randomUUID(),
      fingerprint: `refund ${personId}`,
      reason: "Cold soup",
      source: "device",
      deviceId,
      nodeId: NODE_ID,
      locationId,
      method: "cash",
      manual: false,
      appliedAmount: a.refundAmountCents,
      tipAmount: 0,
      requestedBy: personId,
      authorizedBy: authorizer,
      state: "completed",
      createdAt: a.refundedAt,
      completedAt: a.refundedAt,
    });
    const drawerSale = await sale(a.drawerSale);
    await suite.db.insert(drawerOpens).values({
      reason: "cash_sale",
      personId,
      deviceId,
      saleId: drawerSale.saleId,
      openedAt: new Date(a.drawerOpenedAt),
    });
    const [order] = await suite.db
      .insert(workingOrders)
      .values({ source: "dashboard", locationId, nodeId: NODE_ID, orderNumber: a.billSale.number })
      .returning({ id: workingOrders.id });
    const [payment] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: order!.id,
        submissionId: crypto.randomUUID(),
        fingerprint: `bill ${personId}`,
        kind: "contribution",
        method: "cash",
        applied: a.billSale.total,
        tendered: a.billSale.total,
        state: "received",
        receivedAt: "2026-05-14T12:00:00.000Z",
        requestedBy: personId,
        source: "device",
        deviceId,
      })
      .returning({ id: billPayments.id });
    await sale(a.billSale, order!.id);
    await suite.db.insert(billPaymentRefunds).values({
      billPaymentId: payment!.id,
      submissionId: crypto.randomUUID(),
      fingerprint: `bill refund ${personId}`,
      reason: "Charged twice",
      source: "device",
      deviceId,
      appliedAmount: a.billRefundAmountCents,
      tipAmount: 0,
      requestedBy: personId,
      authorizedBy: authorizer,
      state: "completed",
      createdAt: a.billRefundedAt,
      completedAt: a.billRefundedAt,
    });
  }
}

async function download(path = PATH, as = cookie): Promise<Record<string, Uint8Array>> {
  const app = new Hono();
  mountMeApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: NODE_ID },
      venueLocale: "en-GB",
      modules: ALL_MODULES.map((m) => m.name),
      credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 6) } },
      now: () => AT,
    },
    logger,
  );
  const response = await app.request(path, { headers: { cookie: as } });
  expect(response.status).toBe(200);
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

/** The existing own export of the working-time record, as Marta asks for it. */
async function existingExport(locale: "en" | "es"): Promise<Uint8Array> {
  const app = new Hono();
  mountAttendanceExportApi(
    app,
    { db: suite.db, cfg: { locationId }, exporter: selectTimeRecordExport(ALL_MODULES) },
    logger,
  );
  const query = new URLSearchParams({
    locationId,
    from: FIRST_DAY,
    before: BEFORE,
    format: "csv",
    audience: "standard",
    locale,
  });
  const response = await app.request(`/management-api/me/attendance/export?${query}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

async function pdfText(data: Uint8Array): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(data), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++)
      pages.push(
        (await (await pdf.getPage(i)).getTextContent()).items
          .flatMap((v) => ("str" in v ? [v.str] : []))
          .join(" "),
      );
    return pages.join("\n");
  } finally {
    await loading.destroy();
  }
}

/** Each file as text; the PDF as its raw bytes and the text a reader extracts from it. */
async function readable(files: Record<string, Uint8Array>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    const raw = new TextDecoder().decode(data);
    out[name] = name.endsWith(".pdf") ? `${raw}\n${await pdfText(data)}` : raw;
  }
  return out;
}

function containsExportValue(file: string, content: string, value: string): boolean {
  if (!file.endsWith(".json")) return content.includes(value);
  // An amount can occur inside a session timestamp without being an exported pay or sale value.
  const amount = /^\d+\.\d{2}$/.test(value);
  const contains = (entry: unknown): boolean => {
    if (typeof entry === "string") return amount ? entry === value : entry.includes(value);
    if (typeof entry === "number") return String(entry) === value;
    if (Array.isArray(entry)) return entry.some(contains);
    if (entry !== null && typeof entry === "object")
      return Object.entries(entry).some(([key, item]) => key.includes(value) || contains(item));
    return false;
  };
  return contains(JSON.parse(content));
}

const occurrences = (content: string, part: string) => content.split(part).length - 1;

const readme = (language: "en" | "es") =>
  personalDataReadme({
    language,
    venue: "Test SL",
    person: MARTA.name,
    date: "2026-06-01",
    privacyNoticeUrl: undefined,
    files: FILES,
  });

describe("a staff member's whole personal-data download", () => {
  it.each(["own", "administrator"] as const)(
    "detects planted colleague values in every file of the %s download",
    async (audience) => {
      if (audience === "administrator")
        await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, martaId));
      const files = await download(
        audience === "own" ? PATH : `/management-api/staff/${martaId}/personal-data/export`,
        audience === "own" ? cookie : adminCookie,
      );
      const text = await readable(files);
      for (const [file, content] of Object.entries(text)) {
        for (const value of [...COLLEAGUE_VALUES, COLLEAGUE.name, colleagueId]) {
          const planted = file.endsWith(".json")
            ? JSON.stringify([JSON.parse(content), { nested: [value] }])
            : `${content}\n${value}`;
          expect(containsExportValue(file, planted, value), `${file}: ${value}`).toBe(true);
          if (file.endsWith(".json")) {
            const amount = /^\d+\.\d{2}$/.test(value);
            const alternate = amount ? Number(value) : `A note containing ${value} here`;
            expect(
              containsExportValue(file, JSON.stringify({ nested: [alternate] }), value),
              `${file}: ${value} as ${amount ? "a number" : "part of a note"}`,
            ).toBe(true);
          }
        }
      }
      expect(
        containsExportValue(
          "profile.json",
          '{"email":"colleague\\u002eruiz@example.test"}',
          COLLEAGUE.email,
        ),
      ).toBe(true);
    },
  );

  it("holds every file, her values and none of a colleague's or the manager's", async () => {
    const files = await download();
    expect(Object.keys(files)).toEqual(["README.txt", ...FILES]);
    const text = await readable(files);
    expect(text["sign-in.json"]).toContain(SESSION_OPENED_AT);

    expect(MARTA_VALUES.filter(([file, value]) => !text[file]!.includes(value))).toEqual([]);

    const colleagueAsOther = `"otherPerson": "${COLLEAGUE.name}"`;
    expect(occurrences(text["rota.json"]!, colleagueAsOther)).toBe(1);
    const withoutOther = {
      ...text,
      "rota.json": text["rota.json"]!.replaceAll(colleagueAsOther, '"otherPerson": ""'),
    };
    const leaks = Object.entries(withoutOther).flatMap(([file, content]) =>
      [...COLLEAGUE_VALUES, COLLEAGUE.name, colleagueId]
        .filter((value) => containsExportValue(file, content, value))
        .map((value) => [file, value]),
    );
    expect(leaks).toEqual([]);

    const managerAs = (key: string) => `"${key}": "${MANAGER.name}"`;
    const managerNames = MODULE_JSON.map((file) => {
      const content = text[file]!;
      const named =
        occurrences(content, managerAs("decidedBy")) +
        occurrences(content, managerAs("authorizedBy"));
      const rest = content
        .replaceAll(managerAs("decidedBy"), "")
        .replaceAll(managerAs("authorizedBy"), "");
      return [
        file,
        named,
        rest.includes(MANAGER.name),
        content.includes(managerId),
        content.includes(MANAGER.email),
      ];
    });
    expect(managerNames).toEqual([
      ["employment.json", 0, false, false, false],
      ["rota.json", 1, false, false, false],
      ["absences.json", 1, false, false, false],
      ["attendance.json", 1, false, false, false],
      ["staff-roles.json", 0, false, false, false],
    ]);

    expect(text["README.txt"]).toBe(readme("en"));
    expect(files["time-record.csv"]).toEqual(await existingExport("en"));
  });

  it("carries no secret anywhere in the download", async () => {
    const [pin] = await suite.db
      .select({ hash: persons.pinHash })
      .from(persons)
      .where(eq(persons.id, martaId));
    const [session] = await suite.db
      .select({ hash: managementSessions.tokenHash })
      .from(managementSessions)
      .where(eq(managementSessions.personId, martaId));
    const [entry] = await suite.db
      .select({ hash: timeEntries.entryHash })
      .from(timeEntries)
      .where(eq(timeEntries.personId, martaId));
    const secrets = [pin!.hash!, session!.hash, MARTA_CLAIM_TOKEN, entry!.hash];
    const text = await readable(await download());
    const found = Object.entries(text).flatMap(([file, content]) =>
      secrets.filter((secret) => content.includes(secret)).map((secret) => [file, secret]),
    );
    expect(found).toEqual([]);
    expect(text["profile.json"]!.includes(MARTA.email)).toBe(true);
  });

  it("gives an admin every file and value of hers once she is disabled, and none of a colleague's or a secret", async () => {
    const [pin] = await suite.db
      .select({ hash: persons.pinHash })
      .from(persons)
      .where(eq(persons.id, martaId));
    const [session] = await suite.db
      .select({ hash: managementSessions.tokenHash })
      .from(managementSessions)
      .where(eq(managementSessions.personId, martaId));
    await suite.db.run(sql`update persons set status = 'suspended' where id = ${martaId}`);

    const files = await download(
      `/management-api/staff/${martaId}/personal-data/export`,
      adminCookie,
    );
    expect(Object.keys(files)).toEqual(["README.txt", ...FILES]);
    const text = await readable(files);
    expect(text["sign-in.json"]).toContain(SESSION_OPENED_AT);

    expect(MARTA_VALUES.filter(([file, value]) => !text[file]!.includes(value))).toEqual([]);

    const colleagueAsOther = `"otherPerson": "${COLLEAGUE.name}"`;
    expect(occurrences(text["rota.json"]!, colleagueAsOther)).toBe(1);
    const withoutOther = {
      ...text,
      "rota.json": text["rota.json"]!.replaceAll(colleagueAsOther, '"otherPerson": ""'),
    };
    const leaks = Object.entries(withoutOther).flatMap(([file, content]) =>
      [...COLLEAGUE_VALUES, COLLEAGUE.name, colleagueId]
        .filter((value) => containsExportValue(file, content, value))
        .map((value) => [file, value]),
    );
    expect(leaks).toEqual([]);

    const secrets = [
      pin!.hash!,
      session!.hash,
      hashSessionToken(adminCookie.slice(`${MANAGEMENT_COOKIE}=`.length)),
    ];
    const found = Object.entries(text).flatMap(([file, content]) =>
      secrets.filter((secret) => content.includes(secret)).map((secret) => [file, secret]),
    );
    expect(found).toEqual([]);
    expect(text["profile.json"]!.includes(MARTA.email)).toBe(true);
  });

  it("is in Spanish when her saved language is Spanish", async () => {
    await suite.db.update(persons).set({ locale: "es-ES" }).where(eq(persons.id, martaId));
    const files = await download();
    expect(new TextDecoder().decode(files["README.txt"])).toBe(readme("es"));
    const spanish = await existingExport("es");
    expect(files["time-record.csv"]).toEqual(spanish);
    expect(spanish).not.toEqual(await existingExport("en"));
  });
});
