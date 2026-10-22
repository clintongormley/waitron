// The owner's condition for taking the installation code off the recovery sheet and the restore
// form (design §6.7): a restore from an old backup never reuses a name it cannot see. A failing row
// selects a code at or below the unseen name, or (F1) takes a minute ahead of the true time; a
// passing row is refused, or selects a later code.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type ModuleRecoveryFacts,
  type OperationBinding,
} from "@waitron/module";
import {
  createHourPromotionPreparation,
  createHourRecoveryPreparation,
} from "./hour-recovery-preparation.js";
import * as internetClock from "./hour-clock-internet.js";
import * as hourRelease from "./hour-release.js";
import { createSetupHourClock } from "./hour-setup-clock.js";
import type { HourClockObservation } from "./hour-clock.js";
import type { HourHistorySource } from "./hour-history.js";
import type { HourSelectionStore } from "./hour-selection.js";
import { decodeMinuteIdentity, encodeMinuteIdentity } from "./hour-identity.js";
import { FISCAL_OPERATIONS } from "./index.js";

const at = (iso: string) => Date.parse(iso);
const MAIN = "a0000000-0000-4000-8000-000000000008";
const SPARE = "a0000000-0000-4000-8000-000000000009";
const KEY = "old-backup-restore";
const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "restore-old-backup",
  sourceId: "old-archive",
  targetNodeId: MAIN,
};
const operator = { kind: "recovery-key" as const, nodeId: MAIN, eventId: binding.eventId };

const MAIN_SETUP = at("2026-10-16T11:40:00.000Z");
const NEWEST_RECORD = at("2026-10-22T22:30:00.000Z");
const BACKUP_CREATED = at("2026-10-22T23:00:00.000Z");
const SWITCH = at("2026-10-23T19:40:50.000Z");
const TRUE_NOW = at("2026-10-24T09:00:00.000Z");
const RELEASE = at("2026-10-15T00:00:00.000Z");
const BEHIND = at("2026-10-20T10:00:00.000Z");
// Above both backup floors and below the unseen name: only the clock rules stand in the way.
const ABOVE_FLOORS = at("2026-10-23T10:00:00.000Z");
const KNOWN = "0CNNW";
const UNSEEN = "0CZZW";

function row(reference: string, kind: string, nodeId: string, identity: string, ms: number | null) {
  return { reference, kind, ...scope, softwareId: "77", nodeId, identity, recordedAtMs: ms };
}
// What the restore path hands the selection: the backup's history with its newest record as a
// floor (readHourHistoryWithRecordFloor) and the backup's creation time
// (apps/server/src/recovery-preparation.ts, from the selected backup's createdAt).
const backupHistory: HourHistorySource[] = [
  {
    reference: "venue",
    complete: true,
    timeFloorMs: NEWEST_RECORD,
    records: [
      row("registro_sif/1", "activation", MAIN, KNOWN, MAIN_SETUP),
      row("invoice_series/1", "series", MAIN, KNOWN, null),
    ],
  },
  { reference: "backup-created", complete: true, records: [], timeFloorMs: BACKUP_CREATED },
];
const survivingWithSwitch: HourHistorySource = {
  reference: "surviving-venue/switch",
  complete: true,
  records: [row("surviving-venue/switch/registro_sif/2", "activation", SPARE, UNSEEN, SWITCH)],
};
// A live series carries no time, so only the spent-name floor can refuse it.
const survivingLiveSeries: HourHistorySource = {
  reference: "surviving-venue/live",
  complete: true,
  records: [row("surviving-venue/live/invoice_series/2", "series", SPARE, UNSEEN, null)],
};

interface Row {
  box: number;
  browser?: number | null;
  internet?: number | null;
  onBox?: boolean;
  release?: number;
  surviving?: HourHistorySource[];
  promote?: boolean;
}
type Outcome =
  | { refused: string; allowedFromMs?: string }
  | { waitedMs?: number; selected: string }
  | { waiting: number };

