import type { RecoveryPackPartRecord, RecoveryPackRecord } from "@waitron/db";
import type { BackupSchedule } from "./backup-config.js";

const DAY = 24 * 60 * 60 * 1000;
/** How long the bucket copy keeps what it sent under an older key. */
const BUCKET_COPY_KEEP = 7 * DAY;

export type StatusRecord = RecoveryPackRecord & { madeByName: string | null };

/** What each part's checks read now. */
export type CurrentChecks = {
  /** The backup key's latest change time; `undefined` when nothing has changed it. */
  keyChangedAt: string | undefined;
  /** Undefined without an applicable Cloud read; null when current facts could not be checked. */
  emergency?: { asOf: string; open: boolean; codeIssuedAt: string | null } | null;
  /** `null` when the box has no bucket copy. */
  bucket: { revision: string } | null;
  /** `null` when the box makes no archives. */
  archives: { revision: string } | "unreadable" | null;
  /** `undefined` on a venue that files no invoices; `null` when the box has no server key. */
  serverKeyName: string | null | undefined;
};

export type PackStatusInput = {
  /** This node's packs, newest first. */
  records: StatusRecord[];
  current: CurrentChecks;
  /** The archives' keeping settings and schedule; `undefined` when the box makes none. */
  retention: { count: number; days: number } | undefined;
  schedule: BackupSchedule | undefined;
  backupsUseOlderKey: boolean;
  now: Date;
};

/** Each reason names only the parts it is given for. */
type Reason =
  | { part: "bucket" | "archives"; kind: "key_changed"; at: string }
  | { part: "bucket" | "archives"; kind: "settings_changed" }
  | { part: "bucket" | "archives" | "server-key"; kind: "set_up_after" }
  | { part: "bucket" | "archives" | "server-key" | "emergency"; kind: "removed" }
  | { part: "emergency"; kind: "code_changed"; at: string }
  | { part: "emergency"; kind: "code_missing" }
  | { part: "emergency"; kind: "cannot_check" }
  | { part: "server-key"; kind: "key_replaced" };

type Keep = {
  number: number;
  madeAt: string;
  until: string | null;
  why: "server_key" | "backup_key" | "replaced_server_key";
};

export type PackStatus = {
  latest: null | {
    number: number;
    madeAt: string;
    madeByName: string | null;
    received: boolean;
    parts: {
      part: RecoveryPackPartRecord["part"];
      state: RecoveryPackPartRecord["state"];
      codeIssuedAt?: string;
    }[];
  };
  upToDate: boolean;
  incomplete: boolean;
  unreceived: null | {
    number: number;
    madeAt: string;
    holdsCurrentServerKey: boolean;
    offeredAtSetup?: true;
  };
  reasons: Reason[];
  keep: Keep[];
  backupsUseOlderKey: boolean;
  /** The box's server key now: `none` on a venue that files no invoices, `not_yet` when the box has no server key. */
  serverKey: "none" | "not_yet" | "set";
};

const partOf = (record: RecoveryPackRecord, part: RecoveryPackPartRecord["part"]) =>
  record.parts.find((p) => p.part === part);

/** The pack made the server key named `keyName`. */
export const carriesServerKey = (record: RecoveryPackRecord, keyName: string | null | undefined) =>
  keyName !== null &&
  keyName !== undefined &&
  record.parts.some(
    (p) => p.part === "server-key" && p.carriedKey === true && p.keyName === keyName,
  );

const later = (a: string, b: string) => Date.parse(a) > Date.parse(b);

function reasonsFor(record: RecoveryPackRecord, current: CurrentChecks): Reason[] {
  const reasons: Reason[] = [];
  for (const part of ["bucket", "archives"] as const) {
    const recorded = partOf(record, part);
    const now = current[part];
    if (recorded === undefined || recorded.state === "failed") continue;
    if (recorded.state !== "included") {
      if (now !== null) reasons.push({ part, kind: "set_up_after" });
      continue;
    }
    if (now === null) {
      reasons.push({ part, kind: "removed" });
      continue;
    }
    if (now === "unreadable" || recorded.settingsRevision !== now.revision)
      reasons.push({ part, kind: "settings_changed" });
    if (
      current.keyChangedAt !== undefined &&
      recorded.keyChangedAt !== undefined &&
      later(current.keyChangedAt, recorded.keyChangedAt)
    ) {
      reasons.push({ part, kind: "key_changed", at: current.keyChangedAt });
    }
  }
  const serverKey = partOf(record, "server-key");
  if (serverKey?.state === "included") {
    if (current.serverKeyName === undefined) reasons.push({ part: "server-key", kind: "removed" });
    else if (current.serverKeyName !== serverKey.keyName) {
      reasons.push({ part: "server-key", kind: "key_replaced" });
    }
  } else if (serverKey !== undefined && serverKey.state !== "failed") {
    if (typeof current.serverKeyName === "string") {
      reasons.push({ part: "server-key", kind: "set_up_after" });
    }
  }
  const recorded = partOf(record, "emergency");
  if (recorded?.state === "failed") return reasons;
  const emergency = current.emergency;
  if (recorded?.state === "included") {
    if (!emergency?.open || emergency.codeIssuedAt !== recorded.codeIssuedAt) {
      if (emergency == null || !later(emergency.asOf, record.madeAt.toISOString()))
        reasons.push({ part: "emergency", kind: "cannot_check" });
      else if (!emergency.open) reasons.push({ part: "emergency", kind: "removed" });
      else reasons.push({ part: "emergency", kind: "code_changed", at: emergency.codeIssuedAt! });
    }
  } else if (emergency?.open) reasons.push({ part: "emergency", kind: "code_missing" });
  return reasons;
}

