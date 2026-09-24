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

/** `ESC[3J` clears the scrollback, `ESC[H` homes the cursor, `ESC[2J` clears the screen; `ESC[2J`
 * alone leaves the scrollback intact. */
const CLEAR = "\u001B[3J\u001B[H\u001B[2J";

/**
 * The only file in this package that touches the process. No storage is opened here: `venue` opens
 * its own directory and `keyring` needs none.
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
      // The same variable `apps/server` reads; unset, no `modules.json` is written.
      writeModuleConfig: writeModuleConfigTo(process.env.WAITRON_STATE_DIR),
      readEnvironment: readDeploymentEnvironment,
      readDeploymentTable: deploymentTableExists,
      stampEnvironment: stampDeployment,
      readTenants: readTenantIdentities,
    });
  } catch (error) {
    // Never the message: a query error's message can embed the failed statement. A class name
    // carries no value.
    if (isAppError(error)) {
      process.stderr.write(`${formatAppError(error)}\n`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`unexpected failure (${name})\n`);
    return 1;
  }
}

/** The envelope and mode match `apps/server/src/module-config.ts`'s `writeModuleConfig`. Not atomic:
 * a one-shot CLI, not a live server. */
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
 * Echo off works because `terminal: true` makes readline, not the tty, do the echoing: it puts a
 * TTY input into raw mode and writes each keystroke to its `output`, which here goes nowhere.
 *
 * The race exists because `rl.question` never settles when stdin ends before an answer; an
 * exhausted stdin returns `""` instead. So does Ctrl+D (`ABORT_ERR`), an operator saying "stop".
 */
async function ask(question: string, echo: boolean): Promise<string> {
  const rl = echo
    ? createInterface({ input: process.stdin, output: process.stdout })
    : createInterface({
        input: process.stdin,
        output: SINK,
        terminal: process.stdin.isTTY === true,
      });
  // readline's output is thrown away in the echo-off case, so the question goes to stdout here.
  if (!echo) process.stdout.write(question);
  try {
    const ended = once(rl, "close").then(() => "");
    return await Promise.race([rl.question(echo ? question : ""), ended]);
  } catch (error) {
    if (isAbort(error)) return "";
    throw error;
  } finally {
    rl.close();
    // The newline the operator's Enter would have echoed.
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
