import { describe, expect, it } from "vitest";
import type { MasterKeyRecord, RecoveryPackPartRecord } from "@waitron/db";
import type { BackupSchedule } from "./backup-config.js";
import { masterKeyHolders } from "./backup-recovery-pack-output.js";
import {
  keepOldPackUntil,
  packStatus,
  type CurrentChecks,
  type PackStatusInput,
  type StatusRecord,
} from "./backup-recovery-pack-status.js";

const DAY = 24 * 60 * 60 * 1000;
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const included = {
  bucket: {
    part: "bucket",
    state: "included",
    keyChangedAt: "2026-09-20T08:00:00.000Z",
    settingsRevision: "rev-b",
  },
} satisfies Record<string, RecoveryPackPartRecord>;

function pack(
  number: number,
  madeAt: string,
  options: { received?: boolean; parts?: RecoveryPackPartRecord[]; name?: string | null } = {},
): StatusRecord {
  return {
    nodeId: NODE,
    number,
    madeAt: new Date(madeAt),
    madeBy: "person",
    madeByName: options.name === undefined ? "Martha Green" : options.name,
    receivedAt: options.received === false ? null : new Date(madeAt),
    parts: options.parts ?? [included.bucket],
  };
}

const current: CurrentChecks = {
  keyChangedAt: "2026-09-20T08:00:00.000Z",
  bucket: { revision: "rev-b" },
};

const base: PackStatusInput = {
  records: [],
  current,
  backupsUseOlderKey: false,
  masterKeyPacks: [],
  now: new Date("2026-10-30T09:00:00.000Z"),
};

/** Newest first, as `readRecoveryPacks` answers. */
const status = (records: StatusRecord[], over: Partial<PackStatusInput> = {}) =>
  packStatus({ ...base, records, ...over });

describe("the latest pack", () => {
  it("is null with nothing made", () => {
    expect(status([])).toMatchObject({
      latest: null,
      upToDate: false,
      incomplete: false,
      unreceived: null,
      reasons: [],
      keep: [],
    });
  });

  it("is up to date when received and nothing changed since", () => {
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")]);
    expect(answer.latest).toEqual({
      number: 1,
      madeAt: "2026-10-12T10:00:00.000Z",
      madeByName: "Martha Green",
      received: true,
      parts: [{ part: "bucket", state: "included" }],
    });
    expect(answer).toMatchObject({ upToDate: true, incomplete: false, reasons: [] });
  });

  it("names nobody when the person who made it is gone", () => {
    expect(
      status([pack(1, "2026-10-12T10:00:00.000Z", { name: null })]).latest!.madeByName,
    ).toBeNull();
  });

  it.each<[string, Partial<CurrentChecks>, { part: string; kind: string; at?: string }[]]>([
    [
      "the backup key changed",
      { keyChangedAt: "2026-10-20T07:00:00.000Z" },
      [{ part: "bucket", kind: "key_changed", at: "2026-10-20T07:00:00.000Z" }],
    ],
    [
      "the bucket settings changed",
      { bucket: { revision: "rev-b2" } },
      [{ part: "bucket", kind: "settings_changed" }],
    ],
    ["the bucket copy was switched off", { bucket: null }, [{ part: "bucket", kind: "removed" }]],
  ])("is out of date when %s", (_name, change, reasons) => {
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")], {
      current: { ...current, ...change },
    });
    expect(answer.reasons).toEqual(reasons);
    expect(answer.upToDate).toBe(false);
  });

  it("is out of date when the bucket part was absent and is set up now", () => {
    const parts = [{ part: "bucket" as const, state: "absent" as const }];
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z", { parts })]);
    expect(answer.reasons).toEqual([{ part: "bucket", kind: "set_up_after" }]);
  });

  it("stays up to date for a part absent then and absent now", () => {
    const parts = [{ part: "bucket" as const, state: "absent" as const }];
    expect(
      status([pack(1, "2026-10-12T10:00:00.000Z", { parts })], {
        current: { ...current, bucket: null },
      }).upToDate,
    ).toBe(true);
  });

  it("lets the pack's own time stand in for a key never changed, until a change after it", () => {
    const parts = [{ ...included.bucket, keyChangedAt: "2026-10-12T10:00:00.000Z" }];
    const made = pack(1, "2026-10-12T10:00:00.000Z", { parts });
    expect(status([made], { current: { ...current, keyChangedAt: undefined } }).upToDate).toBe(
      true,
    );
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-10-12T09:00:00.000Z" } })
        .upToDate,
    ).toBe(true);
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-10-13T09:00:00.000Z" } }).reasons,
    ).toEqual([{ part: "bucket", kind: "key_changed", at: "2026-10-13T09:00:00.000Z" }]);
  });

  it("is incomplete, and not up to date, when a part failed — as when the box had no backup key yet", () => {
    const parts = [{ part: "bucket" as const, state: "failed" as const }];
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z", { parts })]);
    expect(answer).toMatchObject({ incomplete: true, upToDate: false, reasons: [] });
  });
});

