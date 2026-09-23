#!/usr/bin/env node
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { ALL_MODULES } from "@waitron/composition";
import {
  deploymentTableExists,
  openVenueDatabase,
  readDeploymentEnvironment,
  stampDeployment,
} from "@waitron/db";
import { serializeModuleConfig, type ModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { formatAppError, runCli } from "./cli.js";
import { readTenantIdentities } from "./tenant-guard.js";
import { applyVenue } from "./venue-apply.js";

/** `ESC[3J` clears the SCROLLBACK, `ESC[H` homes the cursor, `ESC[2J` clears the screen, in that
 * order — `ESC[2J` alone leaves the scrollback intact, which is the whole point. Written as
 * `\u001B` escapes rather than raw control bytes: a literal 0x1B in a source file survives neither
 * review nor copy-paste reliably (io.ts says so). */
const CLEAR = "\u001B[3J\u001B[H\u001B[2J";

/**
 * The only file in this package that touches the process, so everything else stays testable
 * without one. Excluded from coverage deliberately (`vitest.config.ts`): every decision it could
 * get wrong lives in `cli.ts`, which is injected and fully tested. Its verification is the bundle
 * check in the plan — `node dist/bin.js` printing usage and exiting 2.
 *
 * There is no storage requirement here, unlike `packages/credentials/src/bin.ts`: `venue` opens a
 * venue directory of its own and `keyring` opens nothing at all. Demanding one at boot would make
 * the one command that needs no database impossible to run without one.
 */
async function main(): Promise<number> {
  try {
    return await runCli(process.argv.slice(2), {
      io: {
        stdout: (line) => void process.stdout.write(`${line}\n`),
        stderr: (line) => void process.stderr.write(`${line}\n`),
        prompt: (question) => ask(question, true),
        promptSecret: (question) => ask(question, false),
        clearScreen: () => void process.stdout.write(CLEAR),
      },
      env: process.env,
      openVenue: (directory) => openVenueDatabase(directory),
      applyVenue,
      modules: ALL_MODULES,
      // Persist the resolved fiscal-slot `modules.json` when this box's state dir is known, so a boot
      // against the provisioned database reads a slot that resolves (design §4). Wired only when
      // `WAITRON_STATE_DIR` is set (the same env var `apps/server` reads): provisioning a REMOTE
      // database leaves it unset and no local file is written. `0600` + the `{ modules: … }` envelope
      // match `apps/server/src/module-config.ts`'s `writeModuleConfig`.
      writeModuleConfig: writeModuleConfigTo(process.env.WAITRON_STATE_DIR),
      readEnvironment: readDeploymentEnvironment,
      readDeploymentTable: deploymentTableExists,
      // The same primitive the browser setup wizard's handler stamps with — not a second rule
      // written here (`provisionVenue`, `apps/server/src/provision.ts`).
      stampEnvironment: stampDeployment,
      readTenants: readTenantIdentities,
    });
  } catch (error) {
    // `runCli` (cli.ts) resolves with a number for every EXPECTED failure — a bad database name, an
    // unknown environment, a refused role, a failed grant — and only ever rejects for something
    // none of this package's own code recognizes: a database fault, a connectivity failure, a bug.
    // This is the ONE place allowed to catch that, so it never reaches the operator as a raw,
    // unformatted dump. That matters more here than in most CLIs: a Drizzle `DrizzleQueryError`
    // embeds the failed query in its own `.message`, and one of this package's queries is
    // `CREATE ROLE … PASSWORD '<generated>'`. `error.name` is printed instead — a class name cannot
    // carry a password; a message can.
    if (isAppError(error)) {
      // Code and structured params only, through `cli.ts`'s own formatter rather than a second copy
      // of the template — this file is excluded from coverage, so a copy here is the one that could
      // drift without a test noticing. `src/errors.ts`'s header is the constraint that makes the
      // line safe: no param declared there carries key material, a password or a connection string.
      process.stderr.write(`${formatAppError(error)}\n`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`unexpected failure (${name})\n`);
    return 1;
  }
}

/**
 * The `writeModuleConfig` CLI dep, or `undefined` when no state dir is configured. When `stateDir` is
 * set, the returned writer serializes the resolved `ModuleConfig` into `<stateDir>/modules.json` in the
 * `{ modules: … }` envelope `apps/server`'s `readModuleConfig` parses, mode `0600` to match the state
 * dir's other secrets. Not atomic (a one-shot CLI, not a live server), so kept out of the shared
 * `writeFileAtomic`. Excluded from coverage with the rest of `bin.ts` (the injected `cli.ts` is tested).
 */
function writeModuleConfigTo(
  stateDir: string | undefined,
): ((config: ModuleConfig) => Promise<void>) | undefined {
  if (stateDir === undefined || stateDir === "") return undefined;
  return async (config: ModuleConfig) => {
    const body = JSON.stringify({ modules: serializeModuleConfig(config) }, null, 2) + "\n";
    await writeFile(join(stateDir, "modules.json"), body, { mode: 0o600 });
  };
}

/** Discards everything written to it. Used as readline's OUTPUT for the echo-off case. */
const SINK = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

/**
 * One line from the terminal, echoed or not.
 *
 * **Echo off.** Giving `readline` a discarding output stream is what suppresses the echo, and it
 * works only because `terminal: true` makes READLINE do the echoing rather than the tty: readline
 * puts a TTY input into raw mode itself, which turns the terminal's own echo off, and then writes
 * each keystroke to its `output` — which here goes nowhere.
 *
 * Run against a real pseudo-terminal rather than reasoned about. `{ sleep 1; printf 'hunter2\n'; }
 * | script -q /dev/null node <probe>` — the sleep matters, because input delivered before readline
 * has engaged raw mode is echoed by the tty and confounds the result. Echoing probe:
 * `PROMPT> ESC[9Ghunter2` then `RESULT isTTY=true got=[hunter2]`. Non-echoing probe, same input:
 * `PROMPT> ` then `RESULT isTTY=true got=[hunter2]` — the value was read and never appeared. The
 * full transcript is in the Task 8 report.
 *
 * **No tty** — piped input, a CI runner, an agent. `terminal` is then `false`, readline echoes
 * nothing at all, and the piped line is returned: `printf 'hunter2\n' | node <probe>` gave
 * `got=[hunter2]`.
 *
 * **The race is not decoration.** `rl.question` NEVER SETTLES when the input stream ends before an
 * answer arrives, so an exhausted or empty stdin left `main()` hanging on a promise that could not
 * resolve — Node printed `Warning: Detected unsettled top-level await` and exited 0, reporting
 * success for a command that never ran. Observed directly with `printf '' | node <probe>` before
 * this race existed; with it, the same input returns `got=[]` and exits 0 through the normal path.
 * `""` is a value no caller in `cli.ts` acts on. It is REFUSED where it would otherwise be acted on
 * — the venue directory, by `resolveVenueDir` (`provisioning.venue_dir_missing`), because an empty
 * directory is a RELATIVE path rather than no path — and at the "Apply this plan?" prompt it is
 * simply not `y`, so nothing is applied.
 *
 * An earlier version of this sentence said `""` was "what every caller in `cli.ts` already treats
 * as 'not supplied'". That was false in the one place it mattered: the connection string this tool
 * used to take was returned from the prompt unchecked, and an empty one is what `pg` resolved to
 * `localhost:5432` as the OS user rather than rejecting. The storage switch moved the hazard rather
 * than removing it — an empty DIRECTORY is the relative path `venue.db` — and `resolveVenueDir`'s
 * guard is what keeps the sentence true.
 *
 * `ABORT_ERR` is Ctrl+D at the prompt. It is an operator saying "stop", not a fault, so it becomes
 * the same empty answer rather than a stack trace.
 *
 * Whatever is read is returned to the caller and never written back, not even truncated.
 */
async function ask(question: string, echo: boolean): Promise<string> {
  const rl = echo
    ? createInterface({ input: process.stdin, output: process.stdout })
    : createInterface({
        input: process.stdin,
        output: SINK,
        terminal: process.stdin.isTTY === true,
      });
  // The question goes to stdout directly in the echo-off case — it is not a secret, and readline's
  // output is about to be thrown away.
  if (!echo) process.stdout.write(question);
  try {
    const ended = once(rl, "close").then(() => "");
    return await Promise.race([rl.question(echo ? question : ""), ended]);
  } catch (error) {
    if (isAbort(error)) return "";
    throw error;
  } finally {
    rl.close();
    // The newline the operator's Enter would have echoed, so the next line does not run on.
    if (!echo) process.stdout.write("\n");
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ABORT_ERR"
  );
}

process.exitCode = await main();
