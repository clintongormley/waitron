import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isA4Printer, isReceiptPrinter, printers, type Database } from "@waitron/db";
import { cardReaders } from "@waitron/payments";
import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { AppError, INCIDENT_SOURCES, isUuid } from "@waitron/shared";
import { CLOUD_PROBLEM_REPORTS_FILE } from "@waitron/store";
import { and, isNull, or, sql } from "drizzle-orm";
import type { CloudConnection } from "./cloud-client.js";
import { cloudReportBinding, sameCloudReportBinding } from "./cloud-report-binding.js";
import { errnoOf } from "./errno.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";
import type { ProblemReports } from "./problem-report-api.js";
import "./errors.js";

interface Options {
  db: Database;
  stateDir: string;
  venueDir: string;
  environment: string;
  nodeId: string;
  version: string | null;
  paymentsEnabled?: boolean;
  isPrimary: () => boolean;
  now: () => Date;
  log: Logger;
  connection: Pick<CloudConnection, "errorReportRegistration" | "sendStaffReport">;
}

type Binding = { nodeId: string; venue: string; database: string; registration: string };
type Pending = { id: string; body: string };
type Queue = Binding & { pending: Pending[] };
type Preview = Pending & { binding: Binding; expiresAt: number };
type Attempt = { state: Queue; pending: Pending };

const maxPending = 16;
const maxPreviews = 256;
const previewLifetimeMs = 5 * 60_000;
const retryIntervalMs = 30_000;

function stableVersion(version: string | null): version is string {
  return (
    version !== null &&
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) &&
    version.split(".").every((part) => Number(part) <= 2_147_483_647)
  );
}

function sameBinding(saved: Binding, current: Binding | undefined): boolean {
  return !!current && saved.nodeId === current.nodeId && sameCloudReportBinding(saved, current);
}

