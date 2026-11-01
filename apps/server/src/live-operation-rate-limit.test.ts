import { afterEach, expect, it, vi } from "vitest";
import { createLiveOperationRateLimit } from "./live-operation-rate-limit.js";

afterEach(() => vi.restoreAllMocks());

it("refuses the 61st request before its body runs and opens precisely at the next minute", async () => {
  let now = 1000;
  let bodies = 0;
  const gate = createLiveOperationRateLimit({ now: () => now });
  const run = () => gate.withAdmission(async () => ++bodies);
  for (let i = 0; i < 60; i++) await run();
  await expect(run()).rejects.toMatchObject({ code: "recovery.rate_limited", params: {} });
  expect(bodies).toBe(60);
  now = 60_999;
  await expect(run()).rejects.toMatchObject({ code: "recovery.rate_limited" });
  now = 61_000;
  expect(await run()).toBe(61);
});

it("has no queue and releases both occupied slots on success and failure", async () => {
  const gate = createLiveOperationRateLimit({ now: () => 0 });
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const first = gate.withAdmission(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const second = gate.withAdmission(
    () =>
      new Promise<void>((_done, fail) => {
        reject = fail;
      }),
  );
  let thirdEntered = false;
  await expect(
    gate.withAdmission(async () => {
      thirdEntered = true;
    }),
  ).rejects.toMatchObject({
    code: "recovery.rate_limited",
  });
  expect(thirdEntered).toBe(false);
  resolve();
  await first;
  expect(await gate.withAdmission(async () => "slot released")).toBe("slot released");
  const refused = expect(second).rejects.toThrow("failed body");
  reject(new Error("failed body"));
  await refused;
  const holds = [gate.withAdmission(async () => 1), gate.withAdmission(async () => 2)];
  expect(await Promise.all(holds)).toEqual([1, 2]);
});

it("releases a synchronously throwing body and counts refused credentials against the window", async () => {
  const gate = createLiveOperationRateLimit({ now: () => 0 });
  for (let i = 0; i < 60; i++) {
    await expect(
      gate.withAdmission(() => {
        throw new Error("wrong key");
      }),
    ).rejects.toThrow("wrong key");
  }
  await expect(gate.withAdmission(async () => "unexpected")).rejects.toMatchObject({
    code: "recovery.rate_limited",
  });
});

it("uses monotonic time despite a backwards wall clock and permits five-second rechecks", async () => {
  let monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.spyOn(Date, "now").mockReturnValue(-100_000);
  const gate = createLiveOperationRateLimit();
  for (let i = 0; i < 60; i++) await gate.withAdmission(async () => undefined);
  await expect(gate.withAdmission(async () => undefined)).rejects.toMatchObject({
    code: "recovery.rate_limited",
  });
  monotonic = 60_000;
  for (let i = 0; i < 36; i++) {
    await gate.withAdmission(async () => undefined);
    monotonic += 5000;
  }
});
