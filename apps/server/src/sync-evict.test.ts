import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { evictSubscriberCommand } from "./sync-evict.js";

describe("evictSubscriberCommand", () => {
  it("requires a subscriberId", async () => {
    const out: string[] = [];
    const code = await evictSubscriberCommand({
      argv: [],
      env: { WAITRON_SYNC_RETENTION_DATABASE_URL: "x" },
      connect: async () => ({}) as Database,
      out: (l) => out.push(l),
    });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/usage/i);
  });

  it("requires WAITRON_SYNC_RETENTION_DATABASE_URL", async () => {
    const code = await evictSubscriberCommand({
      argv: ["peerB"],
      env: {},
      connect: async () => ({}) as Database,
      out: () => {},
    });
    expect(code).toBe(2);
  });

  it("evicts and closes the pool", async () => {
    const close = vi.fn(async () => {});
    const execute = vi.fn(async () => ({ rows: [{ subscriber_id: "peerB" }] }));
    const db = { execute, close } as unknown as Database;
    const out: string[] = [];
    const code = await evictSubscriberCommand({
      argv: ["peerB"],
      env: { WAITRON_SYNC_RETENTION_DATABASE_URL: "postgres://x" },
      connect: async () => db,
      out: (l) => out.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/peerB.*1/);
    expect(close).toHaveBeenCalledOnce();
  });
});
