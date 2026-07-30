#!/usr/bin/env node
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createPostgresDb } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { runCli } from "./cli.js";
import { applyInstance } from "./instance-apply.js";
import { readInstanceState } from "./instance-state.js";

/**
 * Where the migration SQL lives.
 *
 * `import.meta.url` is the BUNDLE's own location once esbuild has run — `dist/bin.js` — so this
 * resolves to `dist/drizzle`, which is exactly where `scripts/copy-migrations.mjs` puts it. Running
 * from source there is no such folder, and `null` is `migrationOptionsFor`'s own word for "running
 * from source": it then resolves each set against `packages/migrations` instead.
 *
 * `existsSync` picks between the two rather than an environment variable an operator has to know
 * about. If the copy step did not run, this falls back to the from-source resolution and
 * `migrationOptionsFor` throws `migrations.set_missing` naming the folder it looked in — loud, not
 * silent. `apps/server`'s `DEFAULT_MIGRATIONS_ROOT` (boot.ts:52) computes the same path the same
 * way, for the same reason.
 */
const BUNDLED_MIGRATIONS = fileURLToPath(new URL("drizzle", import.meta.url));

/** `ESC[3J` clears the SCROLLBACK, `ESC[H` homes the cursor, `ESC[2J` clears the screen, in that
 * order — `ESC[2J` alone leaves the scrollback intact, which is the whole point. Written as
 * `\u001B` escapes rather than raw control bytes: a literal 0x1B in a source file survives neither
 * review nor copy-paste reliably (io.ts says so). */
const CLEAR = "\u001B[3J\u001B[H\u001B[2J";

/**
 * The only file in this package that touches the process, so everything else stays testable
 * without one. Excluded from coverage deliberately (`vitest.config.ts`): every decision it could
 * get wrong lives in `cli.ts`, which is injected and fully tested. Its verification is the bundle
 * check in the plan — `node dist/bin.js` printing usage and exiting 2, with `dist/drizzle` present.
 *
 * There is no `DATABASE_URL` requirement here, unlike `packages/credentials/src/bin.ts`: this tool
 * connects as an ADMIN, per command, and `keyring` connects to nothing at all. Demanding a
 * connection string at boot would make the one command that needs no database impossible to run
 * without one.
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
      connect: (uri) => createPostgresDb(uri),
      migrationsRoot: existsSync(BUNDLED_MIGRATIONS) ? BUNDLED_MIGRATIONS : null,
      readState: readInstanceState,
      apply: applyInstance,
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
      // Code and structured params only. `src/errors.ts`'s header is the constraint that makes this
      // line safe: no param declared there carries key material, a password or a connection string.
      process.stderr.write(`${error.code} ${JSON.stringify(error.params)}\n`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`unexpected failure (${name})\n`);
    return 1;
  }
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
 * `""` is a value no caller in `cli.ts` acts on. It is REFUSED at each of the three that take one —
 * `--database` by `assertIdentifier` (`provisioning.invalid_identifier`), `--environment` by
 * `assertEnvironment` (`deployment.unknown_environment`), the admin connection string by
 * `resolveAdminUri` (`provisioning.admin_uri_missing`) — and at the "Apply this plan?" prompt it is
 * simply not `y`, so nothing is applied.
 *
 * An earlier version of this sentence said `""` was "what every caller in `cli.ts` already treats
 * as 'not supplied'". That was false in the one place it mattered: `resolveAdminUri` returned the
 * prompt's answer unchecked, and an empty connection string is one `pg` resolves to
 * `localhost:5432` as the OS user rather than rejecting. The race below therefore handed a
 * non-interactive run a live connection to whatever answers there. The guard in `resolveAdminUri`
 * is what makes the sentence true; it was not true when it was written.
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
