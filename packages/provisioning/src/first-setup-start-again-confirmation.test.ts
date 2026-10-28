import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  START_AGAIN_CONFIRMATIONS_DIR,
  startAgainSummary,
  writeStartAgainConfirmation,
} from "./first-setup-start-again-confirmation.js";
import type { FirstSetupState } from "./first-setup-state.js";

const dirs: string[] = [];
async function stateDir() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-confirmation-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Attempt = { history: { kind: string }[]; result: unknown };
function state(current: Attempt, previous: Attempt[] = []): FirstSetupState {
  const shape = (attempt: Attempt) => ({
    result: attempt.result,
    history: attempt.history.map((event, index) => ({
      kind: event.kind,
      revision: index + 1,
      ownerGeneration: 1,
    })),
  });
  return { ...shape(current), previous: previous.map(shape) } as unknown as FirstSetupState;
}
const events = (...kinds: string[]): Attempt => ({
  history: kinds.map((kind) => ({ kind })),
  result: null,
});

it.each([
  ["no events past claiming", state(events("claim", "input", "checked", "recover")), "claimed"],
  ["candidates", state(events("claim", "candidates")), "named"],
  ["import", state(events("claim", "import")), "named"],
  ["consumption-intent", state(events("claim", "consumption-intent")), "named"],
  [
    "activation-started",
    state(events("claim", "candidates", "activation-started")),
    "fiscal-started",
  ],
  ["uncertain", state(events("claim", "uncertain")), "fiscal-started"],
  ["committed", state(events("claim", "activation-started", "committed")), "fiscal-finished"],
  ["publication", state(events("claim", "publication")), "fiscal-finished"],
  ["complete", state(events("claim", "complete")), "fiscal-finished"],
  ["a non-null result", state({ history: [{ kind: "claim" }], result: {} }), "fiscal-finished"],
  [
    "an event found only in a previous attempt",
    state(events("claim"), [events("claim", "activation-started")]),
    "fiscal-started",
  ],
  [
    "a result found only in a previous attempt",
    state(events("claim", "candidates"), [{ history: [], result: { done: true } }]),
    "fiscal-finished",
  ],
] as const)("%s reaches %s", (_label, value, reached) => {
  expect(startAgainSummary(value, null)).toEqual({ reached, lastName: null });
});

it("passes lastName through unread", () => {
  expect(startAgainSummary(state(events("claim")), "0CNQT")).toEqual({
    reached: "claimed",
    lastName: "0CNQT",
  });
  expect(startAgainSummary(state(events("claim")), "not a series name")).toEqual({
    reached: "claimed",
    lastName: "not a series name",
  });
});

const record = {
  at: "2026-10-24T13:50:12.000Z",
  attemptId: "6f0c9a3e-1b2d-4c5e-8f70-123456789abc",
  database: "missing" as const,
  administrator: { displayName: "Elena Garcia", email: "elena@example.com" },
  ownerGeneration: 3,
  shown: { reached: "fiscal-finished" as const, lastName: "0CNQT" },
};
const name = `${Date.parse(record.at)}-${record.attemptId}.json`;

it("a confirmation record round-trips with exactly D3a's keys", async () => {
  const dir = await stateDir();
  expect(await writeStartAgainConfirmation(dir, record)).toBe(name);
  const text = await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8");
  const stored = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(stored)).toEqual([
    "version",
    "at",
    "attemptId",
    "database",
    "administrator",
    "ownerGeneration",
    "shown",
  ]);
  expect(stored).toEqual({ version: 1, ...record });
  expect(Object.keys(stored.administrator as object)).toEqual(["displayName", "email"]);
  expect(Object.keys(stored.shown as object)).toEqual(["reached", "lastName"]);
  expect(START_AGAIN_CONFIRMATIONS_DIR).toBe("first-setup-start-again-confirmations");
});

it("keeps only D3a's keys when handed extra ones", async () => {
  const dir = await stateDir();
  await writeStartAgainConfirmation(dir, {
    ...record,
    administrator: { ...record.administrator, passwordHash: "x" },
    shown: { ...record.shown, extra: 1 },
    extra: true,
  } as typeof record);
  const stored = JSON.parse(
    await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8"),
  ) as unknown;
  expect(stored).toEqual({ version: 1, ...record });
});

it("two confirmations for one attempt are two files", async () => {
  const dir = await stateDir();
  const first = await writeStartAgainConfirmation(dir, record);
  const second = await writeStartAgainConfirmation(dir, {
    ...record,
    at: "2026-10-24T13:50:12.001Z",
    shown: { reached: "claimed", lastName: null },
  });
  expect(second).not.toBe(first);
  expect((await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR))).sort()).toEqual(
    [first, second].sort(),
  );
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, first), "utf8")),
  ).toEqual({ version: 1, ...record });
});

