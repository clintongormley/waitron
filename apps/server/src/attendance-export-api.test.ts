import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  IDENTITY_MIGRATIONS,
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
  withPassiveManagementRead,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { WORKFORCE_MIGRATIONS, WorkforceBackend } from "@waitron/workforce";
import { WORKFORCE_ES_RECORD_EXPORT } from "@waitron/workforce-es";
import { jobOrigin } from "@waitron/shared";
import type { ModuleTimeRecordExport } from "@waitron/module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { seedAttendanceExport } from "../test/attendance-export-fixture.js";
import { mountManagementAttendanceApi } from "./management-attendance-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let fixture: Awaited<ReturnType<typeof seedAttendanceExport>>;
let staffCookie: string, managerCookie: string, app: Hono;
const provider = { prepare: vi.fn(WORKFORCE_ES_RECORD_EXPORT.prepare) };
const logger = vi.fn();
function mount(exporter: ModuleTimeRecordExport | undefined = provider) {
  const value = new Hono();
  value.use("/management-api/*", (c, next) =>
    c.req.method === "GET" && c.req.header("x-waitron-live") === "1"
      ? withPassiveManagementRead(next)
      : next(),
  );
  const deps = {
    db: suite.db,
    cfg: { locationId: fixture.locationId, nodeId: fixture.nodeId },
    now: () => new Date(),
    exporter,
  };
  mountManagementAttendanceApi(value, deps, logger);
  return value;
}
async function cookie(personId: string) {
  return withTransaction(
    suite.db,
    async (tx) => `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId })).token}`,
  );
}
beforeEach(async () => {
  fixture = await seedAttendanceExport(suite.db);
  provider.prepare.mockClear();
  logger.mockClear();
  staffCookie = await cookie(fixture.personId);
  managerCookie = await cookie(fixture.managerId);
  app = mount();
});
const base = (mode: "own" | "manager") =>
  mode === "own" ? "/management-api/me/attendance/export" : "/management-api/attendance/export";
