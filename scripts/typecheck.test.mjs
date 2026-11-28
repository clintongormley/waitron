import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vitest";
import { runTypecheck } from "./typecheck.mjs";
import { workspaceMembers } from "./workspace-members.mjs";

vi.mock("node:fs/promises", { spy: true });

const root = resolve(import.meta.dirname, "..");
const launcher = pathToFileURL(join(root, "scripts/typecheck.mjs")).href;
const typecheckScript = (member) =>
  JSON.parse(readFileSync(join(root, member, "package.json"), "utf8")).scripts?.typecheck;

const pausedCompiler = `#!/bin/sh
printf 'start %s\\n' "$FAKE_COMPILER_EXIT" >> "$FAKE_COMPILER_EVENTS"
printf 'compiler: ["%s","%s","%s"]\\n' "$1" "$2" "$3"
IFS= read -r done
printf 'end %s\\n' "$FAKE_COMPILER_EXIT" >> "$FAKE_COMPILER_EVENTS"
exit "$FAKE_COMPILER_EXIT"
`;

function compilerFixture(cwd, nativeProgram = pausedCompiler) {
  const modules = join(cwd, "node_modules");
  const typescript = join(modules, "typescript");
  const native = join(modules, "@typescript", `typescript-darwin-${process.arch}`);
  mkdirSync(join(typescript, "bin"), { recursive: true });
  mkdirSync(join(native, "lib"), { recursive: true });
  writeFileSync(join(typescript, "package.json"), JSON.stringify({ bin: { tsc: "bin/tsc" } }));
  writeFileSync(join(typescript, "bin", "tsc"), "process.exit(23);\n");
  writeFileSync(join(native, "package.json"), "{}");
  writeFileSync(join(native, "lib", "tsc"), nativeProgram, { mode: 0o755 });
}

function startCompiler(cwd, lockFile, exitCode, watch = false) {
  if (watch) {
    mkdirSync(join(cwd, "node_modules"), { recursive: true });
    symlinkSync(
      realpathSync(join(root, "apps/server/node_modules/typescript")),
      join(cwd, "node_modules/typescript"),
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      '{"files":["input.ts"],"compilerOptions":{"types":[]}}',
    );
    writeFileSync(join(cwd, "input.ts"), "export const input: number = 1;\n");
  } else {
    compilerFixture(cwd);
  }
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import { runTypecheck } from ${JSON.stringify(launcher)};
      const [, lockFile, ...args] = process.argv;
      process.exitCode = await runTypecheck(args, { lockFile });
    `,
      lockFile,
      "--noEmit",
      "--pretty",
      "false",
      ...(watch ? ["--watch"] : []),
    ],
    {
      cwd,
      detached: watch,
      env: {
        ...process.env,
        FAKE_COMPILER_EXIT: String(exitCode),
        FAKE_COMPILER_EVENTS: join(dirname(lockFile), "compiler-events"),
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return { child, closed: once(child, "close"), stdout: () => stdout, stderr: () => stderr };
}

function stopWatch(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

// Linux CI checks the launcher and routing. macOS also exercises the native file lock.
test.runIf(process.platform === "darwin").each([false, true])(
  "keeps the second checkout waiting for the first compiler (wrapper cancelled: %s)",
  async (cancelled) => {
    const dir = mkdtempSync(join(tmpdir(), "wt-typecheck-"));
    const lockFile = join(dir, "slot");
    const first = startCompiler(join(dir, "a"), lockFile, 2, cancelled);
    const ready = 'compiler: ["--noEmit","--pretty","false"]';
    const wait = { timeout: 5000 };
    let second;
    try {
      const firstReady = cancelled ? "Found 0 errors. Watching for file changes." : ready;
      await vi.waitFor(() => expect(first.stdout()).toContain(firstReady), wait);
      if (cancelled) {
        const exit = once(first.child, "exit");
        expect(first.child.kill("SIGKILL")).toBe(true);
        expect(await exit).toEqual([null, "SIGKILL"]);
        expect(
          spawnSync("/usr/bin/lockf", ["-k", "-t", "0", lockFile, "/usr/bin/true"]).status,
        ).toBe(75);
      }
      second = startCompiler(join(dir, "b"), lockFile, 0);
      await vi.waitFor(
        () => expect(second.stderr() + second.stdout()).toMatch(/Waiting for|compiler:/),
        wait,
      );
      expect(second.stdout()).toBe("");
      expect(second.stderr()).toContain(`Waiting for the Waitron typecheck slot at ${lockFile}`);
      if (cancelled) stopWatch(first.child);
      else {
        // Give an unlocked waiter time to start before recording the holder's exit.
        await delay(1000);
        first.child.stdin.end();
      }
      expect(await first.closed).toEqual(cancelled ? [null, "SIGKILL"] : [2, null]);
      await vi.waitFor(() => expect(second.stdout()).toContain(ready), wait);
      second.child.stdin.end();
      expect(await second.closed).toEqual([0, null]);
      if (!cancelled) {
        expect(readFileSync(join(dir, "compiler-events"), "utf8")).toBe(
          "start 2\nend 2\nstart 0\nend 0\n",
        );
      }
    } finally {
      if (cancelled) stopWatch(first.child);
      else first.child.stdin.end();
      second?.child.stdin.end();
      await Promise.allSettled([first.closed, second?.closed]);
      rmSync(dir, { recursive: true });
    }
  },
);

test.each([
  ["linux", null, null, "6GiB", "6GiB"],
  ["darwin", "EAGAIN", "Waiting for the Waitron typecheck slot", undefined, "8GiB"],
  ["darwin", "EPERM", "Running without the lock", "6GiB", "6GiB"],
  ["darwin", "EACCES", "Running without the lock", undefined, "8GiB"],
])(
  "returns the compiler status on %s when opening the slot gives %s",
  async (platform, refusal, message, override, memoryTarget) => {
    const cwd = mkdtempSync(join(tmpdir(), "wt-typecheck-cli-"));
    const lockFile = join(cwd, "slot");
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("GOMEMLIMIT", override);
      compilerFixture(
        cwd,
        `#!/bin/sh\n[ "$GOMEMLIMIT" = "${memoryTarget}" ] || exit 24\nexit 23\n`,
      );
      if (refusal)
        vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error(refusal), { code: refusal }));
      expect(await runTypecheck(["--noEmit"], { cwd, platform, lockFile })).toBe(23);
      if (message)
        expect(warning).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(message));
      else expect(warning).not.toHaveBeenCalled();
    } finally {
      vi.mocked(open).mockReset();
      vi.unstubAllEnvs();
      warning.mockRestore();
      rmSync(cwd, { recursive: true });
    }
  },
);

test("all workspace member typechecks take the same route", () => {
  const members = workspaceMembers().filter(({ dir }) => typecheckScript(dir));
  expect(members.length).toBeGreaterThan(1);
  for (const { dir } of members) {
    for (const command of typecheckScript(dir).split(" && ")) {
      expect(command, dir).toMatch(/^node \.\.\/\.\.\/scripts\/typecheck\.mjs --noEmit\b/);
    }
  }
});
