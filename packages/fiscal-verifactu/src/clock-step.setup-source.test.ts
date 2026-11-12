import { describe, expect, it } from "vitest";
import type { Transaction } from "@waitron/db";
import type { ClockAdminConfirm, ClockStepRequest } from "@waitron/fiscal";
import { confirmClockStep } from "./clock-step.js";

const T = Date.parse("2026-10-19T21:40:00.000Z");
const reading = (ms: number) => ({ instant: new Date(ms), offsetMinutes: 60 });
const READING = { boxAt: new Date(T).toISOString(), witnessAt: new Date(T).toISOString() };

const LUIS: ClockAdminConfirm = {
  personId: "person-luis",
  personName: "Luis",
  reading: { ...READING, uncertaintyMs: 30 },
};

const ANA_ON_A_DEVICE: ClockAdminConfirm = {
  personId: "person-ana",
  personName: "Ana",
  role: "staff",
  reading: { ...READING, uncertaintyMs: 40 },
  device: { deviceId: "till-1", deviceLabel: "Barra 1", address: "10.0.0.1" },
};

function request(over: Partial<ClockStepRequest>): ClockStepRequest {
  return {
    before: reading(T - 60_000),
    after: reading(T),
    bootBefore: { ms: 1_000, id: "boot-1" },
    bootAfter: { ms: 3_000, id: "boot-1" },
    targetAt: new Date(T).toISOString(),
    stepMs: 60_000,
    verified: true,
    reason: "start",
    source: "setup",
    witnesses: [],
    nodeId: "node-1",
    ...over,
  };
}

/** A transaction that records every property read and refuses it. */
function untouchable(): { tx: Transaction; used: string[] } {
  const used: string[] = [];
  const tx = new Proxy(
    {},
    {
      get(_target, key) {
        used.push(String(key));
        throw new Error(`transaction used: ${String(key)}`);
      },
    },
  ) as Transaction;
  return { tx, used };
}

describe("the regime's clock step refuses a setup step", () => {
  it.each([
    ["with no person", {}],
    ["with an administrator", { admin: LUIS }],
    ["with a staff member on a device", { admin: ANA_ON_A_DEVICE }],
  ])("refuses it %s before touching the transaction", async (_name, over) => {
    const { tx, used } = untouchable();

    await expect(confirmClockStep(tx, request(over))).rejects.toThrow(
      "confirmClockStep: a setup step was given a person that does not match it",
    );
    expect(used).toEqual([]);
  });

  it("a staff step with the same person gets past the check to the transaction", async () => {
    const { tx, used } = untouchable();

    await expect(
      confirmClockStep(tx, request({ source: "staff", admin: ANA_ON_A_DEVICE })),
    ).rejects.toThrow(/transaction used/);
    expect(used).not.toEqual([]);
  });
});