function query(patch: Record<string, string> = {}) {
  return new URLSearchParams({
    locationId: fixture.locationId,
    from: "2026-01-01",
    before: "2026-02-01",
    format: "csv",
    audience: "standard",
    locale: "en",
    ...patch,
  });
}
async function ask(
  mode: "own" | "manager" = "own",
  patch: Record<string, string> = {},
  auth = staffCookie,
  target = app,
) {
  return target.request(`${base(mode)}?${query(patch)}`, { headers: { cookie: auth } });
}
const snapshot = () => ({
  entries: suite.db.all(sql`select * from time_entries order by id`),
  heads: suite.db.all(sql`select * from workforce_chains order by node_id, location_id`),
  closures: suite.db.all(sql`select * from pay_period_closures order by id`),
  questions: suite.db.all(sql`select * from attendance_questions order by id`),
  mail: suite.db.all(sql`select * from attendance_mail order by id`),
});
async function fail(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect(response.headers.get("content-disposition")).toBeNull();
}
function heldProvider() {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const exporter: ModuleTimeRecordExport = {
    prepare: async (tx, input) => {
      const format = await WORKFORCE_ES_RECORD_EXPORT.prepare(tx, input);
      return async () => {
        entered();
        await gate;
        return format();
      };
    },
  };
  return { exporter, release, started };
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("writer did not complete before formatter release")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("authenticated working-time downloads", () => {
  it("exports staff's own rich history and frozen snapshots without changing the record", async () => {
    const before = snapshot();
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="time-record-2026-01-01-2026-02-01-standard.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await response.text();
    expect(text).toContain('"540"');
    expect(text).toContain("frozen-history");
    expect(text).toContain("2026-01-05T18:00:00+01:00");
    expect(text).toContain("María Muñoz");
    expect(text).toContain("José");
    expect(text).toContain("ID-NUMBER-CANARY");
    expect(text).not.toContain("CONTACT-CANARY");
    expect(snapshot()).toEqual(before);
    expect(provider.prepare).toHaveBeenCalledTimes(1);
  });
  it.each(["staff", "supervisor"] as const)(
    "refuses %s all-person export before capturing any document",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, fixture.personId));
      await fail(await ask("manager"), 403, "authorization.not_permitted");
      expect(provider.prepare).not.toHaveBeenCalled();
      expect((await ask()).status).toBe(200);
    },
  );
  it.each(["manager", "admin"] as const)(
    "permits %s all and selected exports while suspended subjects remain in history",
    async (role) => {
      await suite.db.update(persons).set({ role }).where(eq(persons.id, fixture.managerId));
      await suite.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, fixture.personId));
      const selections: Record<string, string>[] = [{}, { personId: fixture.personId }];
      for (const patch of selections) {
        const response = await ask("manager", patch, managerCookie);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("María Muñoz");
      }
    },
  );
  it.each(["absent", "ended", "expired", "suspended"] as const)(
    "refuses an %s session on all three routes before preparing or exposing bytes",
    async (kind) => {
      const token = staffCookie.split("=")[1]!;
      if (kind === "ended")
        await suite.db
          .update(managementSessions)
          .set({ endedAt: new Date().toISOString() })
          .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
      if (kind === "expired")
        await suite.db
          .update(managementSessions)
          .set({ lastSeenAt: "2020-01-01T00:00:00Z" })
          .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
      if (kind === "suspended")
        await suite.db
          .update(persons)
          .set({ status: "suspended" })
          .where(eq(persons.id, fixture.personId));
      for (const path of [
        `${base("own")}?${query()}`,
        `${base("manager")}?${query()}`,
        `${base("own")}-options?locationId=${fixture.locationId}`,
      ]) {
        const response = await app.request(path, {
          headers: { cookie: kind === "absent" ? "" : staffCookie },
        });
        await fail(
          response,
          kind === "suspended" ? 403 : 401,
          kind === "suspended"
            ? "person.suspended"
            : kind === "expired"
              ? "management_session.expired"
              : "management_session.required",
        );
      }
      expect(provider.prepare).not.toHaveBeenCalled();
      expect((await ask("manager", {}, managerCookie)).status).toBe(200);
    },
  );
  it("restricts own workplace, allows historical workplace and refuses missing location or person after authority", async () => {
    const [unrelated] = await suite.db
      .insert(locations)
      .values({ name: "Unrelated", invoiceLocales: ["en"], operationDescription: "Sale" })
      .returning();
    await fail(await ask("own", { locationId: unrelated!.id }), 403, "attendance.not_permitted");
    await fail(await ask("own", { locationId: crypto.randomUUID() }), 400, "attendance.invalid");
    await fail(
      await ask("manager", { personId: crypto.randomUUID() }, managerCookie),
      400,
      "attendance.invalid",
    );
    await fail(
      await ask("manager", { personId: crypto.randomUUID() }),
      403,
      "authorization.not_permitted",
    );
    expect(provider.prepare).not.toHaveBeenCalled();
    const alternate = mount();
    // The current appliance location differs; the worker still has history at the selected one.
    const historical = new Hono();
    const deps = {
      db: suite.db,
      cfg: { nodeId: fixture.nodeId, locationId: unrelated!.id },
      now: () => new Date(),
      exporter: provider,
    };
    mountManagementAttendanceApi(historical, deps, logger);
    expect((await ask("own", {}, staffCookie, historical)).status).toBe(200);
    expect((await ask("own", {}, staffCookie, alternate)).status).toBe(200);
  });
  it("never exports a caller-supplied person on the own route", async () => {
    await fail(
      await ask("own", { personId: fixture.managerId }),
      400,
      "management.request_invalid",
    );
    expect(provider.prepare).not.toHaveBeenCalled();
    expect((await ask()).status).toBe(200);
  });
  it("keeps all-person, selected-person and session-person live and frozen rows disjoint", async () => {
    const backend = new WorkforceBackend();
    await withTransaction(suite.db, async (tx) => {
      const common = {
        nodeId: fixture.nodeId,
        locationId: fixture.locationId,
        personId: fixture.managerId,
        offsetMinutes: 0,
        origin: jobOrigin("dashboard"),
      };
      await backend.clockIn(tx, { ...common, at: "2026-01-06T09:00:00Z" });
      await backend.clockOut(tx, { ...common, at: "2026-01-06T10:00:00Z" });
    });
    const all = await (await ask("manager", {}, managerCookie)).text();
    const selected = await (
      await ask("manager", { personId: fixture.managerId }, managerCookie)
    ).text();
    const own = await (await ask()).text();
    expect(all).toContain(fixture.personId);
    expect(all).toContain('"600"');
    expect(selected).not.toContain(fixture.personId);
    expect(selected).toContain('"60"');
    expect(own).toContain('"540"');
    expect(own).not.toContain("2026-01-06T09:00:00");
    const [, ...ownLines] = own.split("\r\n");
    expect(ownLines.filter((line) => line.startsWith('"frozen-sessions"'))).toHaveLength(1);
  });
  it.each(["csv", "pdf"] as const)(
    "serves real %s representatives bytes with links, authors and offsets but no reasons",
    async (format) => {
      const response = await ask(
        "manager",
        { format, audience: "representatives", locale: "es" },
        managerCookie,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      );
      let text: string;
      if (format === "pdf") {
        const loading = getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          useSystemFonts: false,
        });
        const pdf = await loading.promise;
        try {
          const parts = [];
          for (let i = 1; i <= pdf.numPages; i++)
            parts.push(
              (await (await pdf.getPage(i)).getTextContent()).items
                .flatMap((v) => ("str" in v ? [v.str] : []))
                .join(" "),
            );
          text = parts.join(" ");
        } finally {
          await loading.destroy();
        }
      } else text = await response.text();
      expect(text).toContain("María Muñoz");
      expect(text).toContain("José");
      expect(text).toContain("2026-01-05T18:00:00+01:00");
      expect(text).toContain(fixture.nodeId);
      for (const forbidden of ["ID-NUMBER-CANARY", "CONTACT-CANARY", "LOGIN-CANARY"])
        expect(text).not.toContain(forbidden);
    },
  );
  it("keeps passive options from renewing inactivity while a deliberate download is active", async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    await suite.db.update(managementSessions).set({ lastSeenAt: old });
    const response = await app.request(`${base("own")}-options?locationId=${fixture.locationId}`, {
      headers: { cookie: staffCookie, "x-waitron-live": "1" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: true, canExportAll: false });
    expect(
      (await suite.db.select().from(managementSessions)).every((s) => s.lastSeenAt === old),
    ).toBe(true);
    const options = await app.request(`${base("own")}-options?locationId=${fixture.locationId}`, {
      headers: { cookie: managerCookie, "x-waitron-live": "1" },
    });
    expect(await options.json()).toEqual({ available: true, canExportAll: true });
    expect((await ask()).status).toBe(200);
    expect(
      (
        await suite.db
          .select()
          .from(managementSessions)
          .where(eq(managementSessions.personId, fixture.personId))
      )[0]!.lastSeenAt,
    ).not.toBe(old);
  });

  it("keeps the frozen total and reports a later approved change instead of rewriting closure history", async () => {
    const backend = new WorkforceBackend();
    await withTransaction(suite.db, async (tx) => {
      const record = await backend.timeRecord(tx, {
        locationId: fixture.locationId,
        personId: fixture.personId,
        period: { start: "2026-01-01", end: "2026-02-01" },
      });
      const target = record.entries.find((e) => e.entry.entryKind === "out")!.entry.entryId;
      const request = await backend.requestCorrection(tx, {
        nodeId: fixture.nodeId,
        correctsEntryId: target,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 60,
        reason: "LATE-DECISION-MARKER",
        actorPersonId: fixture.personId,
        origin: jobOrigin("dashboard"),
      });
      await backend.approveCorrection(tx, {
        nodeId: fixture.nodeId,
        correctionId: request,
        approverPersonId: fixture.managerId,
      });
    });
    const before = snapshot();
    const response = await ask();
    expect(response.status).toBe(200);
    const rows = (await response.text()).split("\r\n");
    expect(rows.find((r) => r.startsWith('"totals"'))).toContain('"600"');
    expect(rows.find((r) => r.startsWith('"frozen-sessions"'))).toContain('"540"');
    const impacts = rows.filter((r) => r.startsWith('"impacts"'));
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toContain('"540","600","60"');
    expect(rows.filter((r) => r.startsWith('"history"')).join("\n")).toContain(
      "LATE-DECISION-MARKER",
    );
    expect(rows.filter((r) => r.startsWith('"frozen-history"')).join("\n")).not.toContain(
      "LATE-DECISION-MARKER",
    );
    expect(snapshot()).toEqual(before);
  });

  it("keeps adjacent export windows from counting the boundary shift twice", async () => {
    const january = await ask("own", { from: "2020-01-01", before: "2026-01-05" });
    const following = await ask("own", { from: "2026-01-05", before: "2030-01-01" });
    expect(january.status).toBe(200);
    expect(following.status).toBe(200);
    const left = (await january.text()).split("\r\n"),
      right = (await following.text()).split("\r\n");
    expect(left.filter((r) => r.startsWith('"sessions"'))).toHaveLength(0);
    expect(right.filter((r) => r.startsWith('"sessions"'))).toHaveLength(1);
    expect(right.find((r) => r.startsWith('"totals"'))).toContain('"540"');
  });
  it("reports unavailable only after authentication and refuses empty attachments", async () => {
    const disabled = mount({ prepare: provider.prepare });
    const missing = new Hono();
    mountManagementAttendanceApi(
      missing,
      {
        db: suite.db,
        cfg: { nodeId: fixture.nodeId, locationId: fixture.locationId },
        now: () => new Date(),
      },
      logger,
    );
    const options = await missing.request(
      `${base("own")}-options?locationId=${fixture.locationId}`,
      { headers: { cookie: staffCookie } },
    );
    expect(await options.json()).toEqual({ available: false, canExportAll: false });
    const response = await ask("own", {}, staffCookie, missing);
    await fail(response, 404, "attendance.invalid");
    await fail(await ask("own", {}, "", missing), 401, "management_session.required");
    expect(provider.prepare).not.toHaveBeenCalled();
    expect((await ask("own", {}, staffCookie, disabled)).status).toBe(200);
  });
  it("returns JSON if formatting fails and never logs record text", async () => {
    const broken = mount({
      prepare: async () => async () => {
        throw new Error("SECRET-DOCUMENT-REASON");
      },
    });
    await fail(await ask("own", {}, staffCookie, broken), 500, "server.internal");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("SECRET-DOCUMENT-REASON");
  });
  it("releases the snapshot transaction before formatting, so later writes complete and do not change the captured export", async () => {
    const held = heldProvider();
    const delayed = ask("own", {}, staffCookie, mount(held.exporter));
    expect(
      await Promise.race([held.started.then(() => "formatter"), delayed.then(() => "response")]),
    ).toBe("formatter");
    try {
      await deadline(
        withTransaction(suite.db, async (tx) => {
          const common = {
            nodeId: fixture.nodeId,
            locationId: fixture.locationId,
            personId: fixture.personId,
            offsetMinutes: 0,
            origin: jobOrigin("dashboard"),
          };
          const backend = new WorkforceBackend();
          await backend.clockIn(tx, { ...common, at: "2026-01-07T09:00:00Z" });
          await backend.clockOut(tx, { ...common, at: "2026-01-07T10:00:00Z" });
        }),
      );
    } finally {
      held.release();
    }
    const response = await delayed;
    expect(response.status).toBe(200);
    const captured = await response.text();
    expect(captured).toContain('"540"');
    expect(captured).not.toContain("2026-01-07T09:00:00");
    const current = await (await ask()).text();
    expect(current).toContain('"600"');
    expect(current).toContain("2026-01-07T09:00:00");
  });
  it.each(["expired", "ended", "suspended", "demoted", "unchanged"] as const)(
    "rechecks %s authority after formatting before sending bytes",
    async (kind) => {
      const held = heldProvider();
      const delayed = ask("manager", {}, managerCookie, mount(held.exporter));
      expect(
        await Promise.race([held.started.then(() => "formatter"), delayed.then(() => "response")]),
      ).toBe("formatter");
      try {
        await withTransaction(suite.db, async (tx) => {
          if (kind === "expired")
            await tx
              .update(managementSessions)
              .set({ lastSeenAt: "2020-01-01T00:00:00Z" })
              .where(eq(managementSessions.personId, fixture.managerId));
          if (kind === "ended")
            await tx
              .update(managementSessions)
              .set({ endedAt: new Date().toISOString() })
              .where(eq(managementSessions.personId, fixture.managerId));
          if (kind === "suspended")
            await tx
              .update(persons)
              .set({ status: "suspended" })
              .where(eq(persons.id, fixture.managerId));
          if (kind === "demoted")
            await tx
              .update(persons)
              .set({ role: "staff" })
              .where(eq(persons.id, fixture.managerId));
        });
      } finally {
        held.release();
      }
      const response = await delayed;
      if (kind === "unchanged") {
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("María Muñoz");
      } else
        await fail(
          response,
          kind === "suspended" || kind === "demoted" ? 403 : 401,
          kind === "suspended"
            ? "person.suspended"
            : kind === "demoted"
              ? "authorization.not_permitted"
              : kind === "expired"
                ? "management_session.expired"
                : "management_session.required",
        );
    },
  );
});
