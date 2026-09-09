import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileState } from "./state.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "print-agent-state-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileState", () => {
  it("reads null before anything is written; writes the token 0600 atomically; null clears it", async () => {
    const state = new FileState(dir);
    expect(await state.readToken()).toBeNull();
    expect(await state.readConfig()).toBeNull();

    await state.writeToken("a1.secret");
    expect(await state.readToken()).toBe("a1.secret");
    expect((await stat(join(dir, "token"))).mode & 0o777).toBe(0o600);
    // Written via a temp file + rename, so a reader never sees a half-written token.
    expect(await readdir(dir)).not.toContain("token.tmp");

    await state.writeToken(null);
    expect(await state.readToken()).toBeNull();

    await state.writeConfig({ serverUrl: "https://a", name: "n" });
    expect(await state.readConfig()).toEqual({ serverUrl: "https://a", name: "n" });
  });

  it("preserves the environment field on a config round-trip", async () => {
    const state = new FileState(dir);
    await state.writeConfig({ serverUrl: "https://a", name: "n", environment: "production" });
    expect(await state.readConfig()).toEqual({
      serverUrl: "https://a",
      name: "n",
      environment: "production",
    });
  });

  it("preserves the pending verification number on a config round-trip", async () => {
    const state = new FileState(dir);
    await state.writeConfig({ serverUrl: "https://a", name: "n", pendingVerificationNumber: "07" });
    expect(await state.readConfig()).toEqual({
      serverUrl: "https://a",
      name: "n",
      pendingVerificationNumber: "07",
    });
  });

  it("survives many concurrent config saves without a temp-file race, leaving one valid JSON", async () => {
    const state = new FileState(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        state.writeConfig({ serverUrl: `https://a${i}`, name: "n" }),
      ),
    );
    const config = await state.readConfig();
    expect(config).not.toBeNull();
    expect(config?.name).toBe("n");
  });

  it("creates the state directory on first write", async () => {
    const nested = join(dir, "does", "not", "exist");
    const state = new FileState(nested);
    await state.writeToken("t");
    expect(await state.readToken()).toBe("t");
  });

  it("reads a corrupt config.json as null (the page asks again) and does not throw", async () => {
    const state = new FileState(dir);
    await writeFile(join(dir, "config.json"), "{ this is not json");
    expect(await state.readConfig()).toBeNull();
  });

  it("reads a config missing required fields as null", async () => {
    const state = new FileState(dir);
    await writeFile(join(dir, "config.json"), JSON.stringify({ serverUrl: "https://a" }));
    expect(await state.readConfig()).toBeNull();
  });

  it("clearing a token that was never written is a no-op, not an error", async () => {
    const state = new FileState(dir);
    await expect(state.writeToken(null)).resolves.toBeUndefined();
    expect(await state.readToken()).toBeNull();
  });

  it("trims a trailing newline off a stored token", async () => {
    const state = new FileState(dir);
    await writeFile(join(dir, "token"), "tok\n");
    expect(await state.readToken()).toBe("tok");
  });

  it("does not leave a temp file behind after writing the config", async () => {
    const state = new FileState(dir);
    await state.writeConfig({ serverUrl: "https://a", name: "n" });
    expect(await readdir(dir)).not.toContain("config.json.tmp");
  });
});
