import { expect, it } from "vitest";
import * as locked from "./cloud-locked-start.js";

const current = { version: 7, key: Buffer.alloc(32, 7).toString("base64") };
const previous = { version: 3, key: Buffer.alloc(32, 3).toString("base64") };
const read = () => locked.readLockedTotpKeys;

it.each([previous, null])(
  "decodes original purpose-key versions and removes the environment payload: %s",
  (old) => {
    const env = { WAITRON_LOCKED_TOTP_KEYS: JSON.stringify({ current, previous: old }) };
    expect(read()(env)).toEqual([
      { version: 7, key: Buffer.alloc(32, 7) },
      ...(old ? [{ version: 3, key: Buffer.alloc(32, 3) }] : []),
    ]);
    expect(Object.hasOwn(env, "WAITRON_LOCKED_TOTP_KEYS")).toBe(false);
  },
);
it.each([
  undefined,
  "",
  "null",
  "{",
  JSON.stringify({ current }),
  JSON.stringify({ current, previous, extra: true }),
  JSON.stringify({ current, previous: current }),
  JSON.stringify({ current: { ...current, version: 0 }, previous: null }),
  JSON.stringify({ current: { ...current, version: Number.MAX_SAFE_INTEGER + 1 }, previous: null }),
  JSON.stringify({ current: { ...current, key: current.key.slice(0, -1) }, previous: null }),
  JSON.stringify({
    current: { ...current, key: Buffer.alloc(31).toString("base64") },
    previous: null,
  }),
  JSON.stringify({ current: { ...current, extra: true }, previous: null }),
])(
  "refuses malformed purpose input and removes it without a retired account-key fallback: %s",
  (raw) => {
    const env = { WAITRON_LOCKED_TOTP_KEYS: raw, WAITRON_ACCOUNT_KEY: current.key };
    expect(() => read()(env)).toThrow("cloud.request_invalid");
    expect(Object.hasOwn(env, "WAITRON_LOCKED_TOTP_KEYS")).toBe(false);
  },
);

it("refuses a missing or malformed payload before writing folder metadata and removes it before exit", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = await mkdtemp(join(tmpdir(), "locked-input-"));
  try {
    for (const payload of [undefined, "null"]) {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        WAITRON_LOCKED_COPY: JSON.stringify({ venueDir: folder, stateDir: folder }),
      };
      delete env.WAITRON_LOCKED_TOTP_KEYS;
      if (payload !== undefined) env.WAITRON_LOCKED_TOTP_KEYS = payload;
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `process.on('exit', () => console.log('payload-present=' + Object.hasOwn(process.env, 'WAITRON_LOCKED_TOTP_KEYS'))); await import('./src/cloud-locked-entry.ts');`,
        ],
        { env, encoding: "utf8", timeout: 30000 },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(1);
      expect(child.stderr).toContain("cloud.request_invalid");
      expect(child.stdout).toContain("payload-present=false");
      expect(await readdir(folder)).toEqual([]);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}, 75000);
