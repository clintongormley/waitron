// PGlite: reads on one transaction, no concurrency and no connection-role question.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, markIncidentHandled, recordIncident } from "@waitron/core";
import { hashPin } from "@waitron/identity";
import type { AlertSource } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import { AppError, tillId as brandTillId, type TillId } from "@waitron/shared";
import {
  HANDLED_WINDOW_MS,
  UNCLAIMED,
  alertsVisible,
  claimFor,
  createAlertRegistry,
  readHandledAlerts,
  readOpenAlerts,
} from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import "./errors.js";

const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const NOW = new Date("2026-09-14T12:00:00.000Z");
const noopLog: Logger = () => {};
const registry = createAlertRegistry({
  claims: ALL_ALERT_CLAIMS,
  sources: [],
});
const EVERYTHING = new Set(["fiscal.view", "payments.manage", "diagnostics.view"]);

async function seedVenue(): Promise<{ tillId: TillId }> {
  await seedTenant(db);
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values ('Sala', array['es-ES'], 'Venta en establecimiento') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (location_id, name)
    values (${location.rows[0]!.id}, 'Caja 1') returning id`);
  return { tillId: brandTillId(till.rows[0]!.id) };
}

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Records an incident with an arbitrary code; the registry is what is under test, not the code. */
function raise(
  v: { tillId: TillId },
  code: string,
  severity: "warning" | "error",
  detectedAt: Date,
): Promise<void> {
  return asApp((tx) =>
    recordIncident(tx, {
      tillId: v.tillId,
      error: new AppError(code as never, {} as never),
      severity,
      detectedAt,
    }),
  );
}

describe("claims", () => {
  it("takes the longest matching prefix and falls back to diagnostics", () => {
    const r = createAlertRegistry({
      claims: [
        { prefix: "payment.", area: "payments", permission: "payments.manage" },
        { prefix: "payment.reconcile_", area: "reconcile", permission: "fiscal.view" },
      ],
      sources: [],
    });
    expect(claimFor(r, "payment.reconcile_drift").area).toBe("reconcile");
    expect(claimFor(r, "payment.offline_forward_declined").area).toBe("payments");
    expect(claimFor(r, "printing.mystery")).toEqual(UNCLAIMED);
  });

  it("refuses two claims on the same prefix", () => {
    expect(() =>
      createAlertRegistry({
        claims: [
          { prefix: "payment.", area: "a", permission: "payments.manage" },
          { prefix: "payment.", area: "b", permission: "payments.manage" },
        ],
        sources: [],
      }),
    ).toThrow(/payment\./);
  });

  it("accepts two sources that share an area", () => {
    const a: AlertSource = { area: "fiscal", permission: "fiscal.view", read: async () => [] };
    const b: AlertSource = { area: "fiscal", permission: "fiscal.view", read: async () => [] };
    expect(() => createAlertRegistry({ claims: [], sources: [a, b] })).not.toThrow();
  });

  it("is visible to a session holding only a source's permission", () => {
    const r = createAlertRegistry({
      claims: [],
      sources: [{ area: "backup", permission: "system.manage", read: async () => [] }],
    });
    expect(alertsVisible(r, new Set(["system.manage"]))).toBe(true);
  });

  it("is visible to a session holding any claim or source permission, including diagnostics", () => {
    expect(alertsVisible(registry, new Set(["payments.manage"]))).toBe(true);
    expect(alertsVisible(registry, new Set(["diagnostics.view"]))).toBe(true);
    expect(alertsVisible(registry, new Set(["report.view"]))).toBe(false);
  });
});

describe("readOpenAlerts", () => {
  it("shows a session only the areas it holds", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    await raise(v, "fiscal.registro_rechazado", "error", NOW);
    await raise(v, "chain.verification_failed", "error", NOW);
    await raise(v, "printing.mystery", "warning", NOW);
    const deps = { registry, now: NOW, log: noopLog };
    const paymentsOnly = await asApp((tx) =>
      readOpenAlerts(tx, deps, new Set(["payments.manage"])),
    );
    expect(paymentsOnly.map((a) => a.code)).toEqual(["payment.offline_forward_declined"]);
    const all = await asApp((tx) => readOpenAlerts(tx, deps, EVERYTHING));
    expect(all.map((a) => [a.code, a.area]).sort()).toEqual([
      ["chain.verification_failed", "fiscal"],
      ["fiscal.registro_rechazado", "fiscal"],
      ["payment.offline_forward_declined", "payments"],
      ["printing.mystery", "diagnostics"],
    ]);
  });

  it("builds an event alert from the incident", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    const [incident] = await asApp((tx) => listOpenIncidents(tx));
    const [alert] = await asApp((tx) =>
      readOpenAlerts(tx, { registry, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(alert).toEqual({
      key: `incident:${incident!.id}`,
      kind: "event",
      code: "payment.offline_forward_declined",
      params: {},
      severity: "error",
      since: NOW.toISOString(),
      area: "payments",
    });
  });

  it("puts errors first, then the newest", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined", "warning", new Date(NOW.getTime() - 1_000));
    await raise(v, "fiscal.registro_rechazado", "error", new Date(NOW.getTime() - 5_000));
    await raise(v, "chain.verification_failed", "error", new Date(NOW.getTime() - 2_000));
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(alerts.map((a) => a.code)).toEqual([
      "chain.verification_failed",
      "fiscal.registro_rechazado",
      "payment.offline_forward_declined",
    ]);
  });

  it("puts alerts without a since last and breaks ties by key", async () => {
    const at = "2026-09-14T11:00:00.000Z";
    const source: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async () => [
        // Its key sorts first, so only the null-last rule can put it last.
        { key: "a:0", code: "printing.x", params: {}, severity: "warning", since: null },
        { key: "b:1", code: "printing.x", params: {}, severity: "warning", since: at },
        { key: "a:1", code: "printing.x", params: {}, severity: "warning", since: at },
      ],
    };
    const r = createAlertRegistry({ claims: [], sources: [source] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["diagnostics.view"])),
    );
    expect(alerts.map((a) => a.key)).toEqual(["a:1", "b:1", "a:0"]);
  });

  it("orders since by instant, not by text", async () => {
    const source: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async () => [
        // 11:00Z written with an offset: as text it sorts after 11:30Z, as an instant before it.
        {
          key: "offset",
          code: "printing.x",
          params: {},
          severity: "warning",
          since: "2026-09-14T13:00:00+02:00",
        },
        {
          key: "utc",
          code: "printing.x",
          params: {},
          severity: "warning",
          since: "2026-09-14T11:30:00.000Z",
        },
      ],
    };
    const r = createAlertRegistry({ claims: [], sources: [source] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["diagnostics.view"])),
    );
    expect(alerts.map((a) => a.key)).toEqual(["utc", "offset"]);
  });

  it("asks only the sources whose permission the session holds, and stamps kind and area", async () => {
    const held: AlertSource = {
      area: "printing",
      permission: "payments.manage",
      read: vi.fn(async () => [
        {
          key: "printing.agent_silent:a1",
          code: "printing.agent_silent",
          params: {},
          severity: "warning" as const,
          since: null,
          screen: "printers",
        },
      ]),
    };
    const notHeld: AlertSource = {
      area: "backup",
      permission: "system.manage",
      read: vi.fn(async () => []),
    };
    const r = createAlertRegistry({ claims: [], sources: [held, notHeld] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["payments.manage"])),
    );
    expect(alerts).toEqual([
      {
        key: "printing.agent_silent:a1",
        kind: "ongoing",
        code: "printing.agent_silent",
        params: {},
        severity: "warning",
        since: null,
        screen: "printers",
        area: "printing",
      },
    ]);
    expect(notHeld.read).not.toHaveBeenCalled();
  });

  it("replaces a failing source with source_unavailable and keeps reading the others", async () => {
    const v = await seedVenue();
    const log = vi.fn<Logger>();
    const failing: AlertSource = {
      area: "backup",
      permission: "diagnostics.view",
      // A failed QUERY, not just a throw: without a savepoint it would abort the shared transaction.
      read: async ({ tx }) => {
        await tx.execute(sql`select * from no_such_table`);
        return [];
      },
    };
    const healthy: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async ({ tx }) => {
        await tx.execute(sql`select 1`);
        return [
          {
            key: "printing.jobs_waiting:p1",
            code: "printing.jobs_waiting",
            params: {},
            severity: "error",
            since: null,
          },
        ];
      },
    };
    const r = createAlertRegistry({ claims: [], sources: [failing, healthy] });
    await raise(v, "payment.offline_forward_declined", "warning", NOW);
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log }, new Set(["diagnostics.view"])),
    );
    // This registry claims nothing, so the payment incident shows under diagnostics.
    expect(alerts.map((a) => a.code).sort()).toEqual([
      "alert.source_unavailable",
      "payment.offline_forward_declined",
      "printing.jobs_waiting",
    ]);
    expect(alerts.find((a) => a.code === "alert.source_unavailable")).toEqual({
      key: "alert.source_unavailable:backup",
      kind: "ongoing",
      code: "alert.source_unavailable",
      params: { area: "backup" },
      severity: "error",
      since: NOW.toISOString(),
      area: "backup",
    });
    expect(log).toHaveBeenCalledWith(
      "error",
      "alert.source_unavailable",
      expect.objectContaining({ area: "backup" }),
    );
  });
  it("replaces a source that throws before returning a promise, and keeps reading the others", async () => {
    const throwing: AlertSource = {
      area: "backup",
      permission: "diagnostics.view",
      read: () => {
        throw new AppError("server.internal", {});
      },
    };
    const healthy: AlertSource = {
      area: "printing",
      permission: "diagnostics.view",
      read: async () => [
        {
          key: "printing.jobs_waiting:p1",
          code: "printing.jobs_waiting",
          params: {},
          severity: "error",
          since: null,
        },
      ],
    };
    const r = createAlertRegistry({ claims: [], sources: [throwing, healthy] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["diagnostics.view"])),
    );
    expect(alerts.map((a) => a.key)).toEqual([
      "alert.source_unavailable:backup",
      "printing.jobs_waiting:p1",
    ]);
  });

  it("merges the alerts of two sources sharing an area", async () => {
    const a: AlertSource = {
      area: "fiscal",
      permission: "fiscal.view",
      read: async () => [
        {
          key: "x:1",
          code: "fiscal.submission_stopped",
          params: { count: 1 },
          severity: "error",
          since: null,
        },
      ],
    };
    const b: AlertSource = {
      area: "fiscal",
      permission: "fiscal.view",
      read: async () => [
        {
          key: "fiscal.awaiting_certificate",
          code: "fiscal.awaiting_certificate",
          params: {},
          severity: "error",
          since: null,
        },
      ],
    };
    const r = createAlertRegistry({ claims: [], sources: [a, b] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["fiscal.view"])),
    );
    expect(alerts.map((x) => x.code).sort()).toEqual([
      "fiscal.awaiting_certificate",
      "fiscal.submission_stopped",
    ]);
  });

  it("reports one source_unavailable per area when two sources in it throw", async () => {
    const boom = (): Promise<never> => {
      throw new AppError("server.internal", {});
    };
    const a: AlertSource = { area: "fiscal", permission: "fiscal.view", read: boom };
    const b: AlertSource = { area: "fiscal", permission: "fiscal.view", read: boom };
    const r = createAlertRegistry({ claims: [], sources: [a, b] });
    const alerts = await asApp((tx) =>
      readOpenAlerts(tx, { registry: r, now: NOW, log: noopLog }, new Set(["fiscal.view"])),
    );
    expect(alerts.filter((x) => x.code === "alert.source_unavailable")).toHaveLength(1);
  });
});

describe("readHandledAlerts", () => {
  it("lists handled events from the last 30 days with who handled them", async () => {
    const v = await seedVenue();
    const person = await asApp(async (tx) => {
      const p = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values ('Ada', ${hashPin("1234")}, 'manager') returning id`);
      return p.rows[0]!.id;
    });
    await raise(v, "payment.offline_forward_declined", "error", NOW);
    await raise(v, "fiscal.registro_rechazado", "error", NOW);
    await raise(v, "chain.verification_failed", "error", NOW);
    const open = await asApp((tx) => listOpenIncidents(tx));
    const byCode = new Map(open.map((i) => [i.code, i.id]));
    const mark = (code: string, personId: string, ageMs: number) =>
      asApp((tx) =>
        markIncidentHandled(tx, {
          id: byCode.get(code)!,
          personId,
          handledAt: new Date(NOW.getTime() - ageMs),
        }),
      );
    const DAY = 24 * 60 * 60 * 1000;
    await mark("payment.offline_forward_declined", person, 29 * DAY);
    await mark("fiscal.registro_rechazado", "00000000-0000-4000-8000-00000000abcd", DAY);
    await mark("chain.verification_failed", person, HANDLED_WINDOW_MS + DAY);
    const handled = await asApp((tx) =>
      readHandledAlerts(tx, { registry, now: NOW, log: noopLog }, EVERYTHING),
    );
    expect(handled.map((a) => [a.code, a.handledBy])).toEqual([
      ["fiscal.registro_rechazado", null],
      ["payment.offline_forward_declined", "Ada"],
    ]);
    expect(handled[1]!.handledAt).toBe(new Date(NOW.getTime() - 29 * DAY).toISOString());
    const paymentsOnly = await asApp((tx) =>
      readHandledAlerts(tx, { registry, now: NOW, log: noopLog }, new Set(["payments.manage"])),
    );
    expect(paymentsOnly.map((a) => a.code)).toEqual(["payment.offline_forward_declined"]);
  });
});