function store(): HourSelectionStore {
  let value: unknown = null;
  const history: unknown[] = [];
  return async (_binding, run) =>
    run({
      get value() {
        return structuredClone(value);
      },
      get history() {
        return structuredClone(history);
      },
      async replace(next) {
        value = structuredClone(next);
        history.push(structuredClone(next));
      },
    });
}

const promoteBinding: OperationBinding = {
  ...binding,
  action: "promote",
  eventId: "promote-spare",
  targetNodeId: SPARE,
};

async function restore(c: Row): Promise<Outcome> {
  const operation = c.promote
    ? { binding: promoteBinding, operator: "owner" }
    : { binding, operator };
  let elapsed = 0;
  const monotonic = () => 1000 + elapsed;
  const internet = async (): Promise<HourClockObservation> =>
    c.internet === undefined || c.internet === null
      ? { source: "internet", result: "unavailable", reason: "tls" }
      : {
          source: "internet",
          result: "usable",
          instantMs: c.internet + elapsed,
          uncertaintyMs: 0,
          wallStartedMs: c.box + elapsed,
          wallFinishedMs: c.box + elapsed,
          monotonicStartedMs: monotonic(),
          monotonicFinishedMs: monotonic(),
        };
  const clocks = createSetupHourClock({
    wall: () => c.box + elapsed,
    monotonic,
    internet,
    release: () => c.release ?? RELEASE,
  });
  const facts = {
    scope,
    bases,
    contextKey: KEY,
    history: [...backupHistory, ...(c.surviving ?? [])],
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    priorActivation: "none" as const,
  };
  const preparation = (c.promote ? createHourPromotionPreparation : createHourRecoveryPreparation)({
    withState: store(),
    read: async (_binding, comparisonId) => ({ ...facts, ...clocks.read(KEY, comparisonId) }),
    monotonicNow: monotonic,
  });
  const attempt = async () => {
    const challenge = clocks.challenge(KEY);
    const browser =
      c.browser === null
        ? null
        : { challengeId: challenge.id, instantMs: (c.browser ?? c.box) + elapsed };
    const comparison = await clocks.compare(KEY, scope.environment, browser, {
      onBox: c.onBox ?? false,
    });
    return withOperationAuthority(operation.binding, operation.operator, (authority) =>
      preparation.select({
        binding: operation.binding,
        authority,
        comparisonId: comparison.id,
      }),
    );
  };
  try {
    const first = await attempt();
    if (first.status === "selected") return { selected: first.identity };
    if (first.status !== "waiting") throw new Error(`unexpected ${first.status}`);
    elapsed += first.remainingMs;
    const second = await attempt();
    if (second.status === "selected")
      return { waitedMs: first.remainingMs, selected: second.identity };
    if (second.status !== "waiting") throw new Error(`unexpected ${second.status}`);
    return { waiting: second.remainingMs };
  } catch (error) {
    const params = (error as { params?: { reason?: string; allowedFromMs?: number } }).params;
    if (params?.reason === undefined) throw error;
    return params.allowedFromMs === undefined
      ? { refused: params.reason }
      : { refused: params.reason, allowedFromMs: new Date(params.allowedFromMs).toISOString() };
  }
}

