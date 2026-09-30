import { describe, expect, it, vi } from "vitest";
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
    commands.enqueue("agent-1", "forget", B, "1234");
    const sent = commands.current("agent-1");
    expect(sent).toEqual([
      { id: "c1", kind: "pair", address: A },
      { id: "c2", kind: "forget", address: B },
    ]);
    expect(sent.some((command) => "pin" in command)).toBe(false);
  });

  it("keeps a failure's reason and records a success without one", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    commands.enqueue("agent-1", "forget", B);
    commands.accept("agent-1", [
      { id: "c1", ok: true, error: "ignored on success" },
      { id: "c2", ok: false },
    ]);
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

  it("returns the existing pending command for an exact duplicate", () => {
    const { clock, commands } = store();
    const first = commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 30_000;
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toEqual({
      ...first,
      expiresInMs: 90_000,
    });
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
    expect(commands.current("agent-1")).toEqual([
      { id: "c1", kind: "pair", address: A, pin: "0000" },
      { id: "c2", kind: "forget", address: B },
    ]);
    // A duplicate does not extend the original command's life.
    clock.now += 90_000;
    expect(commands.current("agent-1")).toEqual([{ id: "c2", kind: "forget", address: B }]);
  });

  it("replaces a pending pair under a new id when the operator retypes a different PIN", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 30_000;
    const retyped = commands.enqueue("agent-1", "pair", A, "1234");
    expect(retyped).toEqual({
      id: "c2",
      kind: "pair",
      address: A,
      state: "pending",
      expiresInMs: 120_000,
    });
    expect(commands.current("agent-1")).toEqual([
      { id: "c2", kind: "pair", address: A, pin: "1234" },
    ]);
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "wrong PIN" }]);
    expect(commands.latest("agent-1", A)).toEqual(retyped);
    // The replacement's life starts at the retype.
    clock.now += 119_999;
    expect(commands.current("agent-1")).toHaveLength(1);
    commands.enqueue("agent-1", "pair", A);
    expect(commands.current("agent-1")).toEqual([{ id: "c3", kind: "pair", address: A }]);
  });

  it("replaces the opposite operation for the same address and ignores the replaced id", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    const forget = commands.enqueue("agent-1", "forget", A);
    expect(forget).toEqual({
      id: "c2",
      kind: "forget",
      address: A,
      state: "pending",
      expiresInMs: 120_000,
    });
    expect(commands.current("agent-1")).toEqual([{ id: "c2", kind: "forget", address: A }]);
    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.latest("agent-1", A)).toEqual(forget);
    expect(commands.current("agent-1")).toHaveLength(1);
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

  it("holds at most eight pending addresses per agent and refuses a ninth distinct one", () => {
    const { clock, commands } = store();
    for (let i = 1; i <= 8; i++) commands.enqueue("agent-1", "forget", address(i));
    expect(() => commands.enqueue("agent-1", "forget", address(9))).toThrowError(
      expect.objectContaining({ code: "printer.bluetooth_command_busy", params: {} }),
    );
    // Same address — duplicate or opposite operation — is not a ninth address.
    expect(commands.enqueue("agent-1", "forget", address(1))).toMatchObject({ id: "c1" });
    expect(commands.enqueue("agent-1", "pair", address(2), "0000")).toMatchObject({ id: "c9" });
    expect(commands.current("agent-1")).toHaveLength(8);

    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.enqueue("agent-1", "forget", address(9))).toMatchObject({ id: "c10" });
    expect(() => commands.enqueue("agent-1", "forget", address(10))).toThrowError(
      expect.objectContaining({ code: "printer.bluetooth_command_busy" }),
    );

    clock.now += 120_000;
    expect(commands.enqueue("agent-1", "forget", address(10))).toMatchObject({ id: "c11" });
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
    for (let i = 1; i <= 8; i++) commands.enqueue("agent-1", "forget", address(i));
    const other = commands.enqueue("agent-2", "pair", address(1), "9999");
    expect(other).toEqual({
      id: "c9",
      kind: "pair",
      address: address(1),
      state: "pending",
      expiresInMs: 120_000,
    });
    expect(commands.current("agent-2")).toEqual([
      { id: "c9", kind: "pair", address: address(1), pin: "9999" },
    ]);
    expect(commands.current("agent-1").map((command) => command.id)).not.toContain("c9");

    commands.accept("agent-2", [{ id: "c1", ok: true }]);
    commands.accept("agent-1", [{ id: "c9", ok: true }]);
    expect(commands.current("agent-1")).toHaveLength(8);
    expect(commands.current("agent-2")).toHaveLength(1);
    expect(commands.latest("agent-1", address(1))).toMatchObject({ id: "c1", state: "pending" });
    expect(commands.latest("agent-2", address(1))).toMatchObject({ id: "c9", state: "pending" });

    commands.accept("agent-2", [{ id: "c9", ok: true }]);
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

  it("withholds a failed pair's whole reason when it contains the PIN, before bounding its length", () => {
    const { commands } = store();
    const pin = "Zq7#Pw";
    commands.enqueue("agent-1", "pair", A, pin);
    commands.enqueue("agent-1", "pair", B, pin);
    commands.accept("agent-1", [
      { id: "c1", ok: false, error: `Pair failed for PIN ${pin}` },
      // The PIN straddles the length bound, so bounding first would keep its first characters.
      { id: "c2", ok: false, error: `${"x".repeat(497)}${pin}` },
    ]);
    for (const address of [A, B]) {
      const failed = commands.latest("agent-1", address);
      expect(failed).toMatchObject({ state: "failed", error: PIN_WITHHELD });
      expect(JSON.stringify(failed)).not.toContain(pin.slice(0, 3));
    }
  });

  it("bounds a failure's reason to 500 characters", () => {
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

  it("holds as many pending commands as the agent does, and keeps that many results", () => {
    const { commands } = store();
    for (let i = 1; i <= BLUETOOTH_COMMAND_LIMIT; i++) {
      commands.enqueue("agent-1", "forget", address(i));
    }
    expect(() =>
      commands.enqueue("agent-1", "forget", address(BLUETOOTH_COMMAND_LIMIT + 1)),
    ).toThrowError(expect.objectContaining({ code: "printer.bluetooth_command_busy" }));
    const ids = commands.current("agent-1").map(({ id }) => ({ id, ok: true }));
    commands.accept("agent-1", ids);
    for (let i = 1; i <= BLUETOOTH_COMMAND_LIMIT; i++) {
      expect(commands.latest("agent-1", address(i))).toMatchObject({ state: "succeeded" });
    }
  });

  it("drops an idle agent's expired entries once a call about another agent comes a minute on", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-idle", "forget", A);
    commands.enqueue("agent-idle", "forget", B);
    commands.accept("agent-idle", [{ id: "c2", ok: true }]);
    expect(commands.agentsHeld()).toBe(1);
    clock.now += 120_000;
    commands.current("agent-busy");
    expect(commands.agentsHeld()).toBe(0);
  });

  it("uses the real clock and random ids by default", () => {
    const commands = createPrinterBluetoothCommands();
    const first = commands.enqueue("agent-1", "forget", A);
    const second = commands.enqueue("agent-1", "forget", B);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(commands.current("agent-1")).toHaveLength(2);
  });

  it("reads Date.now at each call by default, so a replaced clock reaches it", () => {
    // Built before the clock is replaced, so a clock captured at construction would miss it.
    const commands = createPrinterBluetoothCommands();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      commands.enqueue("agent-1", "forget", A);
      vi.spyOn(Date, "now").mockReturnValue(start + 120_000);
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
    commands.enqueue("agent-1", "forget", B);
    commands.enqueue("agent-1", "pair", C, "0000");
    commands.enqueue("agent-2", "forget", D);
    const outcomes = [
      { id: "c1", ok: true },
      { id: "c2", ok: false, error: "refused" },
      { id: "c3", ok: true },
      { id: "c4", ok: true },
      { id: "unknown", ok: true },
    ];

    expect(commands.unpaired("agent-1", outcomes)).toEqual([A]);
    expect(commands.unpaired("agent-2", outcomes)).toEqual([D]);
    expect(commands.unpaired("agent-3", outcomes)).toEqual([]);
    expect(commands.latest("agent-1", A)).toMatchObject({ state: "pending" });

    commands.accept("agent-1", outcomes);
    expect(commands.unpaired("agent-1", outcomes)).toEqual([]);
  });

  it("judges an unpairing reported twice in one batch by its first outcome, as accept settles it", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "forget", A);
    commands.enqueue("agent-1", "forget", B);
    const outcomes = [
      { id: "c1", ok: false, error: "refused" },
      { id: "c1", ok: true },
      { id: "c2", ok: true },
      { id: "c2", ok: false, error: "refused" },
    ];

    expect(commands.unpaired("agent-1", outcomes)).toEqual([B]);
    commands.accept("agent-1", outcomes);
    expect(commands.latest("agent-1", A)).toMatchObject({ state: "failed" });
    expect(commands.latest("agent-1", B)).toMatchObject({ state: "succeeded" });
  });
});