it("an existing file of the same name is refused, not overwritten", async () => {
  const dir = await stateDir();
  await mkdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR));
  await writeFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "kept");
  await expect(writeStartAgainConfirmation(dir, record)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
    params: {},
  });
  expect(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")).toBe("kept");
});

it("a second write of the same record is refused and the first kept", async () => {
  const dir = await stateDir();
  await writeStartAgainConfirmation(dir, record);
  await expect(
    writeStartAgainConfirmation(dir, { ...record, ownerGeneration: 4 }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")),
  ).toEqual({ version: 1, ...record });
});

it("a record over 16 KiB is refused setup.attempt_invalid and writes nothing", async () => {
  const dir = await stateDir();
  await expect(
    writeStartAgainConfirmation(dir, {
      ...record,
      administrator: { displayName: "x".repeat(16 * 1024), email: "elena@example.com" },
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
  expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
});

it.each([
  ["an unparseable time", { at: "yesterday" }],
  ["a time not in canonical form", { at: "2026-10-24T13:50:12Z" }],
  ["an attempt id that is not a UUID", { attemptId: "../escape" }],
  ["a database other than missing or present", { database: "gone" }],
  ["a negative owner generation", { ownerGeneration: -1 }],
  ["a fractional owner generation", { ownerGeneration: 1.5 }],
  ["an unknown reached", { shown: { reached: "sold", lastName: null } }],
  ["a numeric last name", { shown: { reached: "claimed", lastName: 1 } }],
  ["an empty display name", { administrator: { displayName: "", email: "e@x" } }],
  ["a missing email", { administrator: { displayName: "Elena" } }],
  ["a missing administrator", { administrator: null }],
  ["a missing shown", { shown: undefined }],
])("refuses %s and writes nothing", async (_label, change) => {
  const dir = await stateDir();
  await expect(
    writeStartAgainConfirmation(dir, { ...record, ...change } as unknown as typeof record),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
  expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
});

it("refuses a state folder it cannot look inside, and writes nothing", async () => {
  const dir = await stateDir();
  const file = join(dir, "not-a-folder");
  await writeFile(file, "kept");
  await expect(writeStartAgainConfirmation(file, record)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
    params: {},
  });
  expect(await readFile(file, "utf8")).toBe("kept");
});

it("a confirmation that showed a damaged recovery record keeps that in the record", async () => {
  const dir = await stateDir();
  const damaged = { ...record, shown: { ...record.shown, recoveryRecordDamaged: true as const } };
  await writeStartAgainConfirmation(dir, damaged);
  const stored = JSON.parse(
    await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8"),
  ) as Record<string, unknown>;
  expect(stored).toEqual({ version: 1, ...damaged });
  expect(Object.keys(stored.shown as object)).toEqual([
    "reached",
    "lastName",
    "recoveryRecordDamaged",
  ]);
});

it.each([false, "yes"])(
  "a recoveryRecordDamaged other than true (%s) is refused setup.attempt_invalid and writes nothing",
  async (recoveryRecordDamaged) => {
    const dir = await stateDir();
    await expect(
      writeStartAgainConfirmation(dir, {
        ...record,
        shown: { ...record.shown, recoveryRecordDamaged },
      } as unknown as typeof record),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
    expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
  },
);

const recovery = {
  startedAt: "2026-10-24T13:40:00.000Z",
  lastActiveAt: "2026-10-24T13:44:00.000Z",
  lastActiveSource: "memory" as const,
  lastName: "0CNQW",
  failed: false,
  cloud: true,
};

it("a confirmation that showed a stopped backup recovery keeps it, and only its keys", async () => {
  const dir = await stateDir();
  const shown = { ...record.shown, recovery };
  await writeStartAgainConfirmation(dir, {
    ...record,
    shown: { ...shown, recovery: { ...recovery, extra: 1 } },
  } as typeof record);
  const stored = JSON.parse(
    await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8"),
  ) as { shown: { recovery: object } };
  expect(stored).toEqual({ version: 1, ...record, shown });
  expect(Object.keys(stored.shown.recovery)).toEqual([
    "startedAt",
    "lastActiveAt",
    "lastActiveSource",
    "lastName",
    "failed",
    "cloud",
  ]);
});

it("a confirmation that showed a stopped backup recovery with no name keeps it with no name", async () => {
  const dir = await stateDir();
  const shown = { ...record.shown, recovery: { ...recovery, lastName: null } };
  await writeStartAgainConfirmation(dir, { ...record, shown } as typeof record);
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")),
  ).toEqual({ version: 1, ...record, shown });
});

it.each([
  ["not an object", null],
  ["a start time not in canonical form", { ...recovery, startedAt: "2026-10-24T13:40:00Z" }],
  ["an unparseable last activity", { ...recovery, lastActiveAt: "soon" }],
  ["an unknown activity source", { ...recovery, lastActiveSource: "disk" }],
  ["an empty last name", { ...recovery, lastName: "" }],
  ["a missing last name", { ...recovery, lastName: undefined }],
  ["a last name other than text", { ...recovery, lastName: 5 }],
  ["a failed other than a boolean", { ...recovery, failed: "no" }],
  ["a missing Cloud flag", { ...recovery, cloud: undefined }],
])(
  "a shown recovery with %s is refused setup.attempt_invalid and writes nothing",
  async (_label, value) => {
    const dir = await stateDir();
    await expect(
      writeStartAgainConfirmation(dir, {
        ...record,
        shown: { ...record.shown, recovery: value },
      } as unknown as typeof record),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
    expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
  },
);

it("a record with the database present is written when it showed a stopped backup recovery", async () => {
  const dir = await stateDir();
  const present = { ...record, database: "present", shown: { ...record.shown, recovery } };
  await writeStartAgainConfirmation(dir, present as typeof record);
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")),
  ).toEqual({ version: 1, ...present });
});

it("a record with the database present that showed no backup recovery is refused setup.attempt_invalid and writes nothing", async () => {
  const dir = await stateDir();
  await expect(
    writeStartAgainConfirmation(dir, {
      ...record,
      database: "present",
    } as unknown as typeof record),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
  expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
});

const unreadable = {
  records: ["series-picks", "public-record", "fiscal-documents"] as const,
  floorMs: 1_792_162_020_000,
};

it.each([
  ["all three records", unreadable],
  ["one record", { records: ["public-record"] as const, floorMs: unreadable.floorMs }],
])(
  "a confirmation that showed unreadable name records (%s) keeps them in the record",
  async (_label, shownUnreadable) => {
    const dir = await stateDir();
    const shown = {
      ...record.shown,
      recoveryRecordDamaged: true as const,
      unreadable: shownUnreadable,
    };
    await writeStartAgainConfirmation(dir, { ...record, shown });
    const stored = JSON.parse(
      await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8"),
    ) as { shown: { unreadable: object } };
    expect(stored).toEqual({ version: 1, ...record, shown });
    expect(Object.keys(stored.shown)).toEqual([
      "reached",
      "lastName",
      "recoveryRecordDamaged",
      "unreadable",
    ]);
    expect(Object.keys(stored.shown.unreadable)).toEqual(["records", "floorMs"]);
  },
);

it("a confirmation that discards a stopped recovery past unreadable name records keeps both", async () => {
  const dir = await stateDir();
  const present = {
    ...record,
    database: "present" as const,
    shown: { ...record.shown, recovery, unreadable },
  };
  await writeStartAgainConfirmation(dir, present);
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")),
  ).toEqual({ version: 1, ...present });
});

it("a record with the database present is written when it showed a damaged picks file and no backup recovery", async () => {
  const dir = await stateDir();
  const present = {
    ...record,
    database: "present" as const,
    shown: {
      ...record.shown,
      unreadable: { records: ["series-picks"] as const, floorMs: unreadable.floorMs },
    },
  };
  await writeStartAgainConfirmation(dir, present);
  expect(
    JSON.parse(await readFile(join(dir, START_AGAIN_CONFIRMATIONS_DIR, name), "utf8")),
  ).toEqual({ version: 1, ...present });
});

it.each([
  ["missing records", { floorMs: unreadable.floorMs }],
  ["empty records", { records: [], floorMs: unreadable.floorMs }],
  ["an unknown record name", { records: ["node-key"], floorMs: unreadable.floorMs }],
  ["a repeated record", { records: ["series-picks", "series-picks"], floorMs: unreadable.floorMs }],
  [
    "records out of order",
    { records: ["public-record", "series-picks"], floorMs: unreadable.floorMs },
  ],
  ["records other than a list", { records: "series-picks", floorMs: unreadable.floorMs }],
  ["an extra key", { ...unreadable, extra: 1 }],
  ["a missing floor", { records: unreadable.records }],
  ["a text floor", { ...unreadable, floorMs: String(unreadable.floorMs) }],
  ["a fractional floor", { ...unreadable, floorMs: 1.5 }],
  ["null", null],
])(
  "a shown unreadable with %s is refused setup.attempt_invalid and writes nothing",
  async (_label, value) => {
    const dir = await stateDir();
    await expect(
      writeStartAgainConfirmation(dir, {
        ...record,
        shown: { ...record.shown, unreadable: value },
      } as unknown as typeof record),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid", params: {} });
    expect(await readdir(join(dir, START_AGAIN_CONFIRMATIONS_DIR)).catch(() => [])).toEqual([]);
  },
);
