#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { runCli, type CliIo, type Resealer } from "./cli.js";
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
 * The vault is in the venue file; a node handle also type-checks there, so `bin.test.ts`'s set/list
 * round trip is what holds it. `rotate` also re-seals the signing key in the node file.
 */
export async function runBin(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: CliIo,
  resealers: readonly Resealer[],
): Promise<number> {
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
      node: store.node,
      ring,
      resealers,
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

/** The process's stdio, including the one refusal that only makes sense against a terminal. */
export function processIo(proc: {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}): CliIo {
  return {
    stdout: (line) => proc.stdout.write(`${line}\n`),
    stderr: (line) => proc.stderr.write(`${line}\n`),
    readStdin: async () => {
      if (proc.stdin.isTTY) {
        // No piped input and no --file: waiting would hang on a stream that never sees EOF.
        proc.stderr.write(
          "refusing to wait on an interactive terminal for the credential payload " +
            "— pipe it in, or pass --file <path>\n",
        );
        throw new Error("stdin is a TTY");
      }
      const chunks: Buffer[] = [];
      for await (const chunk of proc.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
