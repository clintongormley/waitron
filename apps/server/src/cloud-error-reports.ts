import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "@waitron/db";
import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { AppError, INCIDENT_SOURCES } from "@waitron/shared";
import { CLOUD_ERROR_REPORTS_FILE } from "@waitron/store";
import { sql } from "drizzle-orm";
import { venueDbIdentity } from "./backup-room-note.js";
import type { CloudConnection } from "./cloud-client.js";
import { errnoOf } from "./errno.js";
import type { JobDefinition } from "./job-runner.js";

interface Options {
  db: Database;
  stateDir: string;
  venueDir: string;
  environment: string;
  connection?: Pick<CloudConnection, "errorReportRegistration" | "sendErrorReport">;
}

type Cursor = { row: string; id: string };
type Occurrence = Cursor & { code: string; source: string; version: string; time: string };
type Pending = { end: Cursor; operationId: string; body: string };
type State = {
  venue: string;
  database: string;
  enabled: boolean;
  cursor: Cursor | null;
  // Absent before the first registration. Null after a registration was lost.
  registration?: string | null;
  pending?: Pending;
};

// A bounded read lets the next pass take the rest of a large run of the same error.
const occurrencesPerReport = 500;
const intervalMs = 10_000;
const sources = new Set<string>(INCIDENT_SOURCES);

export function createCloudErrorReports({
  db,
  stateDir,
  venueDir,
  environment,
  connection,
}: Options) {
  const file = join(stateDir, CLOUD_ERROR_REPORTS_FILE);
  let tail = Promise.resolve();
  let active: AbortController | undefined;
  function turn<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  function venue(): string | undefined {
    const taxpayer = db.get<{ country: string; tax_id: string; created_at: string }>(sql`
      select country, tax_id, created_at from taxpayer where id = 1
    `);
    if (!taxpayer) return undefined;
    // The original taxpayer row survives a backup restore. A new setup for the same taxpayer
    // has a different creation time. The binding stays on the box and is never part of a report.
    return createHash("sha256")
      .update(JSON.stringify([environment, taxpayer.country, taxpayer.tax_id, taxpayer.created_at]))
      .digest("hex");
  }
  async function read(): Promise<State | undefined> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (errnoOf(error) === "ENOENT" || error instanceof SyntaxError) return undefined;
      throw error;
    }
    if (!value || typeof value !== "object") return undefined;
    const state = value as State;
    return typeof state.enabled === "boolean" && state.venue === venue() ? state : undefined;
  }
  async function save(state: State): Promise<void> {
    await mkdirDurable(dirname(file), 0o700);
    await writeFileDurable(file, JSON.stringify(state), 0o600);
  }
  function latest(): Cursor | null {
    return (
      db.get<Cursor>(
        sql`select cast(rowid as text) as row, id from incidents order by rowid desc limit 1`,
      ) ?? null
    );
  }
  async function database(): Promise<string> {
    return JSON.stringify(await venueDbIdentity(venueDir));
  }
  function cursorMatches(cursor: Cursor | null): boolean {
    return (
      cursor === null ||
      db.get<{ id: string }>(sql`
      select id from incidents where rowid = cast(${cursor.row} as integer)
    `)?.id === cursor.id
    );
  }
  async function prepare(): Promise<{ pending: Pending; registration: string } | undefined> {
    if (!connection) return undefined;
    const state = await read();
    if (!state?.enabled) return undefined;
    const currentDatabase = await database();
    const registration = await connection.errorReportRegistration();
    if (
      state.database !== currentDatabase ||
      !cursorMatches(state.cursor) ||
      (state.registration !== undefined && state.registration !== (registration ?? null))
    ) {
      state.database = currentDatabase;
      state.cursor = latest();
      if (state.registration !== undefined || registration !== undefined)
        state.registration = registration ?? null;
      delete state.pending;
      await save(state);
    }
    if (!registration) return undefined;
    if (state.pending) return { pending: state.pending, registration };

    const rows = db.all<Occurrence>(sql`
      select cast(rowid as text) as row, id, code, source, release_version as version, detected_at as time
      from incidents where rowid > cast(${state.cursor?.row ?? "0"} as integer)
        and severity = 'error' and release_version is not null
      order by rowid limit ${occurrencesPerReport}
    `);
    const first = rows[0];
    if (!first) {
      if (state.registration === undefined) {
        state.registration = registration;
        await save(state);
      }
      return undefined;
    }
    let end = first;
    let count = 0;
    let time = Date.parse(first.time);
    for (const row of rows) {
      if (row.code !== first.code || row.source !== first.source || row.version !== first.version)
        break;
      end = row;
      count++;
      time = Math.max(time, Date.parse(row.time));
    }
    state.registration = registration;
    const cursor = { row: end.row, id: end.id };
    if (
      !sources.has(first.source) ||
      !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(first.code) ||
      first.code.length > 128 ||
      !Number.isSafeInteger(time) ||
      time < 0
    ) {
      state.cursor = cursor;
      await save(state);
      return undefined;
    }
    const body = JSON.stringify({
      code: first.code,
      source: first.source,
      version: first.version,
      time,
      count,
      logs: [],
    });
    state.pending = { end: cursor, operationId: randomUUID(), body };
    await save(state);
    return { pending: state.pending, registration };
  }
  return {
    enabled: async () => (await read())?.enabled === true,
    setEnabled: (enabled: boolean, initialiseOnly = false) =>
      turn(async () => {
        const current = await read();
        if (current && (initialiseOnly || current.enabled === enabled)) return current.enabled;
        const binding = venue();
        if (!binding) throw new AppError("cloud.not_configured", {});
        const registration = enabled ? await connection?.errorReportRegistration() : undefined;
        await save({
          venue: binding,
          database: await database(),
          enabled,
          cursor: enabled ? latest() : null,
          registration,
        });
        if (!enabled) active?.abort();
        return enabled;
      }),
    async run(signal: AbortSignal): Promise<boolean> {
      const attempt = await turn(async () => {
        if (signal.aborted || active) return undefined;
        const batch = await prepare();
        if (!batch || signal.aborted) return undefined;
        active = new AbortController();
        return { ...batch, controller: active };
      });
      if (!attempt) return false;
      const { controller, pending, registration } = attempt;
      const request = AbortSignal.any([signal, controller.signal]);
      try {
        if (request.aborted) return false;
        try {
          await connection!.sendErrorReport(
            registration,
            pending.operationId,
            pending.body,
            request,
          );
        } catch (error) {
          if (request.aborted) return false;
          if (!(error instanceof AppError && error.code === "cloud.request_invalid")) throw error;
        }
        await turn(async () => {
          const state = await read();
          if (request.aborted || state?.pending?.operationId !== pending.operationId) return;
          state.cursor = pending.end;
          delete state.pending;
          await save(state);
        });
        return true;
      } finally {
        active = undefined;
      }
    },
  };
}

export function cloudErrorReportsJob(
  reports: ReturnType<typeof createCloudErrorReports>,
  isPrimary: () => boolean,
): JobDefinition {
  return {
    name: "cloud.error_reports",
    applies: isPrimary,
    minSleepMs: intervalMs,
    maxSleepMs: 60_000,
    backoff: { firstMs: 30_000, maxMs: 300_000 },
    async pass({ signal }) {
      const sent = await reports.run(signal);
      return { nextDueAt: sent ? new Date(Date.now() + intervalMs) : null };
    },
  };
}
