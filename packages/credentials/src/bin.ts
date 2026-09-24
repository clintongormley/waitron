#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { runCli, type CliIo } from "./cli.js";
import { loadKeyRing } from "./keyring.js";

const VENUE_DIR_VARIABLE = "WAITRON_VENUE_DIR";

/**
 * The whole command, with the process kept outside it so a test need not spawn anything; the shim
 * at the foot of this file is the only part that touches the process.
 *
 * The directory is `WAITRON_VENUE_DIR`, not a flag: the variable `apps/server`'s `config.ts` reads
 * for the directory it serves. There is no `WAITRON_STATE_DIR` fallback: that default lives in
 * `apps/server`, and a package cannot import an app.
 *
 * `store.venue`, not `store.node`: `packages/migrations/src/apply.ts` creates every table in the
 * venue file, and both handles share one type, so only `bin.test.ts`'s round trip tells them apart.
 */
export async function runBin(argv: string[], env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const venueDir = env[VENUE_DIR_VARIABLE];
  if (venueDir === undefined || venueDir === "") {
    io.stderr(`${VENUE_DIR_VARIABLE} is not set`);
    return 2;
  }

  let store: VenueDatabase | undefined;
  try {
    // Before the files are opened, so a broken key ring costs nothing and leaves nothing to close.
    const ring = loadKeyRing(env);
    // No lock: the command runs beside a running server, which reads credentials fresh on every
    // pass (`apps/server/README.md`).
    store = await openVenueDatabase(venueDir, { exclusive: false });
    return await runCli(argv, {
      db: store.venue,
      ring,
      io,
      readFile: (path) => readFile(path, "utf8"),
    });
  } catch (error) {
    // Only an AppError's code and params are printed. Any other error prints its name alone: its
    // message is not this package's to format.
    if (isAppError(error)) {
      io.stderr(`${error.code} ${JSON.stringify(error.params)}`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    io.stderr(`unexpected failure (${name})`);
    return 1;
  } finally {
    await store?.close();
  }
}

/** The real stdio, including the one refusal that only makes sense against a terminal. */
const processIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin: async () => {
    if (process.stdin.isTTY) {
      // No piped input and no --file: waiting would hang on a stream that never sees EOF.
      process.stderr.write(
        "refusing to wait on an interactive terminal for the credential payload " +
          "— pipe it in, or pass --file <path>\n",
      );
      throw new Error("stdin is a TTY");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  },
};

// Run only when invoked directly: an import would otherwise run the command with the importing
// process's argv and environment.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runBin(process.argv.slice(2), process.env, processIo);
}
