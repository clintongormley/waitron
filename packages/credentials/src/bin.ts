#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createPostgresDb, type Database } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { runCli } from "./cli.js";
import { loadKeyRing } from "./keyring.js";

/** The only file in this package that touches the process, so everything else stays testable
 * without one. Connection string and key ring both come from the environment; the key ring is
 * validated here, at boot, rather than at the first decrypt. */
async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    process.stderr.write("DATABASE_URL is not set\n");
    return 2;
  }

  let db: Database | undefined;
  try {
    const ring = loadKeyRing(process.env);
    db = await createPostgresDb(connectionString);
    return await runCli(process.argv.slice(2), {
      db,
      ring,
      io: {
        stdout: (line) => process.stdout.write(`${line}\n`),
        stderr: (line) => process.stderr.write(`${line}\n`),
        readStdin: async () => {
          if (process.stdin.isTTY) {
            // No prompt, no piped input, no --file: the process would otherwise hang forever
            // waiting on a stream that will never see EOF. Fail fast and tell the operator what
            // to do instead — never the secret, obviously, since none has been read yet.
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
      },
      readFile: (path) => readFile(path, "utf8"),
    });
  } catch (error) {
    // `runCli` (cli.ts) resolves with a number for every EXPECTED failure — a bad UUID, an
    // unknown purpose, an unreadable payload source — and only ever rejects for something none of
    // this package's own code recognizes: a database fault, a connectivity failure, a bug.
    // `loadKeyRing` and `createPostgresDb` above can reject too, before `runCli` is even reached
    // (a missing key-ring env var, an unreachable database). This is the ONE place in the whole
    // package allowed to catch that, so it never reaches the operator as a raw, unformatted dump —
    // a drizzle `DrizzleQueryError`, for instance, embeds the failed query and its bind parameters
    // in its own `.message`, which for a write here is the row's ciphertext, IV and auth-tag
    // bytes. Sealed material, not plaintext, so not a secret leak — but it is noise no operator's
    // terminal needs, and letting an arbitrary error format itself onto stderr is exactly what
    // this package refuses to do everywhere else.
    if (isAppError(error)) {
      process.stderr.write(`${error.code} ${JSON.stringify(error.params)}\n`);
      return 1;
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`unexpected failure (${name})\n`);
    return 1;
  } finally {
    await db?.close();
  }
}

process.exitCode = await main();
