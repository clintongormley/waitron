import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import { replicaUrl } from "./litestream.js";
import { restoreGeneration } from "./restore.js";

let dir: string;
let bin: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "waitron-stream-restore-"));
  bin = join(dir, "litestream");
  // The child gets PATH, HOME and the two key variables only, so what each case varies travels in a
  // control file the stub sources, not in the environment. It records its argv, the two key
  // variables and its whole environment, then behaves as STUB_MODE says.
  await writeFile(
    bin,
    [
      "#!/bin/sh",
      `. ${JSON.stringify(join(dir, "control"))}`,
      'printf "%s\\n" "$@" > "$STUB_OUT/argv"',
      'printf "%s %s" "$WAITRON_STREAM_ACCESS_KEY_ID" "$WAITRON_STREAM_SECRET_ACCESS_KEY" > "$STUB_OUT/creds"',
      'env > "$STUB_OUT/env"',
      'out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done',
      'case "$STUB_MODE" in',
      '  ok) printf "db" > "$out"; exit 0 ;;',
      '  fail) echo "Error: no matching backup files available" >&2; exit 1 ;;',
      '  full) printf "par" > "$out.tmp"; echo "write $out.tmp: no space left on device" >&2; exit 1 ;;',
      // Keeps growing its output, slowly, then finishes: must NOT be abandoned.
      '  slow) i=0; while [ $i -lt 10 ]; do printf x >> "$out.tmp"; sleep 0.1; i=$((i+1)); done; mv "$out.tmp" "$out"; exit 0 ;;',
      // Keeps growing for ever: only the absolute ceiling stops it.
      '  endless) while :; do printf x >> "$out.tmp"; sleep 0.05; done ;;',
      // Writes once, then goes quiet: must be abandoned once the output stops growing.
      '  stall) printf x > "$out.tmp"; exec sleep 30 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  await chmod(bin, 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BUCKET = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "venue-copy",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "not-a-real-secret-0123456789",
};

const GENERATION = "gen-3-n1-20260923T101500Z";

type Bounds = { stallMs?: number; ceilingMs?: number; pollMs?: number };

async function run(mode: string, bounds: Bounds = {}, bucket = BUCKET) {
  const out = await mkdtemp(join(dir, "case-"));
  await writeFile(join(dir, "control"), `STUB_OUT=${JSON.stringify(out)}\nSTUB_MODE=${mode}\n`);
  const outPath = join(out, "venue.db");
  const promise = restoreGeneration({
    litestreamBin: bin,
    bucket,
    venueId: "v1",
    generation: GENERATION,
    outPath,
    configDir: join(out, "litestream"),
    ...bounds,
  });
  return { out, outPath, promise };
}

describe("restoreGeneration", () => {
  it("restores the named generation into the output file, credentials through the environment only", async () => {
    const { out, outPath, promise } = await run("ok");
    await promise;
    expect(await readFile(outPath, "utf8")).toBe("db");
    const argv = (await readFile(join(out, "argv"), "utf8")).trim().split("\n");
    expect(argv.slice(0, 5)).toEqual([
      "restore",
      "-config",
      join(out, "litestream", "restore.yml"),
      "-o",
      outPath,
    ]);
    expect(await readFile(join(out, "creds"), "utf8")).toBe(
      `${BUCKET.accessKeyId} ${BUCKET.secretAccessKey}`,
    );
    const config = await readFile(join(out, "litestream", "restore.yml"), "utf8");
    expect(config).toContain(JSON.stringify(replicaUrl(BUCKET, "v1", GENERATION)));
    expect(config).not.toContain(BUCKET.secretAccessKey);
    expect((await stat(join(out, "litestream", "restore.yml"))).mode & 0o777).toBe(0o600);
  });

  it("gives the child no WAITRON_ variable but the two bucket-key ones", async () => {
    process.env.WAITRON_BACKUP_RECOVERY_KEY = "must-not-reach-the-child";
    try {
      const { out, promise } = await run("ok");
      await promise;
      const names = (await readFile(join(out, "env"), "utf8"))
        .split("\n")
        .map((line) => line.split("=")[0])
        .filter((name) => name?.startsWith("WAITRON_"))
        .sort();
      expect(names).toEqual(["WAITRON_STREAM_ACCESS_KEY_ID", "WAITRON_STREAM_SECRET_ACCESS_KEY"]);
    } finally {
      delete process.env.WAITRON_BACKUP_RECOVERY_KEY;
    }
  });

  // Litestream expands `${VAR}` over the whole configuration before parsing it. An endpoint is
  // percent-encoded into the address's query, so a `$` there reaches the file as `%24`.
  it("refuses a bucket name holding a variable reference, and never writes one from the endpoint", async () => {
    const hostile = "${WAITRON_BACKUP_RECOVERY_KEY}";
    const { out, promise } = await run("ok", {}, { ...BUCKET, bucket: `copy-${hostile}` });
    let refusal: unknown;
    try {
      await promise;
    } catch (error) {
      refusal = error;
    }
    expect(isAppError(refusal) && hasCode(refusal, "backup.stream_config_unsafe")).toBe(true);
    await expect(stat(join(out, "argv"))).rejects.toMatchObject({ code: "ENOENT" });

    const second = await run("ok", {}, { ...BUCKET, endpoint: `http://127.0.0.1:9000/${hostile}` });
    await second.promise;
    const config = await readFile(join(second.out, "litestream", "restore.yml"), "utf8");
    expect(config).not.toContain("WAITRON_BACKUP_RECOVERY_KEY}");
  });

  it("refuses a bucket key a quoted configuration value cannot hold, before any child starts", async () => {
    const { out, promise } = await run("ok", {}, { ...BUCKET, secretAccessKey: "it's" });
    await expect(promise).rejects.toMatchObject({
      code: "backup.stream_config_unsafe",
      params: { field: "secretAccessKey" },
    });
    await expect(stat(join(out, "argv"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a refused restore by its exit code", async () => {
    const { promise } = await run("fail");
    await expect(promise).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: 1, diskFull: false },
    });
  });

  it("says the disk filled when Litestream's error is the system's 'no space left on device'", async () => {
    const { promise } = await run("full");
    await expect(promise).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: 1, diskFull: true },
    });
  });

  it("reports a binary that is not there as a failure with no exit code", async () => {
    const out = await mkdtemp(join(dir, "case-"));
    await expect(
      restoreGeneration({
        litestreamBin: join(dir, "missing"),
        bucket: BUCKET,
        venueId: "v1",
        generation: GENERATION,
        outPath: join(out, "venue.db"),
      }),
    ).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: null, diskFull: false },
    });
  });

  it("writes its configuration beside the output when no folder is named", async () => {
    const out = await mkdtemp(join(dir, "case-"));
    await writeFile(join(dir, "control"), `STUB_OUT=${JSON.stringify(out)}\nSTUB_MODE=ok\n`);
    const outPath = join(out, "venue.db");
    await restoreGeneration({
      litestreamBin: bin,
      bucket: BUCKET,
      venueId: "v1",
      generation: GENERATION,
      outPath,
    });
    const argv = (await readFile(join(out, "argv"), "utf8")).trim().split("\n");
    expect(argv[2]).toBe(join(out, ".litestream-restore", "restore.yml"));
  });

  it("leaves a restore alone while its output keeps growing, however long it takes", async () => {
    const { outPath, promise } = await run("slow", { stallMs: 400, pollMs: 50 });
    await promise; // about a second in all, more than twice the stall period
    expect((await readFile(outPath, "utf8")).length).toBe(10);
  }, 10_000);

  it("abandons a restore whose output has stopped growing", async () => {
    const started = performance.now();
    const { promise } = await run("stall", { stallMs: 300, pollMs: 50 });
    await expect(promise).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: null, diskFull: false },
    });
    // The stub's `sleep 30` was ended, not waited out.
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 10_000);

  it("abandons a restore that outlives the absolute ceiling even while it grows", async () => {
    const { promise } = await run("endless", { stallMs: 60_000, ceilingMs: 500, pollMs: 50 });
    await expect(promise).rejects.toMatchObject({
      code: "backup.stream_restore_failed",
      params: { exitCode: null, diskFull: false },
    });
  }, 10_000);
});
