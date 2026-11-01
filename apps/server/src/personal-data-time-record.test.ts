import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import {
  personalDataParts,
  selectTimeRecordExport,
  validatePersonalDataParts,
  type PersonalDataFile,
  type PersonalDataSubject,
  type WaitronModule,
} from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS, WorkforceBackend } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mountAttendanceExportApi } from "./attendance-export-api.js";
import { TIME_RECORD_FILES, timeRecordPersonalData } from "./personal-data-time-record.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
/** The venue's date is 2026-03-10; Marta's last entry is on 2026-03-20, after it. */
const AT = new Date("2026-03-10T12:00:00Z");
/** Her first entry's local day is 2026-01-01 (offset -120); its UTC date is 2026-01-02. */
const START = "2026-01-01";
const END = "2026-03-21";
const COLLEAGUE_NAME = "Colleague Canary";
const logger = vi.fn();
let locationId: string, martaId: string, colleagueId: string, cookie: string;

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
    .returning();
  locationId = location!.id;
  const nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const [marta, colleague] = await suite.db
    .insert(persons)
    .values([
      { displayName: "Marta López", email: "marta@example.test", role: "staff" },
      { displayName: COLLEAGUE_NAME, email: "colleague@example.test", role: "staff" },
    ])
    .returning();
  martaId = marta!.id;
  colleagueId = colleague!.id;
  const backend = new WorkforceBackend();
  const origin = jobOrigin("dashboard");
  const event = (personId: string, at: string, offsetMinutes: number) => ({
    nodeId,
    personId,
    offsetMinutes,
    origin,
    at,
  });
  const shift = async (personId: string, from: string, to: string, offset: number) => {
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, event(personId, from, offset)));
    await withTransaction(suite.db, (tx) => backend.clockOut(tx, event(personId, to, offset)));
  };
  // The files print each entry's recording time, so it must never spell a colleague probe below.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-04-01T12:00:00Z") });
  try {
    await shift(martaId, "2026-01-02T00:30:00.000Z", "2026-01-02T06:00:00.000Z", -120);
    await shift(colleagueId, "2026-01-03T10:07:00.000Z", "2026-01-03T18:43:00.000Z", 60);
    await shift(martaId, "2026-02-10T09:00:00.000Z", "2026-02-10T17:00:00.000Z", 60);
    await shift(martaId, "2026-03-20T09:00:00.000Z", "2026-03-20T17:00:00.000Z", 60);
  } finally {
    vi.useRealTimers();
  }
  cookie = await withTransaction(
    suite.db,
    async (tx) =>
      `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: martaId })).token}`,
  );
});

function subject(patch: Partial<PersonalDataSubject> = {}): PersonalDataSubject {
  return {
    personId: martaId,
    language: "en",
    at: AT,
    timeZone: "Europe/Madrid",
    locationId,
    ...patch,
  };
}
async function files(
  patch: Partial<PersonalDataSubject> = {},
  modules: readonly WaitronModule[] = ALL_MODULES,
): Promise<readonly PersonalDataFile[]> {
  const [entry, ...rest] = timeRecordPersonalData(modules);
  expect(rest).toEqual([]);
  const build = await suite.db.withWriteLock(() => entry!.part.prepare(suite.db, subject(patch)));
  return build();
}
function named(list: readonly PersonalDataFile[], name: string) {
  const file = list.find((f) => f.name === name);
  if (file === undefined) throw new Error(`no ${name}`);
  return file.content;
}
const csvBytes = (list: readonly PersonalDataFile[]) => {
  const content = named(list, "time-record.csv");
  return typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
};
const text = (content: string | Uint8Array) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);
async function existingExport(from: string, before: string, locale: "en" | "es") {
  const app = new Hono();
  mountAttendanceExportApi(
    app,
    { db: suite.db, cfg: { locationId }, exporter: selectTimeRecordExport(ALL_MODULES) },
    logger,
  );
  const query = new URLSearchParams({
    locationId,
    from,
    before,
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
async function pdfText(content: string | Uint8Array) {
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
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

describe("the server's working-time part", () => {
  it("declares the two time-record files under the owner server", () => {
    expect(TIME_RECORD_FILES).toEqual(["time-record.pdf", "time-record.csv"]);
    const parts = timeRecordPersonalData(ALL_MODULES);
    expect(parts.map((p) => [p.owner, p.part.files])).toEqual([["server", TIME_RECORD_FILES]]);
  });

  it("gives the same bytes as the existing own export, in either language", async () => {
    for (const language of ["en", "es"] as const) {
      const built = await files({ language });
      expect(built.map((f) => f.name)).toEqual(["time-record.pdf", "time-record.csv"]);
      const csv = csvBytes(built);
      expect(csv.subarray(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
      expect(csv).toEqual(await existingExport(START, END, language));
      const pdf = named(built, "time-record.pdf");
      expect(pdf).toBeInstanceOf(Uint8Array);
      expect(text(pdf).startsWith("%PDF-")).toBe(true);
    }
  });

  it("starts at her first local day and ends the day after her last entry", async () => {
    const csv = csvBytes(await files());
    expect(csv).toEqual(await existingExport("2026-01-01", END, "en"));
    expect(csv).not.toEqual(await existingExport("2026-01-02", END, "en"));
    expect(csv).not.toEqual(await existingExport(START, "2026-03-20", "en"));
    expect(csv).not.toEqual(await existingExport("2025-12-15", END, "en"));
    expect(text(csv)).toContain("2026-03-20");
  });

  it("runs to the day after the venue's date when that is later than her last entry", async () => {
    const csv = csvBytes(await files({ at: new Date("2026-05-01T12:00:00Z") }));
    expect(csv).toEqual(await existingExport(START, "2026-05-02", "en"));
    expect(csv).not.toEqual(await existingExport(START, END, "en"));
  });

  it("holds only her record", async () => {
    const built = await files();
    const csv = text(named(built, "time-record.csv"));
    const pdf = await pdfText(named(built, "time-record.pdf"));
    expect(pdf).toContain("Marta López");
    for (const content of [csv, pdf]) {
      expect(content).not.toContain(COLLEAGUE_NAME);
      expect(content).not.toContain(colleagueId);
      expect(content).not.toContain("10:07");
      expect(content).not.toContain("11:07");
      expect(content).not.toContain("18:43");
      expect(content).not.toContain("19:43");
    }
  });

  it("builds no files when the node has no location", async () => {
    expect(await files({ locationId: null })).toEqual([]);
  });

  it("adds no part without workforce, nor without workforce-es", () => {
    expect(timeRecordPersonalData(ALL_MODULES.filter((m) => m.name === "workforce-es"))).toEqual(
      [],
    );
    expect(timeRecordPersonalData(ALL_MODULES.filter((m) => m.name !== "workforce"))).toEqual([]);
    expect(timeRecordPersonalData(ALL_MODULES.filter((m) => m.name !== "workforce-es"))).toEqual(
      [],
    );
  });

  it("declares names that are valid and unique beside every module part", () => {
    expect(() =>
      validatePersonalDataParts([
        ...personalDataParts(ALL_MODULES),
        ...timeRecordPersonalData(ALL_MODULES),
      ]),
    ).not.toThrow();
  });
});
