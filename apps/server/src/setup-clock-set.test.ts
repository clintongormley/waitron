import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { TrustedReading } from "@waitron/fiscal";
import type { ModuleClockSetRequest } from "@waitron/module";
import { CORE_MIGRATIONS, incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { SETUP_CLOCK_STEP_FILE } from "@waitron/store";
import type { ClockServiceStatus, ClockSetAnswer } from "./box-host-client.js";
import { createSetupClockSet, raiseSetupClockSteps } from "./setup-clock-set.js";

const H = 3_600_000;
const START_MS = Date.parse("2026-10-31T10:00:00.000Z");
const ADMIN = { id: "0b6f1c1e-7f2a-4a35-9c1d-2f0e5a8b9c10", name: "Luis" };

const UNSYNCHRONISED: ClockServiceStatus = {
  available: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: null,
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "setup-clock-"));
  dirs.push(dir);
  return dir;
}

async function note(dir: string): Promise<unknown[] | null> {
  try {
    return JSON.parse(await readFile(join(dir, SETUP_CLOCK_STEP_FILE), "utf8")) as unknown[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

type Host = "sets" | "moves-unverified" | "missing";

async function harness(options: { host?: Host; status?: ClockServiceStatus } = {}) {
  const dir = await stateDir();
  let wallMs = START_MS;
  let monoMs = 2 * H;
  const hostSets: { targetMs: number; requester: Record<string, string | null> }[] = [];
  const setter = createSetupClockSet({
    stateDir: dir,
    host: {
      clockStatus: async () => options.status ?? UNSYNCHRONISED,
      setClock: async (input): Promise<ClockSetAnswer> => {
        hostSets.push(input);
        const beforeMs = wallMs;
        monoMs += 50;
        const behaviour = options.host ?? "sets";
        if (behaviour === "missing") return { available: false, reason: "missing" };
        wallMs = input.targetMs + 50;
        if (behaviour === "moves-unverified") return { available: false, reason: "timeout" };
        return { available: true, beforeMs, afterMs: wallMs };
      },
    },
    clock: {
      now: () => ({ instant: new Date(wallMs), offsetMinutes: 60 }) as unknown as TrustedReading,
    },
    wall: () => wallMs,
    monotonic: () => monoMs,
    boot: { readBoot: () => ({ ms: monoMs, id: null }) },
    log: vi.fn(),
  });
  /** A device an hour ahead, measured now on the same two clocks the setter reads. */
  const request = (aheadMs = H): ModuleClockSetRequest => ({
    offsetMs: aheadMs,
    agreesWithinMs: 30_000,
    measuredAt: { wallMs, monoMs },
    reading: {
      boxAt: new Date(wallMs).toISOString(),
      witnessAt: new Date(wallMs + aheadMs).toISOString(),
      uncertaintyMs: 40,
    },
  });
  return { dir, setter, request, hostSets, clocks: () => ({ wallMs, monoMs }) };
}

describe("setting the box's clock from the setup and restore pages", () => {
  it("refuses while the host keeps time over the internet, and notes nothing", async () => {
    const h = await harness({ status: { ...UNSYNCHRONISED, synchronised: true } });
    expect(await h.setter(h.request(), async () => ADMIN)).toEqual({
      status: "refused",
      reason: "synchronised",
    });
    expect(h.hostSets).toEqual([]);
    expect(await note(h.dir)).toBeNull();
  });

  it("answers host_unavailable when the host's socket is missing, and notes nothing", async () => {
    const h = await harness({ host: "missing" });
    expect(await h.setter(h.request(), async () => ADMIN)).toEqual({
      status: "refused",
      reason: "host_unavailable",
    });
    expect(await note(h.dir)).toBeNull();
  });

  it("leaves a device within 30 seconds alone", async () => {
    const h = await harness();
    expect(await h.setter(h.request(29_000), async () => null)).toEqual({
      status: "refused",
      reason: "agrees",
    });
    expect(h.hostSets).toEqual([]);
  });

  it("counts the reading's uncertainty against the 30 seconds, with a person or without", async () => {
    for (const person of [async () => null, async () => ADMIN]) {
      const h = await harness();
      expect(await h.setter(h.request(29_980), person)).toEqual({ status: "set" });
    }
  });

  it("notes a verified step under its own id, naming the administrator on first setup", async () => {
    const h = await harness();
    expect(await h.setter(h.request(), async () => ADMIN)).toEqual({ status: "set" });
    expect(h.hostSets).toEqual([
      { targetMs: START_MS + H, requester: { source: "setup", person: ADMIN.id } },
    ]);
    const entries = (await note(h.dir)) as { id: string; detectedAt: string; params: object }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries[0]!.detectedAt).toBe(new Date(START_MS + H + 50).toISOString());
    expect(entries[0]!.params).toEqual({
      confirmationId: null,
      source: "setup",
      person: "Luis",
      deviceId: null,
      device: null,
      before: new Date(START_MS).toISOString(),
      beforeOffsetMinutes: 60,
      after: new Date(START_MS + H + 50).toISOString(),
      afterOffsetMinutes: 60,
      stepMs: H,
      direction: "forward",
      verified: true,
      unverified: false,
      byAdmin: false,
      byStaff: false,
      bySetupAdmin: true,
    });
  });

  it("notes a step that moved the clock but could not be verified", async () => {
    const h = await harness({ host: "moves-unverified" });
    expect(await h.setter(h.request(), async () => null)).toEqual({
      status: "refused",
      reason: "unverified",
    });
    const entries = (await note(h.dir)) as { params: Record<string, unknown> }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.params).toMatchObject({
      source: "setup",
      person: null,
      verified: false,
      unverified: true,
      bySetup: true,
    });
  });

  it("notes each press as its own entry", async () => {
    const h = await harness();
    expect(await h.setter(h.request(), async () => null)).toEqual({ status: "set" });
    expect(await h.setter(h.request(-2 * H), async () => null)).toEqual({ status: "set" });
    const entries = (await note(h.dir)) as { id: string; params: Record<string, unknown> }[];
    expect(entries.map((entry) => entry.params["direction"])).toEqual(["forward", "back"]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("notes a step whose note could not be written at a later press, then sets", async () => {
    const h = await harness();
    await rm(h.dir, { recursive: true });
    expect(await h.setter(h.request(), async () => null)).toEqual({ status: "set" });
    expect(await h.setter(h.request(-2 * H), async () => null)).toEqual({
      status: "refused",
      reason: "pending_disproofs",
    });
    await mkdir(h.dir);
    expect(await h.setter(h.request(-2 * H), async () => null)).toEqual({ status: "set" });
    const entries = (await note(h.dir)) as { params: Record<string, unknown> }[];
    expect(entries.map((entry) => entry.params["direction"])).toEqual(["forward", "back"]);
  });

  it("refuses an offset measured before a step made meanwhile", async () => {
    const h = await harness();
    const first = h.request();
    const stale = h.request();
    expect(await h.setter(first, async () => null)).toEqual({ status: "set" });
    expect(await h.setter(stale, async () => null)).toEqual({ status: "refused", reason: "stale" });
  });

  it("reads the steps made before it waits for the person", async () => {
    const h = await harness();
    const measured = h.request();
    let release!: () => void;
    const waiting = h.setter(
      measured,
      () => new Promise<null>((resolve) => (release = () => resolve(null))),
    );
    expect(await h.setter(h.request(), async () => null)).toEqual({ status: "set" });
    // Measured again after that step, so only the count of steps can tell it is stale.
    (measured as { measuredAt: object }).measuredAt = h.clocks();
    release();
    expect(await waiting).toEqual({ status: "refused", reason: "stale" });
  });
});

describe("the venue's first full start raises the setup's clock steps", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  async function twoSteps() {
    const h = await harness();
    await h.setter(h.request(), async () => ADMIN);
    await h.setter(h.request(-2 * H), async () => ADMIN);
    return { dir: h.dir, entries: (await note(h.dir)) as { id: string }[] };
  }

  const clockCorrected = () =>
    suite.db
      .select({ id: incidents.id, handled: incidents.acknowledgedAt, params: incidents.params })
      .from(incidents)
      .where(eq(incidents.code, "clock.corrected"));

  it("gives each entry its own alert under its id, emails each, and deletes the note", async () => {
    const { dir, entries } = await twoSteps();
    const remembered: string[] = [];
    await raiseSetupClockSteps({
      db: suite.db,
      stateDir: dir,
      remember: (incident) => remembered.push(incident.id),
      log: vi.fn(),
    });
    const rows = await clockCorrected();
    expect(rows.map((row) => row.id).sort()).toEqual(entries.map((entry) => entry.id).sort());
    // One open alert per step, as two steps on a running box give: the later marks the earlier
    // handled, and the email duty mails both.
    const open = await suite.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.code, "clock.corrected"), isNull(incidents.acknowledgedAt)));
    expect(open).toEqual([{ id: entries[1]!.id }]);
    expect(remembered).toEqual(entries.map((entry) => entry.id));
    expect(rows.find((row) => row.id === entries[0]!.id)!.params).toMatchObject({
      source: "setup",
      person: "Luis",
      bySetupAdmin: true,
    });
    expect(await note(dir)).toBeNull();
  });

  it("inserts nothing twice when a start stopped before deleting the note", async () => {
    const { dir, entries } = await twoSteps();
    const kept = await readFile(join(dir, SETUP_CLOCK_STEP_FILE), "utf8");
    await raiseSetupClockSteps({ db: suite.db, stateDir: dir, remember: () => {}, log: vi.fn() });
    const before = await clockCorrected();
    await writeFile(join(dir, SETUP_CLOCK_STEP_FILE), kept);
    const remembered: string[] = [];
    await raiseSetupClockSteps({
      db: suite.db,
      stateDir: dir,
      remember: (incident) => remembered.push(incident.id),
      log: vi.fn(),
    });
    expect(await clockCorrected()).toEqual(before);
    expect(remembered).toEqual(entries.map((entry) => entry.id));
    expect(await note(dir)).toBeNull();
  });

  it("marks an alert left open from before the setup handled by the first entry", async () => {
    const { dir, entries } = await twoSteps();
    await withTransaction(suite.db, (tx) =>
      tx.insert(incidents).values({
        id: "11111111-1111-4111-8111-111111111111",
        source: "dashboard",
        code: "clock.corrected",
        params: {},
        severity: "warning",
        detectedAt: new Date(START_MS - H).toISOString(),
      }),
    );
    await raiseSetupClockSteps({ db: suite.db, stateDir: dir, remember: () => {}, log: vi.fn() });
    const open = await suite.db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.code, "clock.corrected"), isNull(incidents.acknowledgedAt)));
    expect(open).toEqual([{ id: entries[1]!.id }]);
  });

  it("keeps a note it cannot read for the next start, and lets the start go on", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, SETUP_CLOCK_STEP_FILE), "{");
    const log = vi.fn();
    await raiseSetupClockSteps({ db: suite.db, stateDir: dir, remember: () => {}, log });
    expect(log).toHaveBeenCalledWith("warn", "setup_clock_step.raise_failed", {
      errorCode: expect.any(String),
    });
    expect(await readFile(join(dir, SETUP_CLOCK_STEP_FILE), "utf8")).toBe("{");
  });

  it("does nothing when there is no note", async () => {
    const dir = await stateDir();
    const remember = vi.fn();
    await raiseSetupClockSteps({ db: suite.db, stateDir: dir, remember, log: vi.fn() });
    expect(await clockCorrected()).toEqual([]);
    expect(remember).not.toHaveBeenCalled();
  });
});
