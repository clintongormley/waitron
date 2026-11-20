import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { FutureDateRefusal } from "@waitron/fiscal";
import type { ClockServiceStatus } from "./box-host-client.js";
import { sharedClockServiceReading } from "./clock-service-reading.js";
import { CLOCK_WATCH_MS, createClockWatch } from "./clock-watch.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";

const TX = { fake: "tx" } as unknown as Transaction;
const NODE = "node-1";
const START_MS = Date.parse("2026-11-01T23:59:30.000Z");
const REFUSED_ON = "2026-11-02";
const NOT_SYNCHRONISED = clockServiceAnswer(false);
const SYNCHRONISED = clockServiceAnswer(true);
/** Five looks span the shared time-service reading's minute, so the host is read afresh. */
const A_MINUTE_OF_LOOKS = 5;

function harness(options: { host: () => ClockServiceStatus; state?: StartClockState }) {
  let wallMs = START_MS;
  let monoMs = 1_000;
  let head = 7;
  const refused: FutureDateRefusal[] = [];
  const logs: { level: string; event: string; fields: unknown }[] = [];
  const store = createClockWitnessStore({ wall: () => wallMs, monotonic: () => monoMs });
  const reading = sharedClockServiceReading(
    { clockStatus: async () => options.host() },
    () => new Date(wallMs),
  );
  const state = options.state ?? startClockState();
  const latest = vi.fn(async (_tx: Transaction, above: number) => {
    const found = refused.filter((refusal) => refusal.position > above);
    return found.sort((a, b) => b.position - a.position)[0] ?? null;
  });
  const watch = createClockWatch({
    backend: { assertRecordableAt: () => {} },
    store,
    clock: { now: () => ({ instant: new Date(wallMs), offsetMinutes: 0 }) as never },
    read: (async (fn: (tx: Transaction) => Promise<unknown>) => fn(TX)) as never,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    wall: () => wallMs,
    monotonic: () => monoMs,
    start: {
      state,
      clockStatus: reading.read,
      clearClockStatus: reading.clear,
      filesRecords: () => true,
      heads: async () => ({ [NODE]: head }),
      futureDateRefusal: { nodeId: NODE, latest },
    },
  });

  async function looks(count = 1) {
    for (let look = 0; look < count; look++) {
      monoMs += CLOCK_WATCH_MS;
      wallMs += CLOCK_WATCH_MS;
      await watch.check();
    }
  }

  return {
    state,
    logs,
    latest,
    looks,
    /** A sale recorded now, at the next position on this box's chain. */
    record: () => ++head,
    refuse: (position: number) => refused.push({ position, issuedOn: REFUSED_ON }),
    heads: () => ({ [NODE]: head }),
    jump: (ms: number) => {
      wallMs += ms;
    },
    noteDevice: (id: string, address: string, aheadMs: number) =>
      store.noteDevice(id, address, wallMs + aheadMs, { wallMs, monoMs }),
    wall: () => wallMs,
    events: (event: string) => logs.filter((entry) => entry.event === event),
  };
}

/** Case 1: confirmed by a person, a sale recorded after, and AEAT's refusal of it arriving. */
async function refusedAfterAPerson(host: () => ClockServiceStatus = () => NOT_SYNCHRONISED) {
  const h = harness({ host });
  await h.looks();
  h.state.confirm("by_person", h.heads());
  const refusedAt = h.record();
  h.refuse(refusedAt);
  await h.looks();
  return { ...h, refusedAt };
}

/** A box the internet confirmed, a refusal judged while it was synchronised, a hundred sales
 * after it, and then a time service that throws. */
async function judgedWhileSynchronised() {
  let host: () => ClockServiceStatus = () => SYNCHRONISED;
  const h = harness({ host: () => host() });
  await h.looks();
  expect(h.state.status).toBe("by_internet");
  h.refuse(h.record());
  await h.looks(3);
  expect(h.events("clock_start.future_date_refused_synchronised")).toHaveLength(1);
  for (let sale = 0; sale < 100; sale++) h.record();
  await h.looks(A_MINUTE_OF_LOOKS);
  host = () => {
    throw new Error("host gone");
  };
  await h.looks(A_MINUTE_OF_LOOKS);
  return h;
}