// Drives the hosted restore form's own path (FISCAL_OPERATIONS) up to a disagreeing comparison.
async function hostedComparison(
  box: number,
  run: (
    send: (proposal: unknown) => Promise<unknown>,
    comparison: { id: string; clock: { disagreement: boolean } },
  ) => Promise<void>,
) {
  vi.spyOn(hourRelease, "readHourRelease").mockReturnValue({
    sourceCommit: "a".repeat(40),
    instantMs: RELEASE,
    committedAt: new Date(RELEASE).toISOString(),
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
  vi.spyOn(internetClock, "observeInternetHourClock").mockResolvedValue({
    source: "internet",
    result: "unavailable",
    reason: "tls",
  });
  const facts: ModuleRecoveryFacts = {
    country: "ES",
    taxId: scope.taxpayerNif,
    environment: scope.environment,
    bases,
    contextKey: KEY,
    history: backupHistory,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    priorActivation: "none",
  };
  const host: ModuleOperationHost = {
    environment: {},
    readPublicEvidence: async () => undefined,
    readRecoveryFacts: async () => facts,
    withPreparationState: store(),
    testClock: { wall: () => box, monotonic: () => 1000 },
  };
  const recovery = FISCAL_OPERATIONS.configure!(host).recovery!;
  await withOperationAuthority(binding, operator, async (authority) => {
    const operation = { binding, authority };
    const client = { onBox: false };
    const challenge = (await recovery(operation, { action: "clock-challenge" }, client)) as {
      id: string;
    };
    const comparison = (await recovery(
      operation,
      { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: TRUE_NOW } },
      client,
    )) as { id: string; clock: { disagreement: boolean } };
    await run((proposal) => recovery(operation, proposal, client), comparison);
  });
}

const later = (code: string, than: string) =>
  decodeMinuteIdentity(code) > decodeMinuteIdentity(than);

it("the model's names are the minutes it says", () => {
  expect(encodeMinuteIdentity(MAIN_SETUP)).toBe(KNOWN);
  expect(encodeMinuteIdentity(SWITCH)).toBe(UNSEEN);
  expect(encodeMinuteIdentity(at("2026-10-23T19:43:00Z"))).toBe("0CZZZ");
  expect(encodeMinuteIdentity(at("2026-10-24T09:02:00Z"))).toBe("0D0RY");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refused", () => {
  it("A: a clock before the backup's own floors", async () => {
    const box = at("2026-10-16T10:00:00Z");
    expect(await restore({ box })).toEqual({
      refused: "minute_not_later",
      allowedFromMs: "2026-10-22T23:00:00.000Z",
    });
  });

  it("A2: a clock before the running release", async () => {
    expect(await restore({ box: BEHIND, release: at("2026-10-21T00:00:00Z") })).toEqual({
      refused: "clock_unconfirmed",
    });
  });

  it("A2v: as A2 above the backup's floors", async () => {
    expect(await restore({ box: ABOVE_FLOORS, release: at("2026-10-23T12:00:00Z") })).toEqual({
      refused: "clock_unconfirmed",
    });
  });

  it("B2: a clock days behind a right browser", async () => {
    expect(await restore({ box: BEHIND, browser: TRUE_NOW })).toEqual({
      refused: "clock_disagreement",
    });
  });

  it("B2v: as B2 above the backup's floors", async () => {
    expect(await restore({ box: ABOVE_FLOORS, browser: TRUE_NOW })).toEqual({
      refused: "clock_disagreement",
    });
  });

  it("B2: no proposal confirms a disagreeing comparison", async () => {
    await hostedComparison(ABOVE_FLOORS, async (send, comparison) => {
      expect(comparison.clock.disagreement).toBe(true);
      await expect(
        send({ action: "confirm-clock", comparisonId: comparison.id }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      });
    });
  });

  it.each([
    ["Sv: as S above the backup's floors", ABOVE_FLOORS],
    ["S: as B2, with the old sheet's code still sent", BEHIND],
  ])("%s: a selection carrying an installation code is refused", async (_name, box) => {
    await hostedComparison(box, async (send, comparison) => {
      await expect(
        send({ action: "select", comparisonId: comparison.id, installationCodes: [KNOWN] }),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      });
    });
  });

  // B4b's request comes from the box's own LAN address; Task 5's addressIsBox cases pin that it
  // arrives here as onBox: true, which is all this module sees.
  it.each(["B4a loopback", "B4b the box's own LAN address"])(
    "%s: a browser on the box itself is no second clock",
    async () => {
      expect(await restore({ box: BEHIND, browser: BEHIND, onBox: true })).toEqual({
        refused: "second_clock_missing",
      });
    },
  );

  it("B4v: as B4 above the backup's floors", async () => {
    expect(await restore({ box: ABOVE_FLOORS, browser: ABOVE_FLOORS, onBox: true })).toEqual({
      refused: "second_clock_missing",
    });
  });

  it("D1: a known later name in the surviving database", async () => {
    const box = at("2026-10-23T19:00:00Z");
    expect(await restore({ box, surviving: [survivingWithSwitch] })).toEqual({
      refused: "minute_not_later",
      allowedFromMs: "2026-10-23T19:41:00.000Z",
    });
  });

  it("D1v: a known later name on a live series, with no time", async () => {
    const box = at("2026-10-23T19:00:00Z");
    expect(await restore({ box, surviving: [survivingLiveSeries] })).toEqual({
      refused: "minute_not_later",
      allowedFromMs: "2026-10-23T19:41:00.000Z",
    });
  });

  it("D2: the old database still on the disk", async () => {
    const box = at("2026-10-23T17:00:00Z");
    const surviving: HourHistorySource = {
      reference: "surviving-venue/old",
      complete: true,
      records: [
        row("surviving-venue/old/registro_sif/1", "activation", MAIN, KNOWN, MAIN_SETUP),
        row(
          "surviving-venue/old/invoice_series/1",
          "series",
          MAIN,
          KNOWN,
          at("2026-10-23T18:00:00Z"),
        ),
      ],
    };
    expect(await restore({ box, surviving: [surviving] })).toEqual({
      refused: "minute_not_later",
      allowedFromMs: "2026-10-23T18:00:00.000Z",
    });
  });

  it("W: the box and another device wrong together, below the backup's creation", async () => {
    expect(await restore({ box: BEHIND, browser: BEHIND })).toEqual({
      refused: "minute_not_later",
      allowedFromMs: "2026-10-22T23:00:00.000Z",
    });
  });

  it("D4: a clock days behind the internet's, with no browser", async () => {
    expect(await restore({ box: BEHIND, browser: null, internet: TRUE_NOW })).toEqual({
      refused: "clock_disagreement",
    });
  });

  it("D4v: as D4 above the backup's floors", async () => {
    expect(await restore({ box: ABOVE_FLOORS, browser: null, internet: TRUE_NOW })).toEqual({
      refused: "clock_disagreement",
    });
  });

  it("F1: a promote on a box two hours fast", async () => {
    expect(
      await restore({
        box: at("2026-10-23T21:10:00Z"),
        browser: at("2026-10-23T19:10:00Z"),
        promote: true,
      }),
    ).toEqual({ refused: "clock_disagreement" });
  });
});

