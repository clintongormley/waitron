import { parseArgs } from "node:util";
import { withTransaction, type Database } from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import type { KeyRing } from "./keyring.js";
import { PURPOSES, isPurpose } from "./purposes.js";
import {
  deleteCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
  type RotationResult,
} from "./store.js";

/** Everything the CLI does to the outside world, injected, so nothing here can print behind a
 * test's back. */
export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
  readStdin(): Promise<string>;
}

export interface CliDeps {
  db: Database;
  ring: KeyRing;
  io: CliIo;
  readFile(path: string): Promise<string>;
}

const USAGE = [
  "usage: waitron-credentials <command> [options]",
  "",
  "  set    --purpose <name> [--file <path>]   payload on stdin by default",
  "  list",
  "  rotate",
  "  delete --purpose <name>",
  "",
  `purposes: ${Object.keys(PURPOSES).join(", ")}`,
  "",
  "There is no `get`: this tool never prints a decrypted credential.",
].join("\n");

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "set":
      return set(rest, deps);
    case "list":
      return list(rest, deps);
    case "delete":
      return remove(rest, deps);
    case "rotate":
      return rotate(deps);
    default:
      deps.io.stderr(USAGE);
      return 2;
  }
}

/** `strict: true`: an unknown flag such as `--value` is a parse error, so a payload can never be
 * passed as an argument. */
function parse<T extends NonNullable<Parameters<typeof parseArgs>[0]>["options"]>(
  argv: string[],
  options: T,
) {
  return parseArgs({ args: argv, options, strict: true, allowPositionals: false });
}

async function set(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      purpose: { type: "string" },
      file: { type: "string" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  const purpose = values.purpose;
  if (typeof purpose !== "string") {
    deps.io.stderr(USAGE);
    return 2;
  }

  if (!isPurpose(purpose)) {
    return reportFailure(
      new AppError("credentials.unknown_purpose", { purpose, known: Object.keys(PURPOSES) }),
      deps,
    );
  }

  let raw: string;
  try {
    raw =
      typeof values.file === "string"
        ? await deps.readFile(values.file)
        : await deps.io.readStdin();
  } catch {
    // Neither underlying error is printed. `path` is the argument the operator typed, never file
    // content.
    return reportFailure(
      new AppError("credentials.payload_unreadable", {
        source: typeof values.file === "string" ? "file" : "stdin",
        path: typeof values.file === "string" ? values.file : null,
      }),
      deps,
    );
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // NOT echoed: `raw` is a credential payload, and a parse error that quoted it would put a
      // secret in the operator's terminal and scrollback.
      deps.io.stderr("payload must be a JSON object of string fields");
      return 2;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    deps.io.stderr("payload is not valid JSON");
    return 2;
  }

  try {
    await withTransaction(deps.db, (tx) =>
      putCredential(tx, deps.ring, { purpose, value: payload }),
    );
  } catch (error) {
    return reportFailure(error, deps);
  }
  deps.io.stdout(`set ${purpose}`);
  return 0;
}

async function list(argv: string[], deps: CliDeps): Promise<number> {
  try {
    parse(argv, {});
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  const rows = await withTransaction(deps.db, (tx) => listCredentials(tx));
  for (const row of rows) {
    // Never a field name, never a value.
    deps.io.stdout(`${row.purpose}\tv${row.keyVersion}\t${row.updatedAt}`);
  }
  return 0;
}

async function remove(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { purpose: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }
  const purpose = values.purpose;
  if (typeof purpose !== "string" || !isPurpose(purpose)) {
    deps.io.stderr(USAGE);
    return 2;
  }
  const deleted = await withTransaction(deps.db, (tx) => deleteCredential(tx, { purpose }));
  if (!deleted) {
    // Non-zero: "there was nothing there" is a different outcome from "removed it", and a script
    // that de-provisions a purpose should be able to tell them apart.
    deps.io.stderr(`no ${purpose} credential`);
    return 1;
  }
  deps.io.stdout(`deleted ${purpose}`);
  return 0;
}

async function rotate(deps: CliDeps): Promise<number> {
  let result: RotationResult;
  try {
    result = await rotateCredentials(deps.db, deps.ring);
  } catch (error) {
    return reportFailure(error, deps);
  }
  deps.io.stdout(`rotated ${result.rotated}, already current ${result.alreadyCurrent}`);
  return 0;
}

/** Prints an AppError's CODE and structured params — never a raw message, and never a value. Params
 * are field names and identifiers by construction (see errors.ts). */
function reportFailure(error: unknown, deps: CliDeps): number {
  if (isAppError(error)) {
    deps.io.stderr(`${error.code} ${JSON.stringify(error.params)}`);
    return 1;
  }
  throw error;
}
