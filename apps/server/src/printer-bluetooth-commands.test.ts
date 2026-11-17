import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLUETOOTH_COMMAND_LIMIT, PIN_WITHHELD } from "@waitron/print-agent";
import { createPrinterBluetoothCommands } from "./printer-bluetooth-commands.js";

const A = "AA:BB:CC:DD:EE:01";
const B = "AA:BB:CC:DD:EE:02";

function store() {
  const clock = { now: 1_000 };
  let n = 0;
  const commands = createPrinterBluetoothCommands({ now: () => clock.now, id: () => `c${++n}` });
  return { clock, commands };
}

function address(i: number): string {
  return `AA:BB:CC:DD:EE:${i.toString(16).padStart(2, "0").toUpperCase()}`;
}

describe("printer Bluetooth commands", () => {
  it.each([
    ["pair", A, "1234"],
    ["forget", A, undefined],
    ["pair", B, "0000"],
  ] as const)("refuses a different operation while Pair runs (%s %s %s)", (kind, address, pin) => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 30_001;
    expect(() => commands.enqueue("agent-1", kind, address, pin)).toThrowError(
      expect.objectContaining({
        code: "printer.bluetooth_command_busy",
        params: { kind: "pair", seconds: 90 },
      }),
    );
    expect(commands.current("agent-1")).toEqual([
      { id: "c1", kind: "pair", address: A, pin: "0000" },
    ]);
    commands.accept("agent-1", [{ id: "c1", ok: false, reason: "wrong_pin" }]);
    expect(commands.enqueue("agent-1", kind, address, pin)).toMatchObject({
      id: "c2",
      kind,
      address,
      state: "pending",
    });
  });

  it("correlates an expired Unpair until committed acceptance, only for its issuing agent", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "forget", A);
    clock.now += 120_000;
    const outcomes = [{ id: "c1", ok: true }];
    expect(commands.current("agent-1")).toEqual([]);
    commands.accept("agent-2", outcomes);
    expect(commands.unpaired("agent-2", outcomes)).toEqual([]);
    expect(commands.unpaired("agent-1", [{ id: "unknown", ok: true }])).toEqual([]);
    expect(commands.unpaired("agent-1", [{ id: "c1", ok: false }])).toEqual([]);
    expect(commands.unpaired("agent-1", outcomes)).toEqual([A]);
    expect(commands.unpaired("agent-1", outcomes)).toEqual([A]);
    commands.accept("agent-1", outcomes);
    expect(commands.unpaired("agent-1", outcomes)).toEqual([]);
  });

  it("bounds expired Unpair identities across all agents, evicting the oldest", () => {
    const { clock, commands } = store();
    for (let i = 1; i <= 9; i++) {
      commands.enqueue(`agent-${i}`, "forget", address(i));
      clock.now += 120_000;
      commands.current(`agent-${i}`);
    }
    expect(commands.unpaired("agent-1", [{ id: "c1", ok: true }])).toEqual([]);
    expect(commands.unpaired("agent-2", [{ id: "c2", ok: true }])).toEqual([address(2)]);
    expect(commands.unpaired("agent-9", [{ id: "c9", ok: true }])).toEqual([address(9)]);
  });

  it("resends a pending pair with its PIN on every pull until the outcome arrives, then stops", () => {
    const { commands } = store();
    const status = commands.enqueue("agent-1", "pair", A, "0000");
    expect(status).toEqual({
      id: "c1",
      kind: "pair",
      address: A,
      state: "pending",
      expiresInMs: 120_000,
    });
    expect("pin" in status).toBe(false);

    const sent = [{ id: "c1", kind: "pair", address: A, pin: "0000" }];
    expect(commands.current("agent-1")).toEqual(sent);
    expect(commands.current("agent-1")).toEqual(sent);
    expect(commands.current("agent-1")).toEqual(sent);

    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.current("agent-1")).toEqual([]);
    const latest = commands.latest("agent-1", A);
    expect(latest).toEqual({ id: "c1", kind: "pair", address: A, state: "succeeded" });
    expect(latest && "pin" in latest).toBe(false);
  });

  it("never lets a status carry the PIN, pending or terminal", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A, "s3cr3t!");
    const pending = commands.latest("agent-1", A);
    expect(pending).toEqual({
      id: "c1",
      kind: "pair",
      address: A,
      state: "pending",
      expiresInMs: 120_000,
    });
    expect(JSON.stringify(pending)).not.toContain("s3cr3t!");
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "refused" }]);
    const failed = commands.latest("agent-1", A);
    expect(failed).toEqual({
      id: "c1",
      kind: "pair",
      address: A,
      state: "failed",
      error: "refused",
    });
    expect(JSON.stringify(failed)).not.toContain("s3cr3t!");
  });

  it("sends a pair without a PIN as none, and never attaches a PIN to a forget", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A);
    commands.enqueue("agent-2", "forget", B, "1234");
    const sent = [...commands.current("agent-1"), ...commands.current("agent-2")];
    expect(sent).toEqual([
      { id: "c1", kind: "pair", address: A },
      { id: "c2", kind: "forget", address: B },
    ]);
    expect(sent.some((command) => "pin" in command)).toBe(false);
  });

  it("keeps a failure's reason code beside its error", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A, "1234");
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "wrong PIN", reason: "wrong_pin" }]);
    expect(commands.latest("agent-1", A)).toEqual({
      id: "c1",
      kind: "pair",
      address: A,
      state: "failed",
      error: "wrong PIN",
      reason: "wrong_pin",
    });
  });

  it("drops a success's error, and records a failure that sent no error with none", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    commands.accept("agent-1", [{ id: "c1", ok: true, error: "ignored on success" }]);
    commands.enqueue("agent-1", "forget", B);
    commands.accept("agent-1", [{ id: "c2", ok: false }]);
    expect(commands.latest("agent-1", A)).toEqual({
      id: "c1",
      kind: "forget",
      address: A,
      state: "succeeded",
    });
    expect(commands.latest("agent-1", B)).toEqual({
      id: "c2",
      kind: "forget",
      address: B,
      state: "failed",
    });
  });

  it("returns the exact duplicate without extending its deadline, then admits the next operation", () => {
    const { clock, commands } = store();
    const first = commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 30_000;
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toEqual({
      ...first,
      expiresInMs: 90_000,
    });
    expect(commands.current("agent-1")).toEqual([
      { id: "c1", kind: "pair", address: A, pin: "0000" },
    ]);
    clock.now += 90_000;
    expect(commands.current("agent-1")).toEqual([]);
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
  });

  it("shows a new command, not the previous result, once the same address is queued again", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "timeout" }]);
    commands.enqueue("agent-1", "pair", A, "0000");
    expect(commands.latest("agent-1", A)).toEqual({
      id: "c2",
      kind: "pair",
      address: A,
      state: "pending",
      expiresInMs: 120_000,
    });
  });

  it("expires a pending command 120 seconds after it was queued, with no result", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 119_999;
    expect(commands.current("agent-1")).toHaveLength(1);
    clock.now += 1;
    expect(commands.current("agent-1")).toEqual([]);
    expect(commands.latest("agent-1", A)).toBeUndefined();
    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.latest("agent-1", A)).toBeUndefined();
  });

  it("accepts a slow pair's outcome that arrives 90 seconds after it was queued", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 90_000;
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "pairing did not complete" }]);
    expect(commands.latest("agent-1", A)).toEqual({
      id: "c1",
      kind: "pair",
      address: A,
      state: "failed",
      error: "pairing did not complete",
    });
    expect(commands.current("agent-1")).toEqual([]);
  });

  it("expires a result 60 seconds after its outcome was accepted", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "forget", A);
    clock.now += 50_000;
    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    clock.now += 59_999;
    expect(commands.latest("agent-1", A)).toMatchObject({ state: "succeeded" });
    clock.now += 1;
    expect(commands.latest("agent-1", A)).toBeUndefined();
  });

  it("keeps each agent's commands, outcomes, results and bound apart", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", address(1));
    const other = commands.enqueue("agent-2", "pair", address(1), "9999");
    expect(other).toEqual({
      id: "c2",
      kind: "pair",
      address: address(1),
      state: "pending",
      expiresInMs: 120_000,
    });
    expect(commands.current("agent-2")).toEqual([
      { id: "c2", kind: "pair", address: address(1), pin: "9999" },
    ]);
    expect(commands.current("agent-1").map((command) => command.id)).not.toContain("c2");

    commands.accept("agent-2", [{ id: "c1", ok: true }]);
    commands.accept("agent-1", [{ id: "c2", ok: true }]);
    expect(commands.current("agent-1")).toHaveLength(1);
    expect(commands.current("agent-2")).toHaveLength(1);
    expect(commands.latest("agent-1", address(1))).toMatchObject({ id: "c1", state: "pending" });
    expect(commands.latest("agent-2", address(1))).toMatchObject({ id: "c2", state: "pending" });

    commands.accept("agent-2", [{ id: "c2", ok: true }]);
    expect(commands.latest("agent-2", address(1))).toMatchObject({ state: "succeeded" });
    expect(commands.latest("agent-1", address(1))).toMatchObject({ state: "pending" });
    expect(commands.latest("agent-3", address(1))).toBeUndefined();
    expect(commands.current("agent-3")).toEqual([]);
  });

  it("ignores an outcome whose id is unknown", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    commands.accept("agent-1", [{ id: "nope", ok: true }]);
    commands.accept("agent-1", []);
    commands.accept("agent-9", [{ id: "c1", ok: true }]);
    expect(commands.current("agent-1")).toEqual([{ id: "c1", kind: "forget", address: A }]);
  });

  it("keeps at most eight results per agent, dropping the oldest", () => {
    const { commands } = store();
    for (let i = 1; i <= 9; i++) {
      commands.enqueue("agent-1", "forget", address(i));
      commands.accept("agent-1", [{ id: `c${i}`, ok: true }]);
    }
    expect(commands.latest("agent-1", address(1))).toBeUndefined();
    for (let i = 2; i <= 9; i++)
      expect(commands.latest("agent-1", address(i))).toMatchObject({ state: "succeeded" });
  });

  it("hands out copies, so a caller cannot change what is stored", () => {
    const { commands } = store();
    const status = commands.enqueue("agent-1", "pair", A, "0000");
    status.state = "failed";
    const [sent] = commands.current("agent-1");
    sent!.pin = "changed";
    expect(commands.latest("agent-1", A)).toMatchObject({ state: "pending" });
    expect(commands.current("agent-1")).toEqual([
      { id: "c1", kind: "pair", address: A, pin: "0000" },
    ]);
  });

  it("withholds a failed pair's whole error when it contains the PIN, before bounding its length", () => {
    const { commands } = store();
    const pin = "Zq7#Pw";
    commands.enqueue("agent-1", "pair", A, pin);
    commands.accept("agent-1", [{ id: "c1", ok: false, error: `Pair failed for PIN ${pin}` }]);
    commands.enqueue("agent-1", "pair", B, pin);
    // The PIN straddles the length bound, so bounding first would keep its first characters.
    commands.accept("agent-1", [{ id: "c2", ok: false, error: `${"x".repeat(497)}${pin}` }]);
    for (const address of [A, B]) {
      const failed = commands.latest("agent-1", address);
      expect(failed).toMatchObject({ state: "failed", error: PIN_WITHHELD });
      expect(JSON.stringify(failed)).not.toContain(pin.slice(0, 3));
    }
  });

  it("bounds a failure's error to 500 characters", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "y".repeat(600) }]);
    expect(commands.latest("agent-1", A)).toMatchObject({ error: "y".repeat(500) });
  });

  it("tells a pending status how long until the command is dropped, and a finished one nothing", () => {
    const { clock, commands } = store();
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toMatchObject({
      state: "pending",
      expiresInMs: 120_000,
    });
    clock.now += 30_000;
    expect(commands.latest("agent-1", A)).toMatchObject({ expiresInMs: 90_000 });
    // A duplicate keeps the original command's deadline.
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toMatchObject({ expiresInMs: 90_000 });
    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.latest("agent-1", A)).not.toHaveProperty("expiresInMs");
  });

  it("drops an idle agent's expired entries once a call about another agent comes a minute on", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-idle", "forget", B);
    commands.accept("agent-idle", [{ id: "c1", ok: true }]);
    commands.enqueue("agent-idle", "forget", A);
    expect(commands.agentsHeld()).toBe(1);
    clock.now += 120_000;
    commands.current("agent-busy");
    expect(commands.agentsHeld()).toBe(0);
  });

  describe("on the default clock, a wall-clock step changes no wait", () => {
    const DAY = 86_400_000;
    let steady = 0;
    let wall = 0;
    beforeEach(() => {
      steady = 1_000;
      wall = 400 * DAY;
      vi.spyOn(performance, "now").mockImplementation(() => steady);
      vi.spyOn(Date, "now").mockImplementation(() => wall);
    });
    afterEach(() => vi.restoreAllMocks());

    it("keeps a pending command for its whole 120 seconds", () => {
      const commands = createPrinterBluetoothCommands();
      commands.enqueue("agent-1", "pair", address(1), "0000");
      for (const stepped of [0, 800 * DAY]) {
        wall = stepped;
        expect(commands.current("agent-1")).toHaveLength(1);
        expect(commands.latest("agent-1", address(1))).toMatchObject({ expiresInMs: 120_000 });
      }
      steady += 119_999;
      wall = 0;
      expect(commands.current("agent-1")).toHaveLength(1);
      steady += 1;
      expect(commands.current("agent-1")).toEqual([]);
      expect(
        commands.enqueue("agent-1", "forget", address(BLUETOOTH_COMMAND_LIMIT + 1)),
      ).toMatchObject({ state: "pending", expiresInMs: 120_000 });
    });

    it("keeps a result for its whole 60 seconds", () => {
      const commands = createPrinterBluetoothCommands({ id: () => "c1" });
      commands.enqueue("agent-1", "forget", A);
      commands.accept("agent-1", [{ id: "c1", ok: true }]);
      wall = 0;
      expect(commands.latest("agent-1", A)).toMatchObject({ state: "succeeded" });
      steady += 59_999;
      wall = 800 * DAY;
      expect(commands.latest("agent-1", A)).toMatchObject({ state: "succeeded" });
      steady += 1;
      expect(commands.latest("agent-1", A)).toBeUndefined();
    });

    it("sweeps an idle agent only a minute after the last sweep", () => {
      const commands = createPrinterBluetoothCommands();
      commands.enqueue("agent-idle", "forget", A);
      steady += 120_000;
      commands.current("agent-busy");
      // The sweep above ran at 121_000; the idle command queued now ends at 241_000.
      commands.enqueue("agent-idle", "forget", A);
      wall = 0;
      commands.current("agent-busy");
      expect(commands.agentsHeld()).toBe(1);
      steady = 240_999;
      commands.current("agent-busy");
      expect(commands.agentsHeld()).toBe(1);
      // That sweep ran at 240_999, so the next is not due until 300_999.
      steady = 241_000;
      wall = 800 * DAY;
      commands.current("agent-busy");
      expect(commands.agentsHeld()).toBe(1);
      steady = 300_999;
      commands.current("agent-busy");
      expect(commands.agentsHeld()).toBe(0);
    });
  });

  it("tells a pending status whole milliseconds left, rounded up, from a fractional clock", () => {
    let steady = 0.25;
    const commands = createPrinterBluetoothCommands({ now: () => steady });
    expect(commands.enqueue("agent-1", "forget", A)).toMatchObject({ expiresInMs: 120_000 });
    steady = 1000.5;
    expect(commands.latest("agent-1", A)).toMatchObject({ expiresInMs: 119_000 });
  });

  it("never tells more than two minutes left, in milliseconds or seconds, from a fractional clock", () => {
    // 11072.26 + 120000 - 11072.26 is 120000.00000000001 in floating point.
    const commands = createPrinterBluetoothCommands({ now: () => 11072.26 });
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toMatchObject({ expiresInMs: 120_000 });
    expect(commands.latest("agent-1", A)).toMatchObject({ expiresInMs: 120_000 });
    expect(() => commands.enqueue("agent-1", "forget", B)).toThrowError(
      expect.objectContaining({ params: { kind: "pair", seconds: 120 } }),
    );
  });

  it("uses the real clock and random ids by default", () => {
    const commands = createPrinterBluetoothCommands();
    const first = commands.enqueue("agent-1", "forget", A);
    const second = commands.enqueue("agent-2", "forget", B);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(commands.current("agent-1")).toHaveLength(1);
    expect(commands.current("agent-2")).toHaveLength(1);
  });

  it("reads performance.now at each call by default, so a replaced clock reaches it", () => {
    // Built before the clock is replaced, so a clock captured at construction would miss it.
    const commands = createPrinterBluetoothCommands();
    const start = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(start);
    try {
      commands.enqueue("agent-1", "forget", A);
      vi.spyOn(performance, "now").mockReturnValue(start + 120_000);
      expect(commands.current("agent-1")).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("names the addresses whose pending unpairing the outcomes report succeeded, without settling them", () => {
    const { commands } = store();
    const C = address(3);
    const D = address(4);
    commands.enqueue("agent-1", "forget", A);
    commands.enqueue("agent-2", "forget", B);
    commands.enqueue("agent-3", "pair", C, "0000");
    commands.enqueue("agent-4", "forget", D);
    const outcomes = [
      { id: "c1", ok: true },
      { id: "c2", ok: false, error: "refused" },
      { id: "c3", ok: true },
      { id: "c4", ok: true },
      { id: "unknown", ok: true },
    ];

    expect(commands.unpaired("agent-1", outcomes)).toEqual([A]);
    expect(commands.unpaired("agent-4", outcomes)).toEqual([D]);
    expect(commands.unpaired("agent-3", outcomes)).toEqual([]);
    expect(commands.latest("agent-1", A)).toMatchObject({ state: "pending" });

    commands.accept("agent-1", outcomes);
    expect(commands.unpaired("agent-1", outcomes)).toEqual([]);
  });

  it.each([false, true])("judges duplicated Unpair outcomes by the first answer (%s)", (ok) => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    const outcomes = [
      { id: "c1", ok },
      { id: "c1", ok: !ok },
    ];
    expect(commands.unpaired("agent-1", outcomes)).toEqual(ok ? [A] : []);
    commands.accept("agent-1", outcomes);
    expect(commands.latest("agent-1", A)).toMatchObject({ state: ok ? "succeeded" : "failed" });
  });
});