/** The longest wait between two backups the schedule asks for. */
function interval(schedule: BackupSchedule): number {
  if (schedule.kind === "interval") return schedule.ms;
  if (schedule.days === "daily") return DAY;
  const days = schedule.days;
  let longest = 7 - days[days.length - 1]! + days[0]!;
  for (let i = 1; i < days.length; i++) longest = Math.max(longest, days[i]! - days[i - 1]!);
  return longest * DAY;
}

/**
 * When the last archive made before a key change at `changedAt` should be gone: the sweep keeps the
 * `count` newest archives and none older than `days`, checked after each new one is stored. Taking
 * the change itself for the newest archive made with the old key errs later.
 */
function keepUntil(changedAt: number, input: PackStatusInput): number {
  let until = changedAt + BUCKET_COPY_KEEP;
  if (input.retention !== undefined && input.schedule !== undefined) {
    const every = interval(input.schedule);
    const gone =
      Math.min(changedAt + input.retention.count * every, changedAt + input.retention.days * DAY) +
      every;
    until = Math.max(until, gone);
  }
  return until;
}

/** The day after the key name's own day, which a replacement outside any pack is dated by. */
function replacedOn(keyName: string, now: Date): number {
  const day = Date.parse(`${keyName.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(day) ? day + DAY : now.getTime();
}

function keepList(input: PackStatusInput): Keep[] {
  const { records, current, now } = input;
  const kept = new Map<number, Keep>();
  const add = (record: RecoveryPackRecord, why: Keep["why"], until: number | null) => {
    if (until !== null && until <= now.getTime()) return;
    const entry = {
      number: record.number,
      madeAt: record.madeAt.toISOString(),
      until: until === null ? null : new Date(until).toISOString(),
      why,
    };
    const before = kept.get(record.number);
    if (
      before === undefined ||
      entry.until === null ||
      (before.until !== null && entry.until > before.until)
    ) {
      kept.set(record.number, entry);
    }
  };
  const received = records.filter((r) => r.receivedAt !== null);
  const seenKeys = new Set<string>();
  for (const record of received) {
    const facts = [partOf(record, "bucket"), partOf(record, "archives")].find(
      (p) => p?.state === "included" && p.keyChangedAt !== undefined,
    );
    const recorded = facts?.keyChangedAt;
    // Nothing records a change before the first rotation, so packs made before it count as one key.
    const key = facts?.keyNeverChanged === true ? "never-changed" : recorded;
    if (
      recorded !== undefined &&
      key !== undefined &&
      current.keyChangedAt !== undefined &&
      later(current.keyChangedAt, recorded) &&
      !seenKeys.has(key)
    ) {
      seenKeys.add(key);
      add(record, "backup_key", keepUntil(Date.parse(current.keyChangedAt), input));
    }
    const serverKey = partOf(record, "server-key");
    if (serverKey?.carriedKey !== true) continue;
    if (serverKey.keyName === current.serverKeyName) {
      add(record, "server_key", null);
      continue;
    }
    const replacement = records
      .filter((r) => r.number > record.number && partOf(r, "server-key")?.carriedKey === true)
      .at(-1);
    const replacedAt =
      replacement !== undefined
        ? replacement.madeAt.getTime()
        : typeof current.serverKeyName === "string"
          ? replacedOn(current.serverKeyName, now)
          : now.getTime();
    add(record, "replaced_server_key", keepUntil(replacedAt, input));
  }
  return [...kept.values()].sort((a, b) => a.number - b.number);
}

function unreceivedOf(input: PackStatusInput): PackStatus["unreceived"] {
  const view = (record: RecoveryPackRecord, holdsCurrentServerKey: boolean) => ({
    number: record.number,
    madeAt: record.madeAt.toISOString(),
    holdsCurrentServerKey,
    ...(record.madeBy === null ? { offeredAtSetup: true as const } : {}),
  });
  const holder = input.records.find(
    (r) => r.receivedAt === null && carriesServerKey(r, input.current.serverKeyName),
  );
  if (holder !== undefined) return view(holder, true);
  const newest = input.records[0];
  return newest !== undefined && newest.receivedAt === null ? view(newest, false) : null;
}

export function packStatus(input: PackStatusInput): PackStatus {
  const latest = input.records[0];
  const reasons = latest === undefined ? [] : reasonsFor(latest, input.current);
  const incomplete = latest?.parts.some((p) => p.state === "failed") ?? false;
  return {
    latest:
      latest === undefined
        ? null
        : {
            number: latest.number,
            madeAt: latest.madeAt.toISOString(),
            madeByName: latest.madeByName,
            received: latest.receivedAt !== null,
            parts: latest.parts.map(({ part, state, codeIssuedAt }) => ({
              part,
              state,
              ...(codeIssuedAt === undefined ? {} : { codeIssuedAt }),
            })),
          },
    upToDate:
      latest !== undefined && latest.receivedAt !== null && !incomplete && reasons.length === 0,
    incomplete,
    unreceived: unreceivedOf(input),
    reasons,
    keep: keepList(input),
    backupsUseOlderKey: input.backupsUseOlderKey,
    serverKey:
      input.current.serverKeyName === undefined
        ? "none"
        : input.current.serverKeyName === null
          ? "not_yet"
          : "set",
  };
}
