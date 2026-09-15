import { describe, expect, it } from "vitest";
import { closeAll } from "./close-all.js";

describe("closeAll", () => {
  it("resolves once every closer has resolved", async () => {
    const closed: string[] = [];
    await closeAll([async () => void closed.push("a"), async () => void closed.push("b")]);
    expect(closed).toEqual(["a", "b"]);
  });

  it("still runs every later closer when an earlier one rejects, then rethrows the first failure", async () => {
    const closed: string[] = [];
    const first = new Error("first");
    const second = new Error("second");
    const outcome = closeAll([
      () => Promise.reject(first),
      async () => void closed.push("b"),
      () => Promise.reject(second),
      async () => void closed.push("d"),
    ]);
    await expect(outcome).rejects.toBe(first);
    expect(closed).toEqual(["b", "d"]);
  });

  it("treats a closer that throws synchronously like one that rejects", async () => {
    const closed: string[] = [];
    const boom = new Error("sync");
    const outcome = closeAll([
      () => {
        throw boom;
      },
      async () => void closed.push("b"),
    ]);
    await expect(outcome).rejects.toBe(boom);
    expect(closed).toEqual(["b"]);
  });
});
