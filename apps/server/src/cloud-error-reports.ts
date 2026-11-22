import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "@waitron/db";
import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { AppError, INCIDENT_SOURCES } from "@waitron/shared";
import { CLOUD_ERROR_REPORTS_FILE } from "@waitron/store";
import { sql } from "drizzle-orm";
import {
  cloudReportBinding,
  sameCloudReportBinding,
  type CloudReportBinding,
} from "./cloud-report-binding.js";
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
type State = CloudReportBinding & {
  enabled: boolean;
  cursor: Cursor | null;
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
  const binding = cloudReportBinding(db, venueDir, environment, async () =>
    connection?.errorReportRegistration(),
  );
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
    return typeof state.enabled === "boolean" && state.venue === binding.venue()
      ? state
      : undefined;
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
    const current = await binding.current();
    const { registration } = current;
    if (!sameCloudReportBinding(state, current) || !cursorMatches(state.cursor)) {
      state.database = current.database;
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
        const currentBinding = await binding.current(enabled);
        if (!currentBinding.venue) throw new AppError("cloud.not_configured", {});
        await save({
          ...currentBinding,
          venue: currentBinding.venue,
          enabled,
          cursor: enabled ? latest() : null,
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