describe("a pack no browser confirmed receiving", () => {
  it("is never up to date and never kept", () => {
    const answer = status([
      pack(2, "2026-10-20T10:00:00.000Z", {
        received: false,
      }),
    ]);
    expect(answer.upToDate).toBe(false);
    expect(answer.latest!.received).toBe(false);
    expect(answer.unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-20T10:00:00.000Z",
    });
    expect(answer.keep).toEqual([]);
  });

  it("identifies an unconfirmed setup PDF without treating it as received", () => {
    const madeAt = "2026-10-20T10:00:00.000Z";
    const offered = {
      ...pack(1, madeAt, { received: false, parts: [], name: null }),
      madeBy: null,
    };
    const answer = status([offered]);
    expect(answer.latest?.received).toBe(false);
    expect(answer.unreceived).toEqual({
      number: 1,
      madeAt,
      offeredAtSetup: true,
    });
  });

  it("names the newest unreceived pack after the newest received one", () => {
    const answer = status([
      pack(3, "2026-10-22T10:00:00.000Z", { received: false }),
      pack(2, "2026-10-21T10:00:00.000Z", { received: false }),
      pack(1, "2026-10-12T10:00:00.000Z"),
    ]);
    expect(answer.unreceived).toEqual({
      number: 3,
      madeAt: "2026-10-22T10:00:00.000Z",
    });
  });

  it("is not named once a received pack was made after it", () => {
    expect(
      status([
        pack(2, "2026-10-22T10:00:00.000Z"),
        pack(1, "2026-10-12T10:00:00.000Z", { received: false }),
      ]).unreceived,
    ).toBeNull();
  });

  it("is still named when it shows the current master key, though a received pack was made after it", () => {
    const answer = status(
      [
        pack(3, "2026-10-22T10:00:00.000Z"),
        pack(2, "2026-10-12T10:00:00.000Z", { received: false }),
        pack(1, "2026-10-01T10:00:00.000Z"),
      ],
      { masterKeyPacks: [2] },
    );
    expect(answer.unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-12T10:00:00.000Z",
      holdsCurrentMasterKey: true,
    });
  });

  it("names the master key's pack before a newer unreceived pack", () => {
    expect(
      status(
        [
          pack(3, "2026-10-22T10:00:00.000Z", { received: false }),
          pack(2, "2026-10-12T10:00:00.000Z", { received: false }),
        ],
        { masterKeyPacks: [2] },
      ).unreceived,
    ).toEqual({ number: 2, madeAt: "2026-10-12T10:00:00.000Z", holdsCurrentMasterKey: true });
  });

  it("says the newest unreceived pack holds the current master key only when it does", () => {
    const records = [pack(2, "2026-10-22T10:00:00.000Z", { received: false })];
    expect(status(records, { masterKeyPacks: [2] }).unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-22T10:00:00.000Z",
      holdsCurrentMasterKey: true,
    });
    expect(status(records, { masterKeyPacks: [1] }).unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-22T10:00:00.000Z",
    });
  });

  it("names a lost reprint of the master key plainly once an earlier pack holding it was received", () => {
    const answer = status(
      [
        pack(2, "2026-10-22T10:00:00.000Z", { received: false }),
        pack(1, "2026-10-01T10:00:00.000Z"),
      ],
      { masterKeyPacks: [2, 1] },
    );
    expect(answer.unreceived).toEqual({ number: 2, madeAt: "2026-10-22T10:00:00.000Z" });
  });

  it("names the newest pack holding the master key when none holding it was received", () => {
    const answer = status(
      [
        pack(3, "2026-10-22T10:00:00.000Z", { received: false }),
        pack(2, "2026-10-12T10:00:00.000Z", { received: false }),
      ],
      { masterKeyPacks: [3, 2] },
    );
    expect(answer.unreceived).toEqual({
      number: 3,
      madeAt: "2026-10-22T10:00:00.000Z",
      holdsCurrentMasterKey: true,
    });
  });

  it("counts a received older pack made at the master key's instant as holding it beside a reprint", () => {
    const keyMadeAt = "2026-10-01T10:00:00.000Z";
    const key: MasterKeyRecord = {
      number: 1,
      name: "Key 1",
      checkValue: "check",
      publicKey: new Uint8Array(),
      madeAt: new Date(keyMadeAt),
      madeBy: "person",
    };
    const reprint = pack(2, "2026-10-22T10:00:00.000Z", {
      received: false,
      parts: [
        included.bucket,
        { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: "Key 1" },
      ],
    });
    const older = pack(1, keyMadeAt);
    const records = [reprint, older];
    const holders = masterKeyHolders(key, records);
    expect(holders).toEqual([2, 1]);
    expect(status(records, { masterKeyPacks: holders }).unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-22T10:00:00.000Z",
    });
    expect(masterKeyHolders(key, [older])).toEqual([1]);
    expect(masterKeyHolders(key, [older, pack(3, keyMadeAt)])).toEqual([]);
  });

  it("does not count a pack showing an abandoned key that took the current key's row number", () => {
    const key: MasterKeyRecord = {
      number: 1,
      name: "Key 1",
      checkValue: "check",
      publicKey: new Uint8Array(),
      madeAt: new Date("2026-10-01T10:05:00.000Z"),
      madeBy: null,
    };
    const abandoned = pack(1, "2026-10-01T10:00:00.000Z", {
      parts: [
        { part: "master-key", state: "included", masterKeyNumber: 1, masterKeyName: "Key 0" },
      ],
    });
    expect(masterKeyHolders(key, [abandoned])).toEqual([]);
  });

  it("says nothing of a received pack that shows the current master key", () => {
    const answer = status(
      [pack(2, "2026-10-22T10:00:00.000Z"), pack(1, "2026-10-01T10:00:00.000Z")],
      { masterKeyPacks: [1] },
    );
    expect(answer.unreceived).toBeNull();
    expect(answer.keep).toEqual([]);
  });
});

