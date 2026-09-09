import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBoxEnv } from "./box-env.js";

async function boxWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wt-env-"));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}

describe("loadBoxEnv", () => {
  it("returns the base unchanged when no files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-env-"));
    expect(await loadBoxEnv({ A: "1" }, dir)).toEqual({ A: "1" });
  });

  it("loads all three files", async () => {
    const dir = await boxWith({
      "instance.env": "DATABASE_URL=postgres://app\n",
      "secrets.env": "WAITRON_CREDENTIALS_KEY=k\n",
      "trading.env": "WAITRON_ENV=production\n",
    });
    const env = await loadBoxEnv({}, dir);
    expect(env.DATABASE_URL).toBe("postgres://app");
    expect(env.WAITRON_CREDENTIALS_KEY).toBe("k");
    expect(env.WAITRON_ENV).toBe("production");
  });

  it("trading.env beats instance.env — the promote rewrites trading.env", async () => {
    const dir = await boxWith({
      "instance.env": "DATABASE_URL=postgres://from-instance\n",
      "trading.env": "DATABASE_URL=postgres://from-trading\n",
    });
    expect((await loadBoxEnv({}, dir)).DATABASE_URL).toBe("postgres://from-trading");
  });

  it("THE ENVIRONMENT BEATS EVERY FILE — when non-empty", async () => {
    const dir = await boxWith({ "secrets.env": "WAITRON_CREDENTIALS_KEY=from-file\n" });
    const env = await loadBoxEnv({ WAITRON_CREDENTIALS_KEY: "from-env" }, dir);
    expect(env.WAITRON_CREDENTIALS_KEY).toBe("from-env");
  });

  it("an empty base value does not mask a file value (compose ${VAR:-} case)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxenv-"));
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    const merged = await loadBoxEnv({ WAITRON_BACKUP_DIR: "" }, dir);
    expect(merged.WAITRON_BACKUP_DIR).toBe("/mnt/usb");
  });

  it("a non-empty base value still wins over the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boxenv-"));
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    const merged = await loadBoxEnv({ WAITRON_BACKUP_DIR: "/mnt/env" }, dir);
    expect(merged.WAITRON_BACKUP_DIR).toBe("/mnt/env");
  });
});
