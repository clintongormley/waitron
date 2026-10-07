import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EquipmentPoll } from "./equipment-poll.js";
import type { DeviceEquipment } from "../api/client.js";

function equipment(readerId: string | null): DeviceEquipment {
  return {
    roles: [
      {
        role: "card_terminal",
        selection: readerId === null ? "default" : "item",
        chosenId: readerId,
        resolved: readerId === null ? null : { id: readerId, name: readerId, available: true },
        chosen: null,
        default: null,
        choices: [],
      },
    ],
  };
}

/** A read the test answers by hand, recording the signal it was given. */
function pendingRead() {
  const reads: {
    signal: AbortSignal;
    answer: (value: DeviceEquipment) => void;
    fail: (error: unknown) => void;
  }[] = [];
  const read = vi.fn(
    (signal: AbortSignal) =>
      new Promise<DeviceEquipment>((answer, fail) => reads.push({ signal, answer, fail })),
  );
  return { read, reads };
}

/** Lets the answered promises' continuations run under fake timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("EquipmentPoll", () => {
  it("reads the device's equipment every 15 seconds once started, and reports each answer", async () => {
    const { read, reads } = pendingRead();
    const onEquipment = vi.fn();
    const poll = new EquipmentPoll({ read, onEquipment });
    poll.start();
    vi.advanceTimersByTime(14_999);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(read).toHaveBeenCalledOnce();
    reads[0]!.answer(equipment("R1"));
    await settle();
    expect(onEquipment).toHaveBeenCalledWith(equipment("R1"));
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it("does not read before it is started, nor start a second timer when started twice", () => {
    const { read } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    vi.advanceTimersByTime(30_000);
    expect(read).not.toHaveBeenCalled();
    poll.start();
    poll.start();
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it("stops reading on stop, cancels a read still out, and reports nothing it answers", async () => {
    const { read, reads } = pendingRead();
    const onEquipment = vi.fn();
    const poll = new EquipmentPoll({ read, onEquipment });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    expect(reads[0]!.signal.aborted).toBe(true);
    reads[0]!.answer(equipment("R1"));
    await settle();
    vi.advanceTimersByTime(60_000);
    expect(read).toHaveBeenCalledOnce();
    expect(onEquipment).not.toHaveBeenCalled();
    expect(poll.running).toBe(false);
  });

  it("treats a device.unauthorized answer as the device gone and stops", async () => {
    const { read, reads } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    reads[0]!.fail({ code: "device.unauthorized", status: 401 });
    await settle();
    expect(poll.running).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(read).toHaveBeenCalledOnce();
  });

  it("keeps polling after any other failure", async () => {
    const { read, reads } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    reads[0]!.fail(new TypeError("Failed to fetch"));
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(poll.running).toBe(true);
    poll.stop();
  });

  it("a read cancelled by a stop that then fails device.unauthorized does not stop the poll started again", async () => {
    const { read, reads } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    poll.stop();
    poll.start();
    reads[0]!.fail({ code: "device.unauthorized", status: 401 });
    await settle();
    expect(poll.running).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(read).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it("an older read failing device.unauthorized after a newer one answered does not stop the poll", async () => {
    const { read, reads } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(30_000);
    reads[1]!.answer(equipment("R1"));
    await settle();
    reads[0]!.fail({ code: "device.unauthorized", status: 401 });
    await settle();
    expect(poll.running).toBe(true);
    poll.stop();
  });

  it("cancels a read that has been out for 25 seconds", () => {
    const { read, reads } = pendingRead();
    const poll = new EquipmentPoll({ read, onEquipment: vi.fn() });
    poll.start();
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(24_999);
    expect(reads[0]!.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(reads[0]!.signal.aborted).toBe(true);
    poll.stop();
  });

  it("never lets an older read that answers late overwrite a newer answer", async () => {
    const { read, reads } = pendingRead();
    const onEquipment = vi.fn();
    const poll = new EquipmentPoll({ read, onEquipment });
    poll.start();
    vi.advanceTimersByTime(30_000);
    reads[1]!.answer(equipment("R2"));
    await settle();
    reads[0]!.answer(equipment("R1"));
    await settle();
    expect(onEquipment.mock.calls).toEqual([[equipment("R2")]]);
    poll.stop();
  });
});
