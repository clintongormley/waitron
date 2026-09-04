import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsBackend } from "./local-fs-backend.js";

describe("LocalFsBackend", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lfs-backend-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts then gets the same bytes", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-20260905T000000Z.dump.enc", Buffer.from("cipher-bytes"));
    expect((await be.get("waitron-20260905T000000Z.dump.enc")).toString()).toBe("cipher-bytes");
  });

  it("put is atomic — no .partial left behind on success", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("a.dump.enc", Buffer.from("x"));
    const listed = await be.list("waitron-");
    expect(listed.every((o) => !o.key.endsWith(".partial"))).toBe(true);
  });

  it("lists matching keys newest-first by mtime", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await new Promise((r) => setTimeout(r, 5));
    await be.put("waitron-2.dump.enc", Buffer.from("2"));
    const listed = await be.list("waitron-");
    expect(listed.map((o) => o.key)).toEqual(["waitron-2.dump.enc", "waitron-1.dump.enc"]);
    expect(listed[0].size).toBe(1);
  });

  it("delete removes a key", async () => {
    const be = new LocalFsBackend("d1", dir);
    await be.put("waitron-1.dump.enc", Buffer.from("1"));
    await be.delete("waitron-1.dump.enc");
    expect(await be.list("waitron-")).toHaveLength(0);
  });

  it("list tolerates a missing dir (returns empty)", async () => {
    const be = new LocalFsBackend("d1", join(dir, "nope"));
    expect(await be.list("waitron-")).toEqual([]);
  });
});
