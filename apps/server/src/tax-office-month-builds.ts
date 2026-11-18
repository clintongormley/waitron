import "./errors.js";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { codeOf, type Logger } from "@waitron/server-kit";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { zipStream } from "./download-archive.js";
import { errnoOf } from "./errno.js";
import { SPACE_LOW_BYTES } from "./free-space-watch.js";
import type { JobDefinition } from "./job-runner.js";
import type { TaxOfficeMonth } from "./tax-office-export.js";

export type MonthDownloadView =
  | { status: "none" }
  | { status: "building"; id: string; month: string }
  | { status: "ready"; id: string; month: string; bytes: number; expiresAt: string }
  | { status: "failed"; id: string; month: string; refusal: MonthDownloadRefusal | null };

/** Why a build stopped, when the person can do something about it. */
export interface MonthDownloadRefusal {
  code: "tax_office.space_ran_out";
  params: { writtenBytes: number };
}

export const TAX_OFFICE_KEEP_MS = 3_600_000;
export const TAX_OFFICE_ROOM_BYTES = 256 * 1024 ** 2;
/** How much a build writes between two readings of free space, while there is more room. */
const WRITE_BETWEEN_READINGS_BYTES = 16 * 1024 ** 2;

export interface TaxOfficeMonthBuilds {
  view(personId: string): MonthDownloadView;
  /** Synchronous, so two requests cannot both pass; throws tax_office.export_running (D3). */
  claim(personId: string, month: string): { claimed: boolean; view: MonthDownloadView };
  /** After the request's transaction commits: hands the build its inputs and wakes the job. */
  begin(personId: string, month: TaxOfficeMonth): void;
  /** The request's transaction failed after `claim`. */
  release(personId: string): void;
  /** The person's ready file, only while `id` names the build that made it. */
  file(personId: string, id: string): { path: string; month: string } | null;
  /** The file was sent in full: deletes it and the record. A later id leaves the record alone. */
  sent(personId: string, id: string): void;
  job(): JobDefinition;
}

type Entries = AsyncIterable<{ name: string; content: string | Uint8Array }>;

export interface TaxOfficeMonthBuildsDeps {
  dir: string;
  now: () => Date;
  entries: (month: TaxOfficeMonth, stopIfAsked: () => void) => Entries;
  changed: () => void;
  wake: () => void;
  log: Logger;
  /** Null when unreadable. */
  freeBytes: () => Promise<number | null>;
  keepMs?: number;
}

type BuildRecord =
  | {
      status: "building";
      id: string;
      month: string;
      input: TaxOfficeMonth | null;
      started: boolean;
    }
  | { status: "ready"; id: string; month: string; bytes: number; until: number }
  | {
      status: "failed";
      id: string;
      month: string;
      refusal: MonthDownloadRefusal | null;
      until: number;
    };