describe("the packs to keep", () => {
  it("keeps the newest pack with an older backup key until the bucket copy's seven days have passed", () => {
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status(
      [pack(2, "2026-10-12T10:00:00.000Z"), pack(1, "2026-10-01T10:00:00.000Z")],
      {
        current: { ...current, keyChangedAt: change },
      },
    );
    expect(answer.keep).toEqual([
      {
        number: 2,
        madeAt: "2026-10-12T10:00:00.000Z",
        until: new Date(Date.parse(change) + 7 * DAY).toISOString(),
        why: "backup_key",
      },
    ]);
  });

  it("keeps one pack, the newest, for the key that had never been changed when they were made", () => {
    const standIn = (madeAt: string): RecoveryPackPartRecord[] => [
      { ...included.bucket, keyChangedAt: madeAt, keyNeverChanged: true },
    ];
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status(
      [
        pack(2, "2026-10-12T10:00:00.000Z", { parts: standIn("2026-10-12T10:00:00.000Z") }),
        pack(1, "2026-10-01T10:00:00.000Z", { parts: standIn("2026-10-01T10:00:00.000Z") }),
      ],
      { current: { ...current, keyChangedAt: change } },
    );
    expect(answer.keep).toEqual([
      {
        number: 2,
        madeAt: "2026-10-12T10:00:00.000Z",
        until: new Date(Date.parse(change) + 7 * DAY).toISOString(),
        why: "backup_key",
      },
    ]);
  });

  it("drops a pack whose keep date has passed", () => {
    const parts = [{ ...included.bucket, keyChangedAt: "2026-08-01T08:00:00.000Z" }];
    const made = pack(1, "2026-08-12T10:00:00.000Z", { parts });
    // A change on 1 September: kept until 8 September, long before now.
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-09-01T07:00:00.000Z" } }).keep,
    ).toEqual([]);
    // The same pack after a recent change is kept, so the empty list above is the date's doing.
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-10-25T07:00:00.000Z" } }).keep,
    ).toHaveLength(1);
  });
});

