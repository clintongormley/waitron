import { expect, it, vi } from "vitest";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import { startClockState } from "./start-clock-check.js";

it("asks whether records are filed at each call, so a box that starts filing while waiting is refused from that call", async () => {
  const tx = {} as Transaction;
  const reading = { instant: new Date("2026-11-10T10:00:00.000Z"), offsetMinutes: 60 };
  let files = false;
  const refuseWhileClockBehind = vi.fn(async () => {});
  const gated = gateSeatOnStartClock(
    { refuseWhileClockBehind } as unknown as FiscalBackend,
    startClockGateHolds(
      startClockState(),
      () => files,
      () => false,
    ),
  );

  await expect(gated.refuseWhileClockBehind(tx, reading)).resolves.toBeUndefined();
  expect(refuseWhileClockBehind).toHaveBeenCalledExactlyOnceWith(tx, reading);

  files = true;
  await expect(gated.refuseWhileClockBehind(tx, reading)).rejects.toMatchObject({
    code: "clock.unconfirmed",
    params: {},
  });
  expect(refuseWhileClockBehind).toHaveBeenCalledTimes(1);
});

it.each(["by_devices", "by_person", "by_internet"] as const)(
  "holds while a clock set is with the host on a start confirmed %s, and only on a box that files records",
  (by) => {
    const state = startClockState();
    state.confirm(by, {});
    let files = true;
    let setting = false;
    const holds = startClockGateHolds(
      state,
      () => files,
      () => setting,
    );

    expect(holds()).toBe(false);
    setting = true;
    expect(holds()).toBe(true);
    files = false;
    expect(holds()).toBe(false);
    files = true;
    setting = false;
    expect(holds()).toBe(false);
  },
);
