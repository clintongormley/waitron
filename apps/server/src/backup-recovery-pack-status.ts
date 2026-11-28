import type { RecoveryPackPartRecord, RecoveryPackRecord } from "@waitron/db";
import type { BackupSchedule } from "./backup-config.js";

const DAY = 24 * 60 * 60 * 1000;
/** How long the bucket copy keeps what it sent under an older key. */
const BUCKET_COPY_KEEP = 7 * DAY;

export type StatusRecord = RecoveryPackRecord & { madeByName: string | null };

export type PackStatusInput = {
  /** This node's packs, newest first. */
  records: StatusRecord[];
  current: { cloudOpen?: boolean };
  backupsUseOlderKey: boolean;
  /** The packs in `records` that showed the current master key, newest first. */
  masterKeyPacks: readonly number[];
};

type Reason = { part: "emergency"; kind: "set_up_after" };

export type PackStatus = {
  latest: null | {
    number: number;
    madeAt: string;
    madeByName: string | null;
    received: boolean;
    parts: {
      part: RecoveryPackPartRecord["part"];
      state: RecoveryPackPartRecord["state"];
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
  keep: [];
  backupsUseOlderKey: boolean;
};

const partOf = (record: RecoveryPackRecord, part: RecoveryPackPartRecord["part"]) =>
  record.parts.find((p) => p.part === part);

function reasonsFor(record: RecoveryPackRecord, current: PackStatusInput["current"]): Reason[] {
  return current.cloudOpen === true && partOf(record, "emergency")?.state !== "included"
    ? [{ part: "emergency", kind: "set_up_after" }]
    : [];
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
 * When a pack made before a master-key change now could be thrown away: archives made before it
 * still need the old master key until the sweep, which keeps the `count` newest archives and none
 * older than `days`, checked after each new one is stored, has removed the last of them. Taking the
 * change itself for the newest archive made with the old key errs later.
 */
export function keepOldPackUntil(input: {
  /** The archives' keeping settings and schedule; `undefined` when the box makes none. */
  retention: { count: number; days: number } | undefined;
  schedule: BackupSchedule | undefined;
  now: Date;
}): string {
  const changedAt = input.now.getTime();
  let until = changedAt + BUCKET_COPY_KEEP;
  if (input.retention !== undefined && input.schedule !== undefined) {
    const every = interval(input.schedule);
    const gone =
      Math.min(changedAt + input.retention.count * every, changedAt + input.retention.days * DAY) +
      every;
    until = Math.max(until, gone);
  }
  return new Date(until).toISOString();
}

const holdersIn = (records: readonly RecoveryPackRecord[], numbers: readonly number[]) =>
  records.filter((r) => numbers.includes(r.number));

/** The pack to name as holding the current master key: the newest received one, else the newest. */
export function namedMasterKeyPack(
  records: readonly RecoveryPackRecord[],
  masterKeyPacks: readonly number[],
): number | null {
  const holders = holdersIn(records, masterKeyPacks);
  return (holders.find((r) => r.receivedAt !== null) ?? holders[0])?.number ?? null;
}

/**
 * The box keeps no copy of the key restore asks for, so while no pack showing the current master
 * key was confirmed received, a later pack, received or not, never hides the newest that showed it.
 */
function unreceivedOf(input: PackStatusInput): PackStatus["unreceived"] {
  const view = (record: RecoveryPackRecord, holdsCurrentMasterKey: boolean) => ({
    number: record.number,
    madeAt: record.madeAt.toISOString(),
    ...(record.madeBy === null ? { offeredAtSetup: true as const } : {}),
    ...(holdsCurrentMasterKey ? { holdsCurrentMasterKey: true as const } : {}),
  });
  const holders = holdersIn(input.records, input.masterKeyPacks);
  const holder = holders[0];
  if (holder !== undefined && holders.every((r) => r.receivedAt === null))
    return view(holder, true);
  const newest = input.records[0];
  return newest !== undefined && newest.receivedAt === null ? view(newest, false) : null;
}

export function packStatus(input: PackStatusInput): PackStatus {
  const latest = input.records[0];
  const reasons = latest === undefined ? [] : reasonsFor(latest, input.current);
  // A failed `emergency` entry is the retired emergency page's; while Cloud is open, `reasonsFor`
  // already says the pack lacks the Cloud QR code.
  const incomplete =
    latest?.parts.some((p) => p.state === "failed" && p.part !== "emergency") ?? false;
  return {
    latest:
      latest === undefined
        ? null
        : {
            number: latest.number,
            madeAt: latest.madeAt.toISOString(),
            madeByName: latest.madeByName,
            received: latest.receivedAt !== null,
            parts: latest.parts.map(({ part, state }) => ({ part, state })),
          },
    upToDate:
      latest !== undefined && latest.receivedAt !== null && !incomplete && reasons.length === 0,
    incomplete,
    unreceived: unreceivedOf(input),
    reasons,
    keep: [],
    backupsUseOlderKey: input.backupsUseOlderKey,
  };
}
