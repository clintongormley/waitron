#!/usr/bin/env node
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ALL_MODULES } from "@waitron/composition";
import {
  deploymentTableExists,
  openVenueDatabase,
  readDeploymentEnvironment,
  setVenueHolderIdentity,
  stampDeployment,
  readSettings,
  saveSettings,
  withTransaction,
  type Database,
} from "@waitron/db";
import { modulesSettings, serializeModuleConfig, type ModuleConfig } from "@waitron/module";
import { AppError, isAppError, readVariable } from "@waitron/shared";
import { createFirstSetupCommandDeployment } from "./first-setup-command-deployment.js";
import { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { timedatectlSynchronised } from "./timedatectl-reader.js";
import { formatAppError, runCli } from "./cli.js";
import { readTaxpayerIdentities } from "./taxpayer-guard.js";
import { applyVenue } from "./venue-apply.js";

/** `ESC[3J` clears the scrollback, `ESC[H` homes the cursor, `ESC[2J` clears the screen; `ESC[2J`
 * alone leaves the scrollback intact. */
const CLEAR = "\u001B[3J\u001B[H\u001B[2J";

/** The parts of the process the command touches; the shim at the foot of this file passes the
 * real ones. */
export interface BinProcess {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function runBin(proc: BinProcess, run: typeof runCli = runCli): Promise<number> {
  let database: Database | undefined;
  try {
    return await run(proc.argv.slice(2), {
      io: {
        stdout: (line) => void proc.stdout.write(`${line}\n`),
        stderr: (line) => void proc.stderr.write(`${line}\n`),
        prompt: (question) => ask(question, true, proc.stdin, proc.stdout),
        promptSecret: (question) => ask(question, false, proc.stdin, proc.stdout),
        clearScreen: () => void proc.stdout.write(CLEAR),
      },
      env: proc.env,
      openVenue: async (directory) => {
        const store = await openVenueDatabase(directory);
        database = store.venue;
        return {
          ...store,
          async close() {
            database = undefined;
            await store.close();
          },
        };
      },
      firstSetupDeployment: ({ runtime, db, node }) =>
        createFirstSetupCommandDeployment({ runtime, db, node, environment: proc.env }),
      applyVenue,
      modules: ALL_MODULES,
      configureFirstSetup: (venueDir) => {
        const stateDir = readVariable(proc.env, "WAITRON_STATE_DIR");
        if (stateDir === undefined || stateDir === "") throw new AppError("setup.not_ready", {});
        return createFirstSetupRuntime({
          environment: Object.freeze({ ...proc.env }),
          stateDir,
          venueDir,
          modules: ALL_MODULES,
          database: () => database,
          timeServiceSynchronised: timedatectlSynchronised(),
        });
      },
      writeModuleConfig: writeModuleConfigTo(() => database),
      readEnvironment: readDeploymentEnvironment,
      readDeploymentTable: deploymentTableExists,
      stampEnvironment: stampDeployment,
      readTaxpayers: readTaxpayerIdentities,
    });
  } catch (error) {
    // Never the message: a query error's message can embed the failed statement. A class name
    // carries no value.
    if (isAppError(error)) {
      proc.stderr.write(`${formatAppError(error)}\n`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    proc.stderr.write(`unexpected failure (${name})\n`);
    return 1;
  }
}

export function writeModuleConfigTo(database: () => Database | undefined) {
  const definition = modulesSettings(ALL_MODULES);
  return async (config: ModuleConfig) => {
    const db = database();
    if (db === undefined) throw new AppError("setup.not_ready", {});
    await withTransaction(db, async (tx) => {
      const saved = await readSettings(tx, definition);
      await saveSettings(tx, definition, {
        doc: { modules: serializeModuleConfig(config) },
        expectedRevision: saved.revision,
        personId: null,
      });
    });
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
export async function ask(
  question: string,
  echo: boolean,
  stdin: NodeJS.ReadableStream & { isTTY?: boolean },
  stdout: NodeJS.WritableStream,
): Promise<string> {
  const rl = echo
    ? createInterface({ input: stdin, output: stdout })
    : createInterface({
        input: stdin,
        output: SINK,
        terminal: stdin.isTTY === true,
      });
  // readline's output is thrown away in the echo-off case, so the question goes to stdout here.
  if (!echo) stdout.write(question);
  try {
    // readline never sees an `end` emitted before it was created, so it would never close.
    const ended = (stdin as { readableEnded?: boolean }).readableEnded
      ? Promise.resolve("")
      : once(rl, "close").then(() => "");
    return await Promise.race([rl.question(echo ? question : ""), ended]);
  } catch (error) {
    if (isAbort(error)) return "";
    throw error;
  } finally {
    rl.close();
    // The newline the operator's Enter would have echoed.
    if (!echo) stdout.write("\n");
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ABORT_ERR"
  );
}

// Run only when invoked directly: an import would otherwise run the command with the importing
// process's argv and environment.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  setVenueHolderIdentity(
    "provisioning",
    process.env,
    readVariable(process.env, "WAITRON_STATE_DIR") || undefined,
  );
  process.exitCode = await runBin(process);
}
