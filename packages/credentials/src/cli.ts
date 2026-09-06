import { parseArgs } from "node:util";
import { withTenant, type Database } from "@waitron/db";
import { AppError, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import type { KeyRing } from "./keyring.js";
import { PURPOSES, isPurpose } from "./purposes.js";
import {
  credentialTenants,
  deleteCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
  type RotationResult,
} from "./store.js";

/** Everything the CLI does to the outside world, injected — so the tests need no process, no real
 * stdin and no temp files, and nothing here can print a secret behind the suite's back. */
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
  "  set    --tenant <uuid> --purpose <name> [--file <path>]   payload on stdin by default",
  "  list   [--tenant <uuid>]",
  "  rotate",
  "  delete --tenant <uuid> --purpose <name>",
  "",
  `purposes: ${Object.keys(PURPOSES).join(", ")}`,
  "",
  "There is no `get`: this tool never prints a decrypted credential.",
].join("\n");

/**
 * Returns the exit code rather than calling `process.exit`, so every path is reachable from a test
 * that does not have to kill the runner to observe it. `bin.ts` is the only thing that touches the
 * process.
 */
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

/** `strict: true` is what makes the "never accepts a payload as an argument" test pass: an unknown
 * flag such as `--value` is a parse error, not something silently ignored. If a future maintainer
 * adds a `--value` option, cli.test.ts goes red — which is the point. */
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
      tenant: { type: "string" },
      purpose: { type: "string" },
      file: { type: "string" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  const tenant = values.tenant;
  const purpose = values.purpose;
  if (typeof tenant !== "string" || typeof purpose !== "string") {
    deps.io.stderr(USAGE);
    return 2;
  }

  // Resolved BEFORE any I/O (stdin/file read, purpose check) so a mistyped UUID fails fast.
  const tenantId = resolveTenant(tenant, deps);
  if (typeof tenantId !== "string") return tenantId;

  if (!isPurpose(purpose)) {
    // The structured code, not an ad-hoc sentence: `credentials.unknown_purpose` exists precisely
    // for this boundary — the store below takes a typed `Purpose` and so cannot raise it — and
    // `known` is what lets the operator see the legal set without reading the source.
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
    // Neither underlying error is safe to print verbatim: a filesystem error can embed
    // platform-specific text, and a stdin failure (`bin.ts` refusing to wait on an interactive
    // terminal) is not this package's message to format. `path` is the argument the operator
    // typed, never file content, so it carries no payload either way.
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
    await withTenant(deps.db, tenantId, (tx) =>
      putCredential(tx, deps.ring, { tenantId, purpose, value: payload }),
    );
  } catch (error) {
    return reportFailure(error, deps);
  }
  deps.io.stdout(`set ${purpose} for ${tenantId}`);
  return 0;
}

async function list(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { tenant: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  let tenants: TenantId[];
  if (typeof values.tenant === "string") {
    const tenantId = resolveTenant(values.tenant, deps);
    if (typeof tenantId !== "string") return tenantId;
    tenants = [tenantId];
  } else {
    // No --tenant: enumerate through credential_tenants, once per purpose, and
    // de-duplicate — a tenant holding two purposes would otherwise be visited twice below, and
    // print every one of its rows twice. There is no untenanted read of the table itself.
    tenants = [
      ...new Set(
        (
          await Promise.all(
            Object.keys(PURPOSES).map((purpose) => credentialTenants(deps.db, purpose)),
          )
        ).flat(),
      ),
    ];
  }

  for (const tenantId of tenants) {
    const rows = await withTenant(deps.db, tenantId, (tx) => listCredentials(tx));
    for (const row of rows) {
      // Metadata only — purpose, key version, when it was last written. Never a field name, never a
      // value.
      deps.io.stdout(`${row.tenantId}\t${row.purpose}\tv${row.keyVersion}\t${row.updatedAt}`);
    }
  }
  return 0;
}

async function remove(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { tenant: { type: "string" }, purpose: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }
  const tenant = values.tenant;
  const purpose = values.purpose;
  if (typeof tenant !== "string" || typeof purpose !== "string" || !isPurpose(purpose)) {
    deps.io.stderr(USAGE);
    return 2;
  }
  const tenantId = resolveTenant(tenant, deps);
  if (typeof tenantId !== "string") return tenantId;
  const deleted = await withTenant(deps.db, tenantId, (tx) =>
    deleteCredential(tx, { tenantId, purpose }),
  );
  if (!deleted) {
    // Non-zero: "there was nothing there" is a different outcome from "removed it", and a script
    // that de-provisions a tenant should be able to tell them apart.
    deps.io.stderr(`no ${purpose} credential for ${tenantId}`);
    return 1;
  }
  deps.io.stdout(`deleted ${purpose} for ${tenantId}`);
  return 0;
}

/**
 * `rotateCredentials` throws `credentials.key_version_unknown` for the single likeliest operator
 * mistake — running `rotate` after `WAITRON_CREDENTIALS_KEY_PREVIOUS` was already dropped, while
 * rows still need it — and every other command in this file routes its own errors through
 * `reportFailure` rather than letting them escape `runCli`. `rotate` did not; this wraps it the
 * same way.
 */
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

/**
 * Brands a raw `--tenant` argument, or reports the failure and yields the exit code to return.
 *
 * `brandTenantId` throws a plain `AppError` on any non-UUID string, and `runCli`'s contract is
 * "returns the exit code, never rejects for an ordinary operator mistake" (see its doc comment).
 * Left unguarded, a truncated or mis-pasted tenant id — the likeliest operator typo there is —
 * crashes `bin.ts` with an unhandled rejection instead of the clean structured line a bad
 * `--purpose` gets.
 *
 * One home rather than three: `set`, `list` and `remove` each carried this block verbatim, and two
 * of the three comments said only "same reasoning as `set`'s" — the duplication was noticed at the
 * time, not missed. That mattered more than line count, because the resolve-don't-reject property
 * is the safety-critical one in this file and was being upheld by three independently-maintained
 * copies.
 *
 * Returns `TenantId` (a branded string) on success and a number on failure, so callers discriminate
 * with `typeof !== "string"` and return the code directly.
 */
function resolveTenant(raw: string, deps: CliDeps): TenantId | number {
  try {
    return brandTenantId(raw);
  } catch (error) {
    return reportFailure(error, deps);
  }
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
