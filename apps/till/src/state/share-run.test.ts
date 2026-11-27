import { describe, expect, it } from "vitest";
import { ShareRun, type ShareTaken } from "./share-run.js";

const received = (): ShareTaken => ({});
const card = (): ShareTaken => ({ pending: "10.00" });
const settled = (): ShareTaken => ({ settled: true });

function paidShare(run: ShareRun, of: number, applied: string, taken: ShareTaken): ShareTaken {
  run.sending(of, applied);
  run.taken(taken);
  return taken;
}

describe("ShareRun", () => {
  it("holds nothing before a share is paid", () => {
    const run = new ShareRun();

    expect(run.of).toBeNull();
    expect(run.paidCount).toBe(0);
    expect(run.left).toBe(0);
    expect(run.paid).toEqual([]);
    expect(run.cardInProgress).toBe(false);
  });

  it("starts at the count the first share was split among and keeps each guest's applied amount", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", received());

    expect(run.of).toBe(3);
    expect(run.paidCount).toBe(1);
    expect(run.left).toBe(2);
    expect(run.paid).toEqual([{ amount: "24.44", state: "received" }]);
  });

  it("counts the next share when it is split among the guests left", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", received());
    paidShare(run, 2, "24.43", card());

    expect(run.of).toBe(3);
    expect(run.paidCount).toBe(2);
    expect(run.left).toBe(1);
    expect(run.paid).toEqual([
      { amount: "24.44", state: "received" },
      { amount: "24.43", state: "card" },
    ]);
  });

  it("starts again at a share split among another count", () => {
    const run = new ShareRun();
    const first = paidShare(run, 3, "24.44", card());
    paidShare(run, 4, "12.22", received());

    expect(run.of).toBe(4);
    expect(run.paid).toEqual([{ amount: "12.22", state: "received" }]);
    expect(run.counts(first)).toBe(false);
  });

  it("ends at a payment that is not a share", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", card());
    run.sending(null, "5.00");
    run.taken(received());

    expect(run.of).toBeNull();
    expect(run.paid).toEqual([]);
    expect(run.cardInProgress).toBe(false);
  });

  it("leaves the run alone at a payment the balance already included", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", received());
    run.sending(null, "5.00");
    run.taken(settled());

    expect(run.of).toBe(3);
    expect(run.paidCount).toBe(1);
  });

  it("counts a payment taken only once for the share sent before it", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", received());
    run.taken(received());

    expect(run.of).toBeNull();
  });

  it("marks a card in progress received once it is charged", () => {
    const run = new ShareRun();
    const taken = paidShare(run, 2, "36.65", card());

    expect(run.cardInProgress).toBe(true);
    expect(run.counts(taken)).toBe(true);
    run.received(taken);

    expect(run.cardInProgress).toBe(false);
    expect(run.counts(taken)).toBe(false);
    expect(run.paid).toEqual([{ amount: "36.65", state: "received" }]);
    expect(run.paidCount).toBe(1);
  });

  it("ignores a received card it never counted", () => {
    const run = new ShareRun();
    paidShare(run, 2, "36.65", card());
    run.received(card());

    expect(run.cardInProgress).toBe(true);
  });

  it("forgets everything when it ends", () => {
    const run = new ShareRun();
    const taken = paidShare(run, 3, "24.44", card());
    run.end();

    expect(run.of).toBeNull();
    expect(run.left).toBe(0);
    expect(run.paid).toEqual([]);
    expect(run.counts(taken)).toBe(false);
  });

  it("keeps the guests paid when the count changes, and the next share continues it", () => {
    const run = new ShareRun();
    paidShare(run, 3, "24.44", {});
    run.regroup(5);

    expect(run.of).toBe(5);
    expect(run.left).toBe(4);
    paidShare(run, 4, "12.22", {});
    expect(run.paid).toEqual([
      { amount: "24.44", state: "received" },
      { amount: "12.22", state: "received" },
    ]);
  });

  it("starts no record when the count changes outside one", () => {
    const run = new ShareRun();
    run.regroup(4);

    expect(run.of).toBeNull();
  });

  it("hands out copies of the paid guests", () => {
    const run = new ShareRun();
    const taken = paidShare(run, 2, "36.65", card());
    const shown = run.paid;
    run.received(taken);

    expect(shown).toEqual([{ amount: "36.65", state: "card" }]);
  });
});
