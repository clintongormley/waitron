import { describe, expect, it } from "vitest";
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
    expect(status).toEqual({ id: "c1", kind: "pair", address: A, state: "pending" });
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
    expect(pending).toEqual({ id: "c1", kind: "pair", address: A, state: "pending" });
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
    expect(commands.enqueue("agent-1", "pair", A, "0000")).toEqual(first);
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
    expect(commands.enqueue("agent-1", "forget", B)).toMatchObject({ id: "c2" });
    expect(commands.current("agent-1")).toEqual([
      { id: "c1", kind: "pair", address: A, pin: "0000" },
      { id: "c2", kind: "forget", address: B },
    ]);
    // A duplicate does not extend the original command's life.
    clock.now += 30_000;
    expect(commands.current("agent-1")).toEqual([{ id: "c2", kind: "forget", address: B }]);
  });

  it("replaces a pending pair under a new id when the operator retypes a different PIN", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 30_000;
    const retyped = commands.enqueue("agent-1", "pair", A, "1234");
    expect(retyped).toEqual({ id: "c2", kind: "pair", address: A, state: "pending" });
    expect(commands.current("agent-1")).toEqual([
      { id: "c2", kind: "pair", address: A, pin: "1234" },
    ]);
    commands.accept("agent-1", [{ id: "c1", ok: false, error: "wrong PIN" }]);
    expect(commands.latest("agent-1", A)).toEqual(retyped);
    // The replacement's life starts at the retype.
    clock.now += 59_999;
    expect(commands.current("agent-1")).toHaveLength(1);
    commands.enqueue("agent-1", "pair", A);
    expect(commands.current("agent-1")).toEqual([{ id: "c3", kind: "pair", address: A }]);
  });

  it("replaces the opposite operation for the same address and ignores the replaced id", () => {
    const { commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    const forget = commands.enqueue("agent-1", "forget", A);
    expect(forget).toEqual({ id: "c2", kind: "forget", address: A, state: "pending" });
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

    clock.now += 60_000;
    expect(commands.enqueue("agent-1", "forget", address(10))).toMatchObject({ id: "c11" });
  });

  it("expires a pending command 60 seconds after it was queued, with no result", () => {
    const { clock, commands } = store();
    commands.enqueue("agent-1", "pair", A, "0000");
    clock.now += 59_999;
    expect(commands.current("agent-1")).toHaveLength(1);
    clock.now += 1;
    expect(commands.current("agent-1")).toEqual([]);
    expect(commands.latest("agent-1", A)).toBeUndefined();
    commands.accept("agent-1", [{ id: "c1", ok: true }]);
    expect(commands.latest("agent-1", A)).toBeUndefined();
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
    expect(other).toEqual({ id: "c9", kind: "pair", address: address(1), state: "pending" });
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

  it("uses the real clock and random ids by default", () => {
    const commands = createPrinterBluetoothCommands();
    const first = commands.enqueue("agent-1", "forget", A);
    const second = commands.enqueue("agent-1", "forget", B);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(commands.current("agent-1")).toHaveLength(2);
  });
});
