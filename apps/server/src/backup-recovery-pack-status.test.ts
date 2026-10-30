import { describe, expect, it } from "vitest";
import type { RecoveryPackPartRecord } from "@waitron/db";
import {
  packStatus,
  type CurrentChecks,
  type PackStatusInput,
  type StatusRecord,
} from "./backup-recovery-pack-status.js";

const DAY = 24 * 60 * 60 * 1000;
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY_1 = "2026-10-01 · first";
const KEY_2 = "2026-10-20 · second";

const included = {
  bucket: {
    part: "bucket",
    state: "included",
    keyChangedAt: "2026-09-20T08:00:00.000Z",
    settingsRevision: "rev-b",
  },
  archives: {
    part: "archives",
    state: "included",
    keyChangedAt: "2026-09-20T08:00:00.000Z",
    settingsRevision: "rev-a",
    destination: "bucket",
  },
  serverKey: (keyName: string, carriedKey: boolean): RecoveryPackPartRecord => ({
    part: "server-key",
    state: "included",
    keyName,
    carriedKey,
  }),
} satisfies Record<string, RecoveryPackPartRecord | ((...args: never[]) => RecoveryPackPartRecord)>;

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
    madeByName: options.name === undefined ? "Marta Puig" : options.name,
    receivedAt: options.received === false ? null : new Date(madeAt),
    parts: options.parts ?? [included.bucket, included.archives, included.serverKey(KEY_1, false)],
  };
}

const current: CurrentChecks = {
  keyChangedAt: "2026-09-20T08:00:00.000Z",
  bucket: { revision: "rev-b" },
  archives: { revision: "rev-a" },
  serverKeyName: KEY_1,
};

const base: PackStatusInput = {
  records: [],
  current,
  retention: { count: 7, days: 30 },
  schedule: { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } },
  backupsUseOlderKey: false,
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
      madeByName: "Marta Puig",
      received: true,
      parts: [
        { part: "bucket", state: "included" },
        { part: "archives", state: "included" },
        { part: "server-key", state: "included" },
      ],
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
      [
        { part: "bucket", kind: "key_changed", at: "2026-10-20T07:00:00.000Z" },
        { part: "archives", kind: "key_changed", at: "2026-10-20T07:00:00.000Z" },
      ],
    ],
    [
      "the bucket settings changed",
      { bucket: { revision: "rev-b2" } },
      [{ part: "bucket", kind: "settings_changed" }],
    ],
    [
      "the archive settings changed",
      { archives: { revision: "rev-a2" } },
      [{ part: "archives", kind: "settings_changed" }],
    ],
    ["the bucket copy was switched off", { bucket: null }, [{ part: "bucket", kind: "removed" }]],
    ["the archives were switched off", { archives: null }, [{ part: "archives", kind: "removed" }]],
    [
      "the server key was replaced",
      { serverKeyName: KEY_2 },
      [{ part: "server-key", kind: "key_replaced" }],
    ],
    [
      "the fiscal module is gone",
      { serverKeyName: undefined },
      [{ part: "server-key", kind: "removed" }],
    ],
  ])("is out of date when %s", (_name, change, reasons) => {
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")], {
      current: { ...current, ...change },
    });
    expect(answer.reasons).toEqual(reasons);
    expect(answer.upToDate).toBe(false);
  });

  it("counts unreadable archive settings as changed, even against a record with no revision", () => {
    const noRevision = { ...included.archives, settingsRevision: undefined };
    for (const archives of [included.archives, noRevision]) {
      const parts = [included.bucket, archives, included.serverKey(KEY_1, false)];
      const answer = status([pack(1, "2026-10-12T10:00:00.000Z", { parts })], {
        current: { ...current, archives: "unreadable" },
      });
      expect(answer.reasons).toEqual([{ part: "archives", kind: "settings_changed" }]);
      expect(answer.upToDate).toBe(false);
    }
  });

  it.each<[RecoveryPackPartRecord["part"], Partial<CurrentChecks>]>([
    ["bucket", {}],
    ["archives", {}],
    ["server-key", {}],
  ])("is out of date when the %s part was absent and is set up now", (part) => {
    const parts = [included.bucket, included.archives, included.serverKey(KEY_1, false)].map((p) =>
      p.part === part ? { part, state: "absent" as const } : p,
    );
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z", { parts })]);
    expect(answer.reasons).toEqual([{ part, kind: "set_up_after" }]);
  });

  it("stays up to date for a part absent then and absent now", () => {
    const parts = [
      { part: "bucket" as const, state: "absent" as const },
      included.archives,
      included.serverKey(KEY_1, false),
    ];
    expect(
      status([pack(1, "2026-10-12T10:00:00.000Z", { parts })], {
        current: { ...current, bucket: null },
      }).upToDate,
    ).toBe(true);
  });

  it("lets the pack's own time stand in for a key never changed, until a change after it", () => {
    const parts = [
      { ...included.bucket, keyChangedAt: "2026-10-12T10:00:00.000Z" },
      { ...included.archives, keyChangedAt: "2026-10-12T10:00:00.000Z" },
      included.serverKey(KEY_1, false),
    ];
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
    ).toHaveLength(2);
  });

  it("is incomplete, and not up to date, when a part failed — as when the box had no backup key yet", () => {
    const parts = [
      { part: "bucket" as const, state: "failed" as const },
      { part: "archives" as const, state: "failed" as const },
      included.serverKey(KEY_1, false),
    ];
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z", { parts })]);
    expect(answer).toMatchObject({ incomplete: true, upToDate: false, reasons: [] });
  });
});