export function createCloudProblemReports({
  db,
  stateDir,
  venueDir,
  environment,
  nodeId,
  version,
  paymentsEnabled,
  isPrimary,
  now,
  log,
  connection,
}: Options) {
  const file = join(stateDir, CLOUD_PROBLEM_REPORTS_FILE);
  const binding = cloudReportBinding(db, venueDir, environment, connection.errorReportRegistration);
  const previews = new Map<string, Preview>();
  let tail = Promise.resolve();
  let active = false;
  function turn<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async function currentBinding(): Promise<Binding | undefined> {
    const { venue, database, registration } = await binding.current();
    return venue && registration ? { nodeId, venue, database, registration } : undefined;
  }
  async function read(): Promise<Queue | undefined> {
    try {
      const state = JSON.parse(await readFile(file, "utf8")) as Queue;
      if (
        typeof state?.registration !== "string" ||
        !Array.isArray(state.pending) ||
        state.pending.length > maxPending ||
        !state.pending.every((entry) => isUuid(entry?.id) && typeof entry.body === "string")
      )
        throw new AppError("cloud.state_invalid", {});
      return state;
    } catch (error) {
      if (errnoOf(error) === "ENOENT") return undefined;
      if (error instanceof SyntaxError) throw new AppError("cloud.state_invalid", {});
      throw error;
    }
  }
  async function write(state: Queue): Promise<void> {
    await mkdirDurable(dirname(file), 0o700);
    await writeFileDurable(file, JSON.stringify(state), 0o600);
  }
  function attachment(device: string, release: string): string {
    const logs = db
      .all<{ level: "error"; code: string; source: string }>(
        sql`
      select 'error' as level, code, source from incidents
      where severity = 'error'
      order by rowid desc limit 8
    `,
      )
      .filter(
        ({ code, source }) =>
          code.length <= 128 &&
          /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(code) &&
          (INCIDENT_SOURCES as readonly string[]).includes(source),
      );
    const equipment: string[] = [];
    // Both printer kinds share one equipment value in the Cloud attachment.
    if (
      db
        .select({ id: printers.id })
        .from(printers)
        .where(and(or(isReceiptPrinter(), isA4Printer()), isNull(printers.deletedAt)))
        .limit(1)
        .get()
    )
      equipment.push("printer");
    if (
      paymentsEnabled &&
      db
        .select({ id: cardReaders.id })
        .from(cardReaders)
        .where(
          and(
            isNull(cardReaders.deletedAt),
            isNull(cardReaders.disabledAt),
            isNull(cardReaders.unpairedAt),
          ),
        )
        .limit(1)
        .get()
    )
      equipment.push("card_reader");
    return JSON.stringify({
      version: release,
      time: now().getTime(),
      logs,
      details: { device, equipment, upgradedAt: null, hosting: "unknown" },
    });
  }
  async function deliver({ state, pending }: Attempt, signal: AbortSignal) {
    try {
      if (signal.aborted || !isPrimary()) return "retry";
      const outcome = await connection.sendStaffReport(
        state.registration,
        pending.id,
        pending.body,
        signal,
      );
      if (outcome !== "retry") {
        await turn(async () => {
          const latest = await read();
          if (!latest || latest.pending[0]?.id !== pending.id) return;
          await write({ ...latest, pending: latest.pending.slice(1) });
          if (outcome === "stop") log("warn", "cloud.request_invalid");
        });
      }
      return outcome;
    } finally {
      active = false;
    }
  }
  async function run(signal: AbortSignal) {
    const attempt = await turn(async () => {
      if (signal.aborted || active || !isPrimary()) return undefined;
      const state = await read();
      const pending = state?.pending[0];
      if (!state || !pending) return undefined;
      const current = await currentBinding();
      if (signal.aborted || !isPrimary()) return undefined;
      if (!sameBinding(state, current)) {
        await write({ ...state, pending: [] });
        log("warn", "cloud.not_configured");
        return undefined;
      }
      active = true;
      return { state, pending };
    });
    return attempt && deliver(attempt, signal);
  }
  const reports: ProblemReports = {
    async preview(device, sessionId) {
      if (!isPrimary() || !stableVersion(version)) return { available: false };
      const current = await currentBinding();
      if (!current || !isPrimary()) return { available: false };
      const key = device + sessionId;
      const preview = {
        id: randomUUID(),
        body: attachment(device, version),
        binding: current,
        expiresAt: performance.now() + previewLifetimeMs,
      };
      previews.delete(key);
      if (previews.size >= maxPreviews) {
        const oldest = previews.keys().next().value;
        if (oldest !== undefined) previews.delete(oldest);
      }
      previews.set(key, preview);
      return { available: true, id: preview.id, attachment: preview.body };
    },
    async send(device, sessionId, id) {
      const attempt = await turn(async () => {
        const key = device + sessionId;
        const preview = previews.get(key);
        if (preview?.id !== id || preview.expiresAt <= performance.now())
          throw new AppError("cloud.request_invalid", {});
        if (!isPrimary()) throw new AppError("cloud.not_primary", {});
        const current = await currentBinding();
        if (!current || !sameBinding(preview.binding, current))
          throw new AppError("cloud.not_configured", {});
        const saved = await read();
        const pending = saved && sameBinding(saved, current) ? saved.pending : [];
        if (pending.length >= maxPending) throw new AppError("cloud.busy", {});
        if (previews.get(key) !== preview) throw new AppError("cloud.request_invalid", {});
        if (!isPrimary()) throw new AppError("cloud.not_primary", {});
        const report = { id, body: preview.body };
        const state = { ...current, pending: [...pending, report] };
        await write(state);
        if (saved?.pending.length && pending.length === 0) log("warn", "cloud.not_configured");
        if (previews.get(key) === preview) previews.delete(key);
        if (active || pending.length !== 0) return undefined;
        active = true;
        return { state, pending: report };
      });
      if (!attempt) return "queued";
      const result = await deliver(attempt, AbortSignal.timeout(8000));
      if (result === "stop") throw new AppError("cloud.request_invalid", {});
      return result === "sent" ? "sent" : "queued";
    },
  };
  return { ...reports, run };
}

export function cloudProblemReportsJob(
  reports: ReturnType<typeof createCloudProblemReports>,
  isPrimary: () => boolean,
): JobDefinition {
  return {
    name: "cloud.problem_reports",
    applies: isPrimary,
    minSleepMs: retryIntervalMs,
    maxSleepMs: 60_000,
    backoff: { firstMs: retryIntervalMs, maxMs: 300_000 },
    async pass({ signal }) {
      const outcome = await reports.run(signal);
      return { nextDueAt: outcome ? new Date(Date.now() + retryIntervalMs) : null };
    },
  };
}
