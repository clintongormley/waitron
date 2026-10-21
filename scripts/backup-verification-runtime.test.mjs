import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import {
  backupVerificationRuntime,
  readBuildBackupVerificationRuntime,
} from "./backup-verification-runtime.mjs";
import { bundle } from "./bundle-node.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const input = {
  source: "a".repeat(40),
  release: "2026.10.21",
  lockfileDigest: "b".repeat(64),
  descriptorBytes: new TextEncoder().encode("complete-descriptor"),
};
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

describe("backup runtime identity", () => {
  it("constructs provenance from shipped composition while an unstamped target stays unavailable", () => {
    const current = readBuildBackupVerificationRuntime({ release: { sourceCommit: input.source } });
    expect(current).toEqual({
      release: `waitron-${input.source}`,
      revision: input.source,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readBuildBackupVerificationRuntime({ release: null })).toBeNull();
    const directory = mkdtempSync(join(tmpdir(), "waitron-missing-target-"));
    try {
      expect(
        readBuildBackupVerificationRuntime({
          cwd: directory,
          release: { sourceCommit: input.source },
        }),
      ).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 70_000);

  it("uses the fixed versioned vector independently of clock and ambient release claims", () => {
    expect(backupVerificationRuntime(input)).toEqual({
      release: "2026.10.21",
      revision: "a".repeat(40),
      fingerprint: "a8c71355e4ae2f4a0b1d5ff116bde347de535de2a1bbb97574cc26c2f938e247",
    });
  });

  it.each([
    ["source", "c".repeat(40)],
    ["release", "2026.10.22"],
    ["lockfileDigest", "c".repeat(64)],
    ["descriptorBytes", new TextEncoder().encode("changed-policy")],
  ])("changes qualification when %s changes", (name, value) => {
    expect(backupVerificationRuntime({ ...input, [name]: value }).fingerprint).not.toBe(
      backupVerificationRuntime(input).fingerprint,
    );
  });

  it.each([
    ["source", undefined],
    ["source", "main"],
    ["source", "A".repeat(40)],
    ["release", undefined],
    ["release", ""],
    ["release", "a b"],
    ["lockfileDigest", undefined],
    ["lockfileDigest", "c"],
    ["descriptorBytes", undefined],
    ["descriptorBytes", "complete-descriptor"],
  ])("refuses incomplete provenance %s=%s", (name, value) => {
    expect(() => backupVerificationRuntime({ ...input, [name]: value })).toThrow(
      "Invalid backup verification build provenance",
    );
  });
});

describe("embedded backup qualification", () => {
  it("the real bundle command stamps every target entry from the source tree", () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-runtime-command-"));
    try {
      const entry = join(directory, "entry.ts");
      writeFileSync(
        entry,
        `console.log(JSON.stringify({ runtime: typeof __WAITRON_BACKUP_VERIFICATION_RUNTIME__ === 'undefined' ? null : __WAITRON_BACKUP_VERIFICATION_RUNTIME__, hour: typeof __WAITRON_HOUR_RELEASE__ === 'undefined' ? null : __WAITRON_HOUR_RELEASE__ }));`,
      );
      const outputs = [join(directory, "native.mjs"), join(directory, "verification.mjs")];
      const built = spawnSync(
        process.execPath,
        [join(ROOT, "scripts/bundle-node.mjs"), ...outputs.map((out) => `${entry}=${out}`)],
        {
          cwd: directory,
          env: {
            ...environment,
            PATH: `${join(ROOT, "apps/server/node_modules/.bin")}${delimiter}${environment.PATH}`,
          },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      expect(built.status, built.stderr).toBe(0);
      const runtimes = outputs.map((out) => {
        const loaded = spawnSync(process.execPath, [out], {
          cwd: directory,
          env: {
            ...environment,
            WAITRON_BUILD_ID: "forged",
            WAITRON_IMAGE_CREATED: "1970-01-01T00:00:00Z",
          },
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(loaded.status, loaded.stderr).toBe(0);
        return JSON.parse(loaded.stdout);
      });
      const revision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        env: environment,
        encoding: "utf8",
        timeout: 10_000,
      }).trim();
      expect(runtimes[0].runtime).toEqual({
        release: `waitron-${revision}`,
        revision,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(runtimes[0].hour.sourceCommit).toBe(revision);
      expect(runtimes[1]).toEqual(runtimes[0]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("loads genuine composition without starting a listener, timer, worker or process", () => {
    const directory = mkdtempSync(join(tmpdir(), "waitron-verification-build-"));
    try {
      const runtime = backupVerificationRuntime(input);
      const output = join(directory, "verification.mjs");
      execFileSync(process.execPath, [join(ROOT, "apps/server/scripts/copy-migrations.mjs")], {
        cwd: ROOT,
        env: environment,
        timeout: 30_000,
        stdio: "pipe",
      });
      cpSync(join(ROOT, "apps/server/dist/drizzle"), join(directory, "drizzle"), {
        recursive: true,
      });
      bundle(
        [{ entry: join(ROOT, "apps/server/src/backup-verification-entry.ts"), outfile: output }],
        {
          backupVerificationRuntime: runtime,
          run: (command, args, options) =>
            execFileSync(command, args, {
              ...options,
              env: {
                ...environment,
                PATH: `${join(ROOT, "apps/server/node_modules/.bin")}${delimiter}${environment.PATH}`,
              },
              timeout: 60_000,
            }),
        },
      );
      const probe = `
import net from 'node:net';
import child from 'node:child_process';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('verification import started a duty'); };
net.Server.prototype.listen = forbidden;
net.Socket.prototype.connect = forbidden;
child.spawn = child.execFile = child.fork = child.spawnSync = child.execFileSync = child.execSync = forbidden;
threads.Worker = class { constructor() { forbidden(); } };
globalThis.setInterval = globalThis.setTimeout = globalThis.fetch = forbidden;
syncBuiltinESMExports();
const entry = await import(${JSON.stringify(output)});
const first = entry.currentBackupVerificationTarget();
process.env.WAITRON_BUILD_ID = 'forged';
const second = entry.currentBackupVerificationTarget();
console.log(JSON.stringify({ first, same: JSON.stringify(first) === JSON.stringify(second), keys: Object.keys(entry).sort() }));
`;
      const loaded = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        cwd: directory,
        env: environment,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(loaded.status, loaded.stderr).toBe(0);
      const result = JSON.parse(loaded.stdout);
      expect(result.first.runtime).toEqual(runtime);
      expect(result.same).toBe(true);
      expect(result.first.modules.map((m) => m.name)).toEqual([
        "adjustments",
        "bookings",
        "catalogue",
        "core",
        "credentials",
        "fiscal-none",
        "fiscal-verifactu",
        "identity",
        "media",
        "payments",
        "scheduler",
        "staffing",
        "venue-service",
        "workforce",
        "workforce-es",
      ]);
      expect(result.first.modules.map((m) => m.packageVersion)).toEqual(
        result.first.modules.map(
          (m) =>
            JSON.parse(
              readFileSync(
                join(ROOT, "packages", m.name === "core" ? "db" : m.name, "package.json"),
                "utf8",
              ),
            ).version,
        ),
      );
      expect(result.keys).toEqual([
        "backupVerificationRequestDigest",
        "buildBackupVerificationTarget",
        "currentBackupVerificationTarget",
        "readBackupVerificationRequest",
        "readBackupVerificationResult",
      ]);
      writeFileSync(join(directory, "drizzle/core/0000_initial.sql"), "select 'changed';");
      const changed = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
const entry = await import(${JSON.stringify(output)});
console.log(JSON.stringify(entry.currentBackupVerificationTarget()));`,
        ],
        {
          cwd: directory,
          env: environment,
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(changed.status, changed.stderr).toBe(0);
      expect(JSON.parse(changed.stdout).migrationDigest).not.toBe(result.first.migrationDigest);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 150_000);
});