describe("a pack that never reached a browser", () => {
  it("is never up to date and never kept as the server key's holder", () => {
    const answer = status(
      [
        pack(2, "2026-10-20T10:00:00.000Z", {
          received: false,
          parts: [included.bucket, included.archives, included.serverKey(KEY_2, true)],
        }),
      ],
      { current: { ...current, serverKeyName: KEY_2 } },
    );
    expect(answer.upToDate).toBe(false);
    expect(answer.latest!.received).toBe(false);
    expect(answer.unreceived).toEqual({
      number: 2,
      madeAt: "2026-10-20T10:00:00.000Z",
      holdsCurrentServerKey: true,
    });
    expect(answer.keep).toEqual([]);
  });

  it("names a ticked unreceived pack even when a received pack was made after it", () => {
    const answer = status(
      [
        pack(4, "2026-10-22T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_2, false)],
        }),
        pack(3, "2026-10-20T10:00:00.000Z", {
          received: false,
          parts: [included.bucket, included.archives, included.serverKey(KEY_2, true)],
        }),
      ],
      { current: { ...current, serverKeyName: KEY_2 } },
    );
    expect(answer.unreceived).toEqual({
      number: 3,
      madeAt: "2026-10-20T10:00:00.000Z",
      holdsCurrentServerKey: true,
    });
    expect(answer.keep.some((k) => k.number === 3)).toBe(false);
  });

  it("names the newest unreceived pack after the newest received one, as not holding the key", () => {
    const answer = status([
      pack(3, "2026-10-22T10:00:00.000Z", { received: false }),
      pack(2, "2026-10-21T10:00:00.000Z", { received: false }),
      pack(1, "2026-10-12T10:00:00.000Z"),
    ]);
    expect(answer.unreceived).toEqual({
      number: 3,
      madeAt: "2026-10-22T10:00:00.000Z",
      holdsCurrentServerKey: false,
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
});

describe("the packs to keep", () => {
  it("always lists the received pack holding the server key in force, with no date", () => {
    const answer = status([
      pack(2, "2026-10-22T10:00:00.000Z"),
      pack(1, "2026-10-01T10:00:00.000Z", {
        parts: [included.bucket, included.archives, included.serverKey(KEY_1, true)],
      }),
    ]);
    expect(answer.keep).toEqual([
      { number: 1, madeAt: "2026-10-01T10:00:00.000Z", until: null, why: "server_key" },
    ]);
  });

  it("keeps the newest pack with an older backup key until its archives should be gone (daily schedule)", () => {
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status(
      [pack(2, "2026-10-12T10:00:00.000Z"), pack(1, "2026-10-01T10:00:00.000Z")],
      {
        current: { ...current, keyChangedAt: change },
      },
    );
    // min(7 daily archives, 30 days) after the change, plus one interval: 7 + 1 days, over the
    // bucket copy's 7.
    expect(answer.keep).toEqual([
      {
        number: 2,
        madeAt: "2026-10-12T10:00:00.000Z",
        until: new Date(Date.parse(change) + 8 * DAY).toISOString(),
        why: "backup_key",
      },
    ]);
  });

  it("keeps one pack, the newest, for the key that had never been changed when they were made", () => {
    const standIn = (madeAt: string): RecoveryPackPartRecord[] => [
      { ...included.bucket, keyChangedAt: madeAt, keyNeverChanged: true },
      { ...included.archives, keyChangedAt: madeAt, keyNeverChanged: true },
      included.serverKey(KEY_1, false),
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
        until: new Date(Date.parse(change) + 8 * DAY).toISOString(),
        why: "backup_key",
      },
    ]);
  });

  it("takes the longest gap between a weekly schedule's days as its interval", () => {
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")], {
      current: { ...current, keyChangedAt: change },
      schedule: { kind: "wall-clock", days: [1, 3], at: { hour: 3, minute: 0 } },
    });
    // Monday and Wednesday: the longest gap is Wednesday to Monday, 5 days; min(7 × 5, 30) + 5 = 35.
    expect(answer.keep[0]!.until).toBe(new Date(Date.parse(change) + 35 * DAY).toISOString());
  });

  it("uses an interval schedule's own interval, and the age cap when it is sooner", () => {
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")], {
      current: { ...current, keyChangedAt: change },
      schedule: { kind: "interval", ms: 2 * DAY },
      retention: { count: 50, days: 10 },
    });
    expect(answer.keep[0]!.until).toBe(new Date(Date.parse(change) + 12 * DAY).toISOString());
  });

  it("keeps the bucket copy's seven days when the box keeps no archives", () => {
    const change = "2026-10-25T07:00:00.000Z";
    const answer = status([pack(1, "2026-10-12T10:00:00.000Z")], {
      current: { ...current, keyChangedAt: change },
      schedule: undefined,
      retention: undefined,
    });
    expect(answer.keep[0]!.until).toBe(new Date(Date.parse(change) + 7 * DAY).toISOString());
  });

  it("drops a pack whose keep date has passed", () => {
    const parts = [
      { ...included.bucket, keyChangedAt: "2026-08-01T08:00:00.000Z" },
      { ...included.archives, keyChangedAt: "2026-08-01T08:00:00.000Z" },
      included.serverKey(KEY_1, false),
    ];
    const made = pack(1, "2026-08-12T10:00:00.000Z", { parts });
    // A change on 1 September: kept until 9 September, long before now.
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-09-01T07:00:00.000Z" } }).keep,
    ).toEqual([]);
    // The same pack after a recent change is kept, so the empty list above is the date's doing.
    expect(
      status([made], { current: { ...current, keyChangedAt: "2026-10-25T07:00:00.000Z" } }).keep,
    ).toHaveLength(1);
  });

  it("keeps a pack holding a replaced server key until its archives should be gone, from the replacement", () => {
    const answer = status(
      [
        pack(2, "2026-10-25T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_2, true)],
        }),
        pack(1, "2026-10-01T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_1, true)],
        }),
      ],
      { current: { ...current, serverKeyName: KEY_2 } },
    );
    expect(answer.keep).toEqual([
      {
        number: 1,
        madeAt: "2026-10-01T10:00:00.000Z",
        until: new Date(Date.parse("2026-10-25T10:00:00.000Z") + 8 * DAY).toISOString(),
        why: "replaced_server_key",
      },
      { number: 2, madeAt: "2026-10-25T10:00:00.000Z", until: null, why: "server_key" },
    ]);
  });

  it("dates a replaced key from the next pack that made a key, not a later one", () => {
    const KEY_A = "2026-10-24 · between";
    const answer = status(
      [
        pack(3, "2026-10-27T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_2, true)],
        }),
        pack(2, "2026-10-24T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_A, true)],
        }),
        pack(1, "2026-10-01T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_1, true)],
        }),
      ],
      { current: { ...current, serverKeyName: KEY_2 } },
    );
    expect(answer.keep.find((k) => k.number === 1)!.until).toBe(
      new Date(Date.parse("2026-10-24T10:00:00.000Z") + 8 * DAY).toISOString(),
    );
  });

  it("dates a key replaced outside any pack from the day after the new key's name", () => {
    const answer = status(
      [
        pack(1, "2026-10-01T10:00:00.000Z", {
          parts: [included.bucket, included.archives, included.serverKey(KEY_1, true)],
        }),
      ],
      { current: { ...current, serverKeyName: "2026-10-27 · third" } },
    );
    expect(answer.keep).toEqual([
      {
        number: 1,
        madeAt: "2026-10-01T10:00:00.000Z",
        until: new Date(Date.parse("2026-10-28T00:00:00.000Z") + 8 * DAY).toISOString(),
        why: "replaced_server_key",
      },
    ]);
  });
});

describe("backups still on the older key", () => {
  it.each([true, false])("passes %s through", (value) => {
    expect(status([], { backupsUseOlderKey: value }).backupsUseOlderKey).toBe(value);
  });
});