describe("the clock watch and AEAT refusing a sale as dated in the future", () => {
  it("sends a box a person confirmed back to waiting when a sale recorded since is refused, with the sale's date", async () => {
    const h = await refusedAfterAPerson();

    expect(h.state).toMatchObject({
      status: "waiting",
      cause: "future_date_refused",
      refusedOn: REFUSED_ON,
    });
    expect(h.events("clock_start.future_date_refused")).toEqual([
      {
        level: "warn",
        event: "clock_start.future_date_refused",
        fields: { position: h.refusedAt, issuedOn: REFUSED_ON },
      },
    ]);
  });

  it("stops once: after a person confirms, neither the clock passing the refused date nor a refusal of an earlier sale stops it again", async () => {
    const h = await refusedAfterAPerson();
    h.record();
    h.state.confirm("by_person", h.heads());
    await h.looks(4);

    expect(new Date(h.wall()).toISOString().slice(0, 10)).toBe(REFUSED_ON);
    expect(h.state.status).toBe("by_person");

    h.refuse(h.heads()[NODE]!);
    await h.looks(2);

    expect(h.state.status).toBe("by_person");
    expect(h.events("clock_start.future_date_refused")).toHaveLength(1);
  });

  it("is not ended by two devices agreeing, which do end a plain start's wait (control)", async () => {
    const h = await refusedAfterAPerson();
    h.noteDevice("till-1", "10.0.0.5", 1_000);
    h.noteDevice("till-2", "10.0.0.6", 2_000);
    await h.looks();

    expect(h.state).toMatchObject({ status: "waiting", cause: "future_date_refused" });

    const plain = harness({ host: () => NOT_SYNCHRONISED });
    plain.noteDevice("till-1", "10.0.0.5", 1_000);
    plain.noteDevice("till-2", "10.0.0.6", 2_000);
    await plain.looks();

    expect(plain.state.status).toBe("by_devices");
  });

  it("is ended by the time service synchronising, and the refusal then stops nothing", async () => {
    let answer = NOT_SYNCHRONISED;
    const h = await refusedAfterAPerson(() => answer);
    answer = SYNCHRONISED;
    await h.looks(A_MINUTE_OF_LOOKS);

    expect(h.state).toMatchObject({ status: "by_internet", cause: null, refusedOn: null });
    expect(h.events("clock_start.future_date_refused_synchronised")).toEqual([]);
  });

  it("leaves a synchronised box alone when a sale recorded since its confirmation is refused, warning once per look that finds a newer refusal, naming the highest", async () => {
    const h = harness({ host: () => SYNCHRONISED });
    await h.looks();
    expect(h.state.status).toBe("by_internet");
    const first = h.record();
    h.refuse(first);
    await h.looks(3);
    h.refuse(h.record());
    const third = h.record();
    h.refuse(third);
    await h.looks(3);

    expect(h.state.status).toBe("by_internet");
    expect(h.events("clock_start.future_date_refused_synchronised")).toEqual(
      [first, third].map((position) => ({
        level: "warn",
        event: "clock_start.future_date_refused_synchronised",
        fields: { position, issuedOn: REFUSED_ON },
      })),
    );
  });

  it("keeps a box trading when a refusal it judged while synchronised is still the latest once the time service stops answering", async () => {
    const h = await judgedWhileSynchronised();

    expect(h.state.status).toBe("by_internet");
    expect(h.events("clock_start.future_date_refused")).toEqual([]);
  });

  it("sends that box back to waiting when a sale above the judged refusal is refused while the time service does not answer", async () => {
    const h = await judgedWhileSynchronised();
    expect(h.state.status).toBe("by_internet");
    const refusedAt = h.record();
    h.refuse(refusedAt);
    await h.looks();

    expect(h.state).toMatchObject({ status: "waiting", cause: "future_date_refused" });
    expect(h.events("clock_start.future_date_refused")).toEqual([
      {
        level: "warn",
        event: "clock_start.future_date_refused",
        fields: { position: refusedAt, issuedOn: REFUSED_ON },
      },
    ]);
  });

  it("sends a box the internet confirmed back to waiting when a sale recorded while it was synchronised is refused after it no longer is (control)", async () => {
    let answer = SYNCHRONISED;
    const h = harness({ host: () => answer });
    await h.looks();
    expect(h.state.status).toBe("by_internet");
    const recordedAt = h.record();
    await h.looks(A_MINUTE_OF_LOOKS);
    answer = NOT_SYNCHRONISED;
    await h.looks(A_MINUTE_OF_LOOKS);
    expect(h.state.status).toBe("by_internet");
    h.refuse(recordedAt);
    await h.looks();

    expect(h.state).toMatchObject({ status: "waiting", cause: "future_date_refused" });
  });

  it("takes over a jump's wait, and a later jump does not take it back", async () => {
    const h = harness({ host: () => NOT_SYNCHRONISED });
    await h.looks();
    h.state.confirm("by_person", h.heads());
    h.jump(5 * 60_000);
    await h.looks();
    expect(h.state).toMatchObject({ status: "waiting", cause: "clock_jumped" });

    h.refuse(h.record());
    await h.looks();
    expect(h.state).toMatchObject({ status: "waiting", cause: "future_date_refused" });

    h.jump(5 * 60_000);
    await h.looks();
    expect(h.state).toMatchObject({ status: "waiting", cause: "future_date_refused" });
  });

  it("ignores a refusal of a sale recorded before the latest confirmation (control)", async () => {
    const h = harness({ host: () => NOT_SYNCHRONISED });
    await h.looks();
    h.refuse(h.record());
    h.state.confirm("by_person", h.heads());
    await h.looks(3);

    expect(h.state.status).toBe("by_person");
    expect(h.latest).toHaveBeenLastCalledWith(TX, h.heads()[NODE]);
  });

  it("ignores, after a restart, a refusal stored before it, waiting and then confirmed (control)", async () => {
    const h = harness({ host: () => NOT_SYNCHRONISED });
    h.refuse(h.record());
    await h.looks(2);

    expect(h.state).toMatchObject({ status: "waiting", cause: "start" });
    expect(h.latest).not.toHaveBeenCalled();

    h.state.confirm("by_person", h.heads());
    await h.looks(2);

    expect(h.state.status).toBe("by_person");
    expect(h.events("clock_start.future_date_refused")).toEqual([]);
  });
});