export function createTaxOfficeMonthBuilds(deps: TaxOfficeMonthBuildsDeps): TaxOfficeMonthBuilds {
  const keepMs = deps.keepMs ?? TAX_OFFICE_KEEP_MS;
  const records = new Map<string, BuildRecord>();
  const pathOf = (id: string) => join(deps.dir, `${id}.zip`);

  const viewOf = (record: BuildRecord | undefined): MonthDownloadView => {
    if (record === undefined) return { status: "none" };
    const { id, month } = record;
    switch (record.status) {
      case "building":
        return { status: "building", id, month };
      case "ready":
        return {
          status: "ready",
          id,
          month,
          bytes: record.bytes,
          expiresAt: new Date(record.until).toISOString(),
        };
      case "failed":
        return { status: "failed", id, month, refusal: record.refusal };
    }
  };

  // Best-effort: a file that cannot be deleted is logged and left to the next start's scratch
  // sweep, never allowed to keep a record in `building`.
  const remove = async (path: string): Promise<void> => {
    try {
      await rm(path, { force: true });
    } catch (error) {
      deps.log("warn", "tax_office.file_remove_failed", { errno: errnoOf(error) ?? null });
    }
  };

  /** A ready or failed record past its hour is gone to every reader, before a pass deletes it. */
  const live = (personId: string): BuildRecord | undefined => {
    const record = records.get(personId);
    if (record === undefined || record.status === "building") return record;
    return record.until <= deps.now().getTime() ? undefined : record;
  };

  const building = (): [string, Extract<BuildRecord, { status: "building" }>] | null => {
    for (const [personId, record] of records)
      if (record.status === "building") return [personId, record];
    return null;
  };

  const forget = (personId: string, record: BuildRecord): Promise<void> => {
    if (records.get(personId) !== record) return Promise.resolve();
    records.delete(personId);
    deps.changed();
    return record.status === "ready" ? remove(pathOf(record.id)) : Promise.resolve();
  };

  /** Passes the archive through, stopping it before its writing could take free space under
   * the low-space line. */
  function keepingTheReserve(): (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array> {
    let written = 0;
    let allowed = 0;
    return async function* (source) {
      for await (const chunk of source) {
        const bytes = chunk.byteLength;
        if (bytes > allowed) {
          const free = await deps.freeBytes();
          const room = free === null ? WRITE_BETWEEN_READINGS_BYTES : free - SPACE_LOW_BYTES;
          if (free !== null && room < bytes) {
            deps.log("warn", "tax_office.build_space_low", { freeBytes: free });
            throw new AppError("tax_office.space_ran_out", { writtenBytes: written });
          }
          allowed = Math.min(room, Math.max(WRITE_BETWEEN_READINGS_BYTES, bytes));
        }
        allowed -= bytes;
        written += bytes;
        yield chunk;
      }
    };
  }

  async function build(
    personId: string,
    record: Extract<BuildRecord, { status: "building" }>,
    input: TaxOfficeMonth,
    signal: AbortSignal,
  ): Promise<void> {
    const path = pathOf(record.id);
    let outcome: BuildRecord | null = null;
    let out: WriteStream | null = null;
    try {
      await mkdir(deps.dir, { recursive: true });
      const zip = zipStream(
        deps.entries(input, () => signal.throwIfAborted()),
        input.at,
      );
      const source = Readable.fromWeb(zip as WebReadableStream<Uint8Array>);
      const reserve = keepingTheReserve();
      out = createWriteStream(path);
      await pipeline(source, reserve, out);
      signal.throwIfAborted();
      const { size } = await stat(path);
      signal.throwIfAborted();
      outcome = {
        status: "ready",
        id: record.id,
        month: record.month,
        bytes: size,
        until: deps.now().getTime() + keepMs,
      };
    } catch (error) {
      const ranOut = isAppError(error) && hasCode(error, "tax_office.space_ran_out");
      if (!signal.aborted && !ranOut)
        deps.log("error", "tax_office.build_failed", {
          errorCode: codeOf(error),
          errorClass: error instanceof Error ? error.name : typeof error,
          errno: errnoOf(error) ?? null,
        });
      // pipeline can reject while the file is still opening, and an open that finishes after rm
      // creates the file again; destroy covers a writer pipeline never took over.
      const writing = out;
      if (writing !== null && !writing.closed) {
        const closed = new Promise((resolve) => writing.once("close", resolve));
        writing.destroy();
        await closed;
      }
      await remove(path);
      if (!signal.aborted) {
        outcome = {
          status: "failed",
          id: record.id,
          month: record.month,
          refusal: ranOut ? { code: error.code, params: error.params } : null,
          until: deps.now().getTime() + keepMs,
        };
      }
    } finally {
      if (outcome === null) records.delete(personId);
      else records.set(personId, outcome);
      deps.changed();
    }
  }

  async function expire(): Promise<Date | null> {
    const at = deps.now().getTime();
    let next: number | null = null;
    for (const [personId, record] of [...records]) {
      if (record.status === "building") continue;
      if (record.until <= at) {
        await forget(personId, record);
      } else if (next === null || record.until < next) {
        next = record.until;
      }
    }
    return next === null ? null : new Date(next);
  }

  const job: JobDefinition = {
    name: "tax_office.month_zip",
    applies: () => true,
    minSleepMs: 1_000,
    maxSleepMs: 3_600_000,
    backoff: { firstMs: 60_000, maxMs: 3_600_000 },
    async pass({ signal }) {
      const current = building();
      if (current !== null) {
        const [personId, record] = current;
        if (record.input !== null && !record.started) {
          record.started = true;
          await build(personId, record, record.input, signal);
        }
      }
      return { nextDueAt: await expire() };
    },
  };

  return {
    view: (personId) => viewOf(live(personId)),
    claim(personId, month) {
      const current = building();
      if (current !== null) {
        const [holder, record] = current;
        if (holder === personId && record.month === month)
          return { claimed: false, view: viewOf(record) };
        throw new AppError("tax_office.export_running", {});
      }
      const earlier = records.get(personId);
      if (earlier?.status === "ready") void remove(pathOf(earlier.id));
      const record: BuildRecord = {
        status: "building",
        id: randomUUID(),
        month,
        input: null,
        started: false,
      };
      records.set(personId, record);
      deps.changed();
      return { claimed: true, view: viewOf(record) };
    },
    begin(personId, month) {
      const record = records.get(personId);
      if (record?.status !== "building") return;
      record.input = month;
      deps.wake();
    },
    release(personId) {
      const record = records.get(personId);
      if (record?.status === "building" && !record.started) void forget(personId, record);
    },
    file(personId, id) {
      const record = live(personId);
      if (record?.status !== "ready" || record.id !== id) return null;
      return { path: pathOf(record.id), month: record.month };
    },
    sent(personId, id) {
      const record = records.get(personId);
      if (record?.status === "ready" && record.id === id) void forget(personId, record);
    },
    job: () => job,
  };
}
