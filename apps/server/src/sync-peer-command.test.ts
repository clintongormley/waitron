import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { syncPeerCommand } from "./sync-peer-command.js";

const RETENTION = { WAITRON_SYNC_RETENTION_DATABASE_URL: "postgres://x" };

describe("syncPeerCommand", () => {
  it("requires WAITRON_SYNC_RETENTION_DATABASE_URL", async () => {
    const code = await syncPeerCommand({
      argv: ["list"],
      env: {},
      connect: async () => ({}) as Database,
      out: () => {},
    });
    expect(code).toBe(2);
  });

  it("closes the pool even when the operation throws (withDb finally)", async () => {
    const close = vi.fn(async () => {});
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    const db = { execute, close } as unknown as Database;
    await expect(
      syncPeerCommand({ argv: ["list"], env: RETENTION, connect: async () => db, out: () => {} }),
    ).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledOnce();
  });

  it("enrol prints the token exactly once and closes the pool", async () => {
    const close = vi.fn(async () => {});
    const execute = vi.fn(async () => ({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }));
    const db = { execute, close } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["enrol", "cloud", "DR", "mirror"],
      env: RETENTION,
      connect: async () => db,
      out: (l) => out.push(l),
    });
    expect(code).toBe(0);
    const joined = out.join("\n");
    // the token is <peerId>.<secret>; it appears on exactly one line
    const tokenLines = out.filter((l) =>
      /^11111111-1111-4111-8111-111111111111\.[A-Za-z0-9_-]+$/.test(l),
    );
    expect(tokenLines).toHaveLength(1);
    expect(joined).toMatch(/cloud/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("enrol requires a subscriberId and a name", async () => {
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["enrol", "cloud"],
      env: RETENTION,
      connect: async () => ({}) as Database,
      out: (l) => out.push(l),
    });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/usage/i);
  });

  it("revoke reports false with exit 1 for an unknown peer", async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [] })),
      close: vi.fn(async () => {}),
    } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["revoke", "22222222-2222-4222-8222-222222222222"],
      env: RETENTION,
      connect: async () => db,
      out: (l) => out.push(l),
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no active peer/i);
  });

  it("list prints a placeholder when empty", async () => {
    const db = {
      execute: vi.fn(async () => ({ rows: [] })),
      close: vi.fn(async () => {}),
    } as unknown as Database;
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["list"],
      env: RETENTION,
      connect: async () => db,
      out: (l) => out.push(l),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/no peers/i);
  });

  it("an unknown subcommand prints usage and exits 2", async () => {
    const out: string[] = [];
    const code = await syncPeerCommand({
      argv: ["frobnicate"],
      env: RETENTION,
      connect: async () => ({}) as Database,
      out: (l) => out.push(l),
    });
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/usage/i);
  });
});
