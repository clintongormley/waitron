import { describe, expect, it } from "vitest";
import { inTurn, keysInTurn } from "./attempt-turns.js";

/** A promise and the function that settles it. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("inTurn", () => {
  it("starts an attempt on a key only once the one ahead of it has settled", async () => {
    const throttle = {};
    const steps: string[] = [];
    const first = gate();

    const one = inTurn(throttle, "k", async () => {
      steps.push("first starts");
      await first.opened;
      steps.push("first settles");
    });
    const two = inTurn(throttle, "k", async () => {
      steps.push("second starts");
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(steps).toEqual(["first starts"]);
    first.open();
    await Promise.all([one, two]);

    expect(steps).toEqual(["first starts", "first settles", "second starts"]);
  });

  it("does not hold back an attempt on another key or another throttle", async () => {
    const throttle = {};
    const held = gate();
    const steps: string[] = [];

    const blocked = inTurn(throttle, "k", () => held.opened);
    await inTurn(throttle, "other", async () => {
      steps.push("other key");
    });
    await inTurn({}, "k", async () => {
      steps.push("other throttle");
    });
    held.open();
    await blocked;

    expect(steps).toEqual(["other key", "other throttle"]);
  });

  it("lets the next attempt start after one that throws, which still throws to its caller", async () => {
    const throttle = {};
    const failing = inTurn(throttle, "k", async () => {
      throw new Error("refused");
    });
    const next = inTurn(throttle, "k", async () => "ran");

    await expect(failing).rejects.toThrow("refused");
    expect(await next).toBe("ran");
  });

  it("forgets a key once nothing runs or waits on it", async () => {
    const throttle = {};
    const held = gate();

    const running = inTurn(throttle, "k", () => held.opened);
    const waiting = inTurn(throttle, "k", async () => undefined);
    expect(keysInTurn(throttle)).toBe(1);
    held.open();
    await Promise.all([running, waiting]);

    expect(keysInTurn(throttle)).toBe(0);
    expect(keysInTurn({})).toBe(0);
  });
});
