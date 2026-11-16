import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS, readSettings, runMigrations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { modulesSettings } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { FIRST_SETUP_FILE } from "@waitron/store";
import { describe, expect, it } from "vitest";
import { ask, runBin, writeModuleConfigTo, type BinProcess } from "./bin.js";
import type { CliDeps } from "./cli.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

function fakeProcess(
  env: NodeJS.ProcessEnv = {},
): BinProcess & { stdin: PassThrough; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = new PassThrough().on("data", (chunk: Buffer) => out.push(chunk.toString()));
  const stderr = new PassThrough().on("data", (chunk: Buffer) => err.push(chunk.toString()));
  return {
    argv: ["node", "waitron-provision", "venue"],
    env,
    stdin: new PassThrough(),
    stdout,
    stderr,
    out,
    err,
  };
}

/** The dependencies `runBin` hands the command, for checks made outside `runBin`'s own catch. */
async function depsOf(env: NodeJS.ProcessEnv = {}): Promise<CliDeps> {
  let deps: CliDeps | undefined;
  await runBin(fakeProcess(env), async (_argv, given) => {
    deps = given;
    return 0;
  });
  return deps!;
}

describe("runBin", () => {
  it("prints a domain refusal by its code and returns 1", async () => {
    const proc = fakeProcess();
    const code = await runBin(proc, async () => {
      throw new AppError("setup.not_ready", {});
    });
    expect(code).toBe(1);
    expect(proc.err).toEqual(["setup.not_ready {}\n"]);
  });

  it("prints only the class name of any other failure, never its message, and returns 1", async () => {
    const proc = fakeProcess();
    const code = await runBin(proc, async () => {
      throw new TypeError("insert into persons values ('secret')");
    });
    expect(code).toBe(1);
    expect(proc.err).toEqual(["unexpected failure (TypeError)\n"]);
  });

  it("hands the command the arguments after the script name and its own output lines", async () => {
    const proc = fakeProcess();
    const code = await runBin(proc, async (argv, deps) => {
      deps.io.stdout("to out");
      deps.io.stderr("to err");
      deps.io.clearScreen();
      return argv.length === 1 && argv[0] === "venue" ? 7 : 0;
    });
    expect(code).toBe(7);
    expect(proc.out).toEqual(["to out\n", "\u001B[3J\u001B[H\u001B[2J"]);
    expect(proc.err).toEqual(["to err\n"]);
  });

  it("answers both kinds of prompt from the given stdin, echoing only the plain one", async () => {
    const proc = fakeProcess();
    // At a terminal readline echoes each keystroke, so a secret echoed would show in `out`.
    Object.assign(proc.stdin, { isTTY: true });
    Object.assign(proc.stdout, { isTTY: true });
    const answers: string[] = [];
    await runBin(proc, async (_argv, deps) => {
      proc.stdin.write("Ana\n");
      answers.push(await deps.io.prompt("Name? "));
      proc.stdin.write("1234\n");
      answers.push(await deps.io.promptSecret("PIN: "));
      return 0;
    });
    expect(answers).toEqual(["Ana", "1234"]);
    expect(proc.out.join("")).toContain("Ana");
    expect(proc.out.join("")).not.toContain("1234");
  });

  it("saves module settings only while the venue it opened is open", async () => {
    const directory = await mkdtemp(join(tmpdir(), "waitron-provision-bin-"));
    const config = { overrides: new Map([["fiscal-none", false]]) };
    try {
      const deps = await depsOf();
      const store = await deps.openVenue(directory);
      await runMigrations(store.venue, CORE_MIGRATIONS);
      await deps.writeModuleConfig!(config);
      expect((await readSettings(store.venue, modulesSettings(ALL_MODULES))).doc).toEqual({
        modules: { "fiscal-none": false },
      });
      await store.close();
      await expect(deps.writeModuleConfig!(config)).rejects.toMatchObject({
        code: "setup.not_ready",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["unset", {}],
    ["empty", { WAITRON_STATE_DIR: "" }],
  ])("refuses first setup with setup.not_ready when WAITRON_STATE_DIR is %s", async (_, env) => {
    const deps = await depsOf(env);
    expect(() => deps.configureFirstSetup!("/venue")).toThrow(
      expect.objectContaining({ code: "setup.not_ready" }),
    );
  });

  it("builds first setup over the state folder WAITRON_STATE_DIR names", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-provision-state-"));
    try {
      const runtime = (await depsOf({ WAITRON_STATE_DIR: stateDir })).configureFirstSetup!(
        join(stateDir, "venue"),
      );
      expect(await runtime.store.read()).toBeNull();
      await mkdir(dirname(join(stateDir, FIRST_SETUP_FILE)), { recursive: true });
      await writeFile(join(stateDir, FIRST_SETUP_FILE), JSON.stringify({ version: 2 }));
      await expect(runtime.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

describe("writeModuleConfigTo", () => {
  const config = { overrides: new Map([["fiscal-none", false]]) };

  it("refuses with setup.not_ready while no venue is open", async () => {
    await expect(writeModuleConfigTo(() => undefined)(config)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  });

  it("saves the modules document into the open venue", async () => {
    await writeModuleConfigTo(() => suite.db)(config);
    expect((await readSettings(suite.db, modulesSettings(ALL_MODULES))).doc).toEqual({
      modules: { "fiscal-none": false },
    });
  });
});

describe("ask", () => {
  function streams(isTTY = false) {
    const input = Object.assign(new PassThrough(), { isTTY });
    const written: string[] = [];
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => written.push(chunk.toString()));
    return { input, output, written };
  }

  it("returns the answer with echo on", async () => {
    const { input, output, written } = streams();
    const answer = ask("Name? ", true, input, output);
    input.write("Ana\n");
    expect(await answer).toBe("Ana");
    expect(written.join("")).toContain("Name? ");
  });

  it("writes the question, and a newline after it, with echo off, and returns the answer", async () => {
    const { input, output, written } = streams();
    const answer = ask("PIN: ", false, input, output);
    input.write("1234\n");
    expect(await answer).toBe("1234");
    expect(written.join("")).toBe("PIN: \n");
  });

  it("throws a failure other than Ctrl+D rather than reading it as an empty answer", async () => {
    const broken = Object.assign(new PassThrough(), {
      write: () => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
    });
    await expect(ask("Name? ", true, new PassThrough(), broken)).rejects.toMatchObject({
      code: "EPIPE",
    });
  });

  it("returns an empty answer when stdin ends before one", async () => {
    const { input, output } = streams();
    const answer = ask("Name? ", true, input, output);
    input.end();
    expect(await answer).toBe("");
  });

  it("returns an empty answer when stdin had already ended before the question", async () => {
    const { input, output } = streams();
    const first = ask("Name? ", true, input, output);
    input.end();
    expect(await first).toBe("");
    const hung = new Promise((resolve) => setTimeout(resolve, 2_000, "still waiting"));
    expect(await Promise.race([ask("Legal name? ", true, input, output), hung])).toBe("");
    expect(await Promise.race([ask("PIN: ", false, input, output), hung])).toBe("");
  });

  it("returns an empty answer when the operator presses Ctrl+D at a terminal", async () => {
    const { input, output, written } = streams(true);
    const answer = ask("PIN: ", false, input, output);
    input.write("\u0004");
    expect(await answer).toBe("");
    expect(written.join("")).toBe("PIN: \n");
  });
});