describe("selected later than the unseen name", () => {
  it("in the same minute as the unseen name", async () => {
    const outcome = await restore({ box: at("2026-10-23T19:40:55Z") });
    expect(outcome).toEqual({ waitedMs: 125_000, selected: "0CZZZ" });
    expect(later((outcome as { selected: string }).selected, UNSEEN)).toBe(true);
  });

  it("±45 s: the unseen name by a box 45 s fast, this box 45 s slow, a browser 15 s slow", async () => {
    const minute = at("2026-10-23T19:40:00Z");
    const repeats: unknown[] = [];
    for (let phase = 0; phase < 60_000; phase += 500)
      for (let gap = 0; gap <= 10_000; gap += 500) {
        const unseen = encodeMinuteIdentity(minute + phase + 45_000);
        const truth = minute + phase + gap;
        const outcome = await restore({ box: truth - 45_000, browser: truth - 15_000 });
        if (!("selected" in outcome) || !later(outcome.selected, unseen))
          repeats.push({ phase, gap, unseen, outcome });
      }
    expect(repeats).toEqual([]);
  });

  it("±45.5 s control: the disclosed limit repeats the unseen name", async () => {
    const truth = at("2026-10-23T19:40:00Z") + 14_500;
    const unseen = encodeMinuteIdentity(truth + 45_500);
    const outcome = await restore({ box: truth - 45_500, browser: truth - 15_500 });
    expect(outcome).toMatchObject({ selected: unseen });
  });

  it("E1: both clocks right", async () => {
    expect(await restore({ box: TRUE_NOW })).toEqual({ waitedMs: 120_000, selected: "0D0RY" });
  });

  it("E2: both clocks right, the unseen name in the surviving database", async () => {
    expect(await restore({ box: TRUE_NOW, surviving: [survivingWithSwitch] })).toEqual({
      waitedMs: 120_000,
      selected: "0D0RY",
    });
  });
});
