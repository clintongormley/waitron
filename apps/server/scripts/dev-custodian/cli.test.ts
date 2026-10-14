import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDevCustodian } from "./cli.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "waitron-dev-custodian-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[], env: NodeJS.ProcessEnv, input = "") {
  let stdout = "";
  let stderr = "";
  const code = await runDevCustodian(argv, {
    env,
    stdin: Readable.from([input]),
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
  });
  return { code, stdout, stderr };
}

const dev = { WAITRON_ENV: "dev" };

async function snapshot(path: string) {
  return { bytes: await readFile(path), mtimeMs: (await stat(path)).mtimeMs };
}

describe("dev:custodian init", () => {
  it("init writes a private key, a public custodian file and three settings", async () => {
    const result = await run(["init", "--dir", dir], dev);
    expect(result.code).toBe(0);
    expect((await stat(join(dir, "key.pem"))).mode & 0o777).toBe(0o600);
    const custodian = JSON.parse(await readFile(join(dir, "custodian.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(custodian).sort()).toEqual(["custodianId", "fingerprint", "publicKey"]);
    expect(result.stdout).toBe(
      [
        `WAITRON_FISCAL_CUSTODIAN_FILE=${join(dir, "custodian.json")}`,
        `WAITRON_FISCAL_CONFIRMATION_FILE=${join(dir, "confirmation.json")}`,
        `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT=${String(custodian.fingerprint)}`,
        "",
      ].join("\n"),
    );
  });

  it("init reuses an existing key", async () => {
    const first = await run(["init", "--dir", dir], dev);
    const key = await readFile(join(dir, "key.pem"));
    const second = await run(["init", "--dir", dir], dev);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(await readFile(join(dir, "key.pem"))).toEqual(key);
  });

  it("init refuses production and writes nothing", async () => {
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("deployment.development_custodian_refused");
    expect(await readdir(dir)).toEqual([]);
  });

  it("init refuses production when a key already exists, and changes nothing", async () => {
    await run(["init", "--dir", dir], dev);
    const key = await snapshot(join(dir, "key.pem"));
    const custodian = await snapshot(join(dir, "custodian.json"));
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("deployment.development_custodian_refused");
    expect(result.stdout).toBe("");
    expect(await snapshot(join(dir, "key.pem"))).toEqual(key);
    expect(await snapshot(join(dir, "custodian.json"))).toEqual(custodian);
  });

  it("init accepts an empty WAITRON_ENV", async () => {
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "" });
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(3);
  });

  it("unknown subcommand prints usage", async () => {
    const result = await run(["frobnicate"], dev);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("usage: dev:custodian");
  });
});
