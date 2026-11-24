import { describe, expect, it, vi } from "vitest";
import type { BillBalance, HeldOrderSummary } from "../api/client.js";
import { CounterOverpaidRead } from "./counter-overpaid.js";

const row = (outstanding: string, id = "wo-1") => ({ id, outstanding }) as HeldOrderSummary;
const balance = (overpaid: string) => ({ workingOrderId: "wo-1", overpaid }) as BillBalance;

describe("CounterOverpaidRead", () => {
  it("reads nothing for an order the held list says is not paid over its total", () => {
    const read = vi.fn();
    const counter = new CounterOverpaidRead(read, () => {});

    expect(counter.balanceFor(undefined)).toBeNull();
    expect(counter.balanceFor(row("0.00"))).toBeNull();
    expect(counter.balanceFor(row("3.00"))).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the balance once for each held-list row, and again for a refreshed one", async () => {
    const read = vi.fn(async () => balance("7.00"));
    const answered = vi.fn();
    const counter = new CounterOverpaidRead(read, answered);
    const listed = row("-5.00");

    expect(counter.balanceFor(listed)).toBeUndefined();
    await vi.waitFor(() => expect(answered).toHaveBeenCalledOnce());
    expect(counter.balanceFor(listed)).toEqual(balance("7.00"));
    expect(read).toHaveBeenCalledExactlyOnceWith("wo-1");

    expect(counter.balanceFor(row("-5.00"))).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers null once the read fails", async () => {
    const answered = vi.fn();
    const counter = new CounterOverpaidRead(() => Promise.reject(new Error("down")), answered);
    const listed = row("-5.00");

    counter.balanceFor(listed);
    await vi.waitFor(() => expect(answered).toHaveBeenCalledOnce());

    expect(counter.balanceFor(listed)).toBeNull();
  });

  it("drops an answer for a row the basket has moved past", async () => {
    let release!: (value: BillBalance) => void;
    const read = vi
      .fn<(billId: string) => Promise<BillBalance>>()
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockResolvedValue(balance("2.00"));
    const answered = vi.fn();
    const counter = new CounterOverpaidRead(read, answered);

    counter.balanceFor(row("-5.00"));
    const later = row("-2.00", "wo-2");
    counter.balanceFor(later);
    await vi.waitFor(() => expect(answered).toHaveBeenCalledOnce());
    release(balance("5.00"));
    await Promise.resolve();

    expect(answered).toHaveBeenCalledOnce();
    expect(counter.balanceFor(later)).toEqual(balance("2.00"));
  });
});