describe("a backup-key change", () => {
  const change = "2026-10-25T07:00:00.000Z";
  const archivesPart = {
    part: "archives",
    state: "included",
    keyChangedAt: "2026-09-20T08:00:00.000Z",
    settingsRevision: "rev-a",
    destination: "bucket",
  } satisfies RecoveryPackPartRecord;

  it("a backup-key change does not mark a pack out of date for archives", () => {
    const onlyArchives = pack(1, "2026-10-12T10:00:00.000Z", {
      parts: [{ part: "bucket", state: "absent" }, archivesPart],
    });
    const answer = status([onlyArchives], {
      current: { ...current, keyChangedAt: change, bucket: null },
    });
    expect(answer.reasons).toEqual([]);
    expect(answer.upToDate).toBe(true);
    expect(answer.keep).toEqual([]);
  });

  it("with a bucket copy, a backup-key change still marks the pack out of date and names the pack to keep until the bucket copy's date", () => {
    const answer = status(
      [pack(1, "2026-10-12T10:00:00.000Z", { parts: [included.bucket, archivesPart] })],
      { current: { ...current, keyChangedAt: change } },
    );
    expect(answer.reasons).toEqual([{ part: "bucket", kind: "key_changed", at: change }]);
    expect(answer.upToDate).toBe(false);
    expect(answer.keep).toEqual([
      {
        number: 1,
        madeAt: "2026-10-12T10:00:00.000Z",
        until: new Date(Date.parse(change) + 7 * DAY).toISOString(),
        why: "backup_key",
      },
    ]);
  });
});

describe("the date a pack made before a master-key change can go", () => {
  const now = new Date("2026-10-25T07:00:00.000Z");
  const daily = { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } } as const;
  const after = (days: number) => new Date(now.getTime() + days * DAY).toISOString();

  it("waits until the archives made before it should be gone (daily schedule)", () => {
    // min(7 daily archives, 30 days) after the change, plus one interval: 7 + 1 days, over the
    // bucket copy's 7.
    expect(keepOldPackUntil({ retention: { count: 7, days: 30 }, schedule: daily, now })).toBe(
      after(8),
    );
  });

  it("takes the longest gap between a weekly schedule's days as its interval", () => {
    const schedule: BackupSchedule = {
      kind: "wall-clock",
      days: [1, 3],
      at: { hour: 3, minute: 0 },
    };
    // Monday and Wednesday: the longest gap is Wednesday to Monday, 5 days; min(7 × 5, 30) + 5 = 35.
    expect(keepOldPackUntil({ retention: { count: 7, days: 30 }, schedule, now })).toBe(after(35));
  });

  it("uses an interval schedule's own interval, and the age cap when it is sooner", () => {
    const schedule = { kind: "interval", ms: 2 * DAY } as const;
    expect(keepOldPackUntil({ retention: { count: 50, days: 10 }, schedule, now })).toBe(after(12));
  });

  it("keeps the bucket copy's seven days when the box keeps no archives", () => {
    expect(keepOldPackUntil({ retention: undefined, schedule: undefined, now })).toBe(after(7));
  });

  it("keeps the bucket copy's seven days when the archives should be gone sooner", () => {
    // min(5 daily archives, 30 days) plus one interval is 6 days, under the bucket copy's 7.
    expect(keepOldPackUntil({ retention: { count: 5, days: 30 }, schedule: daily, now })).toBe(
      after(7),
    );
  });
});

describe("backups still on the older key", () => {
  it.each([true, false])("passes %s through", (value) => {
    expect(status([], { backupsUseOlderKey: value }).backupsUseOlderKey).toBe(value);
  });
});

describe("the Cloud QR code", () => {
  const made = "2026-10-12T09:00:00.000Z";
  it.each([
    ["printed, Cloud open", true, "included", []],
    ["printed, Cloud closed, stale or unreadable", false, "included", []],
    ["printed, no Cloud", undefined, "included", []],
    ["not printed, Cloud open", true, "absent", [{ part: "emergency", kind: "set_up_after" }]],
    [
      "a pack made before the Cloud entry existed, Cloud open",
      true,
      "unrecorded",
      [{ part: "emergency", kind: "set_up_after" }],
    ],
    [
      "an older pack whose emergency page failed, Cloud open",
      true,
      "failed",
      [{ part: "emergency", kind: "set_up_after" }],
    ],
    ["an older pack whose emergency page failed, Cloud closed", false, "failed", []],
    ["not printed, Cloud closed, stale or unreadable", false, "absent", []],
    ["not printed, no Cloud", undefined, "absent", []],
  ] as const)("%s", (_label, cloudOpen, state, reasons) => {
    const record = pack(1, made, {
      parts: state === "unrecorded" ? [] : [{ part: "emergency", state }],
    });
    const answer = status([record], { current: { ...current, cloudOpen } });
    expect(answer.reasons).toEqual(reasons);
    expect(answer.incomplete).toBe(false);
    expect(answer.upToDate).toBe(reasons.length === 0);
  });

  it("answers an older record's issue date as nothing more than its part and state", () => {
    const older = { part: "emergency", state: "included", codeIssuedAt: made };
    const answer = status([pack(1, made, { parts: [older as RecoveryPackPartRecord] })]);
    expect(answer.latest!.parts).toEqual([{ part: "emergency", state: "included" }]);
  });
});
