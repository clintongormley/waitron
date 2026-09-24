#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { runCli, type CliIo } from "./cli.js";
import { loadKeyRing } from "./keyring.js";

/** The variable naming the directory this box's venue lives in. */
const VENUE_DIR_VARIABLE = "WAITRON_VENUE_DIR";

/**
 * The whole command, with the process kept outside it: argv, the environment and the three stdio
 * operations are arguments, so every path below is reachable from a test that does not have to
 * spawn anything. The shim at the foot of this file is the only part that touches the process.
 *
 * **The venue is a DIRECTORY of two SQLite files, not a connection string**, and which directory is
 * not a flag: it is `WAITRON_VENUE_DIR`, the same variable `apps/server`'s `config.ts` reads for the
 * directory it serves, so the tool and the server on a trading box agree by construction. An
 * operator passing a path could name a directory nothing else opens, and a sealed credential
 * written there is a credential the server never finds.
 *
 * There is no `WAITRON_STATE_DIR` fallback, which the server's own scripts do carry
 * (`apps/server/scripts/venue-dir.ts`): that fallback ends at `boot.ts`'s `DEFAULT_STATE_ROOT`, and
 * a package cannot import an app. This matches `resolveVenueDir` in
 * `packages/provisioning/src/cli.ts`, the other command-line tool shipped from a package.
 *
 * An EMPTY value is refused with the unset one, not defaulted: every path `openVenueStore` builds
 * is `join(directory, …)`, and `join("", "venue.db")` is the relative `venue.db` — so an empty
 * value would seal a credential wherever the process happened to be running.
 *
 * `store.venue` is the handle, not `store.node`. `tenant_credentials` is classified `local`
 * (`./classification.ts`), which says whose rows they are, not which file holds them:
 * `packages/migrations/src/apply.ts` applies every migration set to the venue file and none to the
 * node file. Both handles are typed on the whole schema barrel, so the compiler cannot tell these
 * apart — `bin.test.ts`'s `set`/`list` round trip is what does.
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
    store = await openVenueDatabase(venueDir);
    return await runCli(argv, {
      db: store.venue,
      ring,
      io,
      readFile: (path) => readFile(path, "utf8"),
    });
  } catch (error) {
    // `runCli` (cli.ts) resolves with a number for every EXPECTED failure — an unknown purpose, an
    // unreadable payload source — and only ever rejects for something none of this package's own
    // code recognizes: a database fault, a bug. `loadKeyRing` and `openVenueDatabase` above can
    // reject too, before `runCli` is even reached (a missing key-ring variable, an unopenable
    // directory). This is the ONE place in the whole package allowed to catch that, so it never
    // reaches the operator as a raw, unformatted dump — a drizzle `DrizzleQueryError`, for
    // instance, embeds the failed query and its bind parameters in its own `.message`, which for a
    // write here is the row's ciphertext, IV and auth-tag bytes. Sealed material, not plaintext, so
    // not a secret leak — but it is noise no operator's terminal needs, and letting an arbitrary
    // error format itself onto stderr is exactly what this package refuses to do everywhere else.
    if (isAppError(error)) {
      io.stderr(`${error.code} ${JSON.stringify(error.params)}`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    io.stderr(`unexpected failure (${name})`);
    return 1;
  } finally {
    // Two open SQLite files; leaking them keeps the process alive after this returns.
    await store?.close();
  }
}

/** The real stdio, including the one refusal that only makes sense against a terminal. */
const processIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin: async () => {
    if (process.stdin.isTTY) {
      // No prompt, no piped input, no --file: the process would otherwise hang forever waiting on
      // a stream that will never see EOF. Fail fast and tell the operator what to do instead —
      // never the secret, obviously, since none has been read yet.
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

// Run only when invoked directly, never when imported by a test. Without this an import alone
// executes the command — which for `set` or `delete` would write to whatever venue the importing
// process's environment happened to name.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runBin(process.argv.slice(2), process.env, processIo);
}
