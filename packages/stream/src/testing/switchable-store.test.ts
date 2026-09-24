import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { probeBucket } from "../probe.js";
import { SwitchableStore } from "./switchable-store.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const AT = new Date("2026-09-24T10:00:00Z");

const settledWithin = async <T>(promise: Promise<T>, ms: number): Promise<boolean> => {
  const late = Symbol("late");
  const winner = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<typeof late>((resolve) => setTimeout(() => resolve(late), ms)),
  ]);
  return winner !== late;
};

describe("SwitchableStore", () => {
  it("passes the bucket check, so it honours both conditional writes", async () => {
    expect(await probeBucket(new SwitchableStore(() => AT))).toEqual({ ok: true });
  });

  it("fails the check as a store without conditional writes when told to ignore them", async () => {
    const store = new SwitchableStore(() => AT);
    store.honoursConditions = false;
    expect(await probeBucket(store)).toMatchObject({ ok: false, reason: "create_only_ignored" });
  });

  it("reads as refused to the bucket check while denied", async () => {
    const store = new SwitchableStore(() => AT);
    store.denied = true;
    expect(await probeBucket(store)).toMatchObject({
      ok: false,
      reason: "access_denied",
      detail: "AccessDenied (403)",
    });
  });

  it("reads as no answer to the bucket check while down, which the check throws", async () => {
    const store = new SwitchableStore(() => AT);
    store.down = true;
    const failure = await probeBucket(store).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "put", status: null },
    });
  });

  it("never answers the bucket check while hung", async () => {
    const store = new SwitchableStore(() => AT);
    store.hang = true;
    expect(await settledWithin(probeBucket(store), 50)).toBe(false);
  });

  it("refuses every operation by name while denied", async () => {
    const store = new SwitchableStore(() => AT);
    store.denied = true;
    for (const [operation, call] of [
      ["get", () => store.get("k")],
      ["put", () => store.put("k", bytes("x"))],
      ["list", () => store.list("k")],
      ["delete", () => store.delete("k")],
    ] as const) {
      await expect(call()).rejects.toMatchObject({
        code: "backup.stream_request_failed",
        params: { operation, key: "k", status: 403, name: "AccessDenied" },
      });
    }
  });

  it("stamps writes from its clock, and an upload at the time it is given, stored on return", async () => {
    let now = AT;
    const store = new SwitchableStore(() => now);
    await store.put("a", bytes("one"));
    now = new Date(AT.getTime() + 1_000);
    const earlier = new Date(AT.getTime() - 60_000);
    store.upload("b", earlier);
    expect(store.has("b")).toBe(true);
    store.upload("c");
    expect(await store.list("")).toEqual([
      { key: "a", lastModified: AT },
      { key: "b", lastModified: earlier },
      { key: "c", lastModified: now },
    ]);
    await store.delete("a");
    expect(store.has("a")).toBe(false);
    expect(await store.get("b")).toMatchObject({ body: new Uint8Array() });
  });

  it("logs answered writes and uploads in one order, and not a refused write", async () => {
    const events: string[] = ["spawn replicate"];
    const store = new SwitchableStore(() => AT, events);
    await store.put("marker", bytes("m"), { ifNoneMatch: "*" });
    store.upload("copy");
    await expect(store.put("marker", bytes("m"), { ifNoneMatch: "*" })).rejects.toMatchObject({
      code: "backup.stream_precondition_failed",
    });
    expect(events).toEqual(["spawn replicate", "put marker", "upload copy"]);
  });

  it("stores a write whose answer a fault loses", async () => {
    const store = new SwitchableStore(() => AT);
    store.failNext({ operation: "put", key: "p", error: new Error("reset"), landed: true });
    await expect(store.put("p", bytes("x"))).rejects.toThrow("reset");
    expect(store.has("p")).toBe(true);
  });
});
