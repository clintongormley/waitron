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
};

export type PackStatusInput = {
  /** This node's packs, newest first. */
  records: StatusRecord[];
  current: CurrentChecks;
  /** The archives' keeping settings and schedule; `undefined` when the box makes none. */
  retention: { count: number; days: number } | undefined;
  schedule: BackupSchedule | undefined;
  backupsUseOlderKey: boolean;
  /** The pack in `records` that showed the current master key, when one is known. */
  masterKeyPack: number | null;
  now: Date;
};

/** Each reason names only the parts it is given for. */
type Reason =
  | { part: "bucket" | "archives"; kind: "key_changed"; at: string }
  | { part: "bucket" | "archives"; kind: "settings_changed" }
  | { part: "bucket" | "archives"; kind: "set_up_after" }
  | { part: "bucket" | "archives" | "emergency"; kind: "removed" }
  | { part: "emergency"; kind: "code_changed"; at: string }
  | { part: "emergency"; kind: "code_missing" }
  | { part: "emergency"; kind: "cannot_check" };

type Keep = {
  number: number;
  madeAt: string;
  until: string;
  why: "backup_key";
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
    offeredAtSetup?: true;
    holdsCurrentMasterKey?: true;
  };
  reasons: Reason[];
  keep: Keep[];
  backupsUseOlderKey: boolean;
};

const partOf = (record: RecoveryPackRecord, part: RecoveryPackPartRecord["part"]) =>
  record.parts.find((p) => p.part === part);

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
function keepUntil(
  changedAt: number,
  input: Pick<PackStatusInput, "retention" | "schedule">,
): number {
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

/** When a pack made before a key change now could be thrown away, by the rule above. */
export function keepOldPackUntil(
  input: Pick<PackStatusInput, "retention" | "schedule" | "now">,
): string {
  return new Date(keepUntil(input.now.getTime(), input)).toISOString();
}

function keepList(input: PackStatusInput): Keep[] {
  const { records, current, now } = input;
  const keep: Keep[] = [];
  const seenKeys = new Set<string>();
  for (const record of records.filter((r) => r.receivedAt !== null)) {
    const facts = [partOf(record, "bucket"), partOf(record, "archives")].find(
      (p) => p?.state === "included" && p.keyChangedAt !== undefined,
    );
    const recorded = facts?.keyChangedAt;
    // Nothing records a change before the first rotation, so packs made before it count as one key.
    const key = facts?.keyNeverChanged === true ? "never-changed" : recorded;
    if (
      recorded === undefined ||
      key === undefined ||
      current.keyChangedAt === undefined ||
      !later(current.keyChangedAt, recorded) ||
      seenKeys.has(key)
    ) {
      continue;
    }
    seenKeys.add(key);
    const until = keepUntil(Date.parse(current.keyChangedAt), input);
    if (until <= now.getTime()) continue;
    keep.push({
      number: record.number,
      madeAt: record.madeAt.toISOString(),
      until: new Date(until).toISOString(),
      why: "backup_key",
    });
  }
  return keep.sort((a, b) => a.number - b.number);
}

/**
 * The pack showing the current master key is the only copy of the key restore asks for, so a later
 * pack, received or not, never hides that it was not confirmed received.
 */
function unreceivedOf(input: PackStatusInput): PackStatus["unreceived"] {
  const view = (record: RecoveryPackRecord, holdsCurrentMasterKey: boolean) => ({
    number: record.number,
    madeAt: record.madeAt.toISOString(),
    ...(record.madeBy === null ? { offeredAtSetup: true as const } : {}),
    ...(holdsCurrentMasterKey ? { holdsCurrentMasterKey: true as const } : {}),
  });
  const holder = input.records.find(
    (r) => r.receivedAt === null && r.number === input.masterKeyPack,
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
  };
}
