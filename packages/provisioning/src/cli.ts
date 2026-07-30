import { parseArgs } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import { assertIdentifier } from "./identifiers.js";
import { applyInstance, withDatabase, type TargetConnection } from "./instance-apply.js";
import { describeAction, planInstance, type InstanceAction } from "./instance-plan.js";
import {
  INSTANCE_ROLES,
  readInstanceState,
  type InstanceRole,
  type InstanceState,
} from "./instance-state.js";
import type { ProvisioningIo } from "./io.js";
import { runKeyring } from "./keyring-command.js";
import { sqlStateOf } from "./sql-state.js";
import { formatStatus } from "./status-command.js";
import "./errors.js";

/**
 * Everything this CLI does to the outside world, injected — so the whole wizard is testable with no
 * process, no tty and no container, and nothing here can print a secret behind the suite's back.
 *
 * `readState` and `apply` are injected for the same reason `random` is injected into
 * `generateKeyRing`: their real implementations need a live cluster, and what THIS file decides —
 * what it asks for, what it prints, what it refuses, whether it writes at all — is none of that.
 * `planInstance` is deliberately NOT injected: it is pure, so the tests run the real one and a
 * summary is rendered from a real plan rather than from a fixture that could drift from it.
 */
export interface CliDeps {
  io: ProvisioningIo;
  env: Record<string, string | undefined>;
  /** Opens a connection to a connection string. The caller of each connection closes it. */
  connect(uri: string): Promise<Database>;
  /** `null` means "running from source"; otherwise the folder `scripts/copy-migrations.mjs`
   * produced beside the bundle. `bin.ts` decides which. */
  migrationsRoot: string | null;
  readState: typeof readInstanceState;
  apply: typeof applyInstance;
}

const ENVIRONMENTS: DeploymentEnvironment[] = ["production", "preproduction"];

/** The one environment variable this tool reads a secret from. Named once so the guard that
 * refuses an empty one and the error that reports it cannot drift apart. */
const ADMIN_URI_VARIABLE = "WAITRON_ADMIN_DATABASE_URL";

const USAGE = [
  "usage: waitron-provision <command> [options]",
  "",
  "  keyring                                            generate the credential key ring",
  "  instance [--database <name>] [--environment <env>] [--yes]",
  "  status   [--database <name>]",
  "",
  `  <env> is one of: ${ENVIRONMENTS.join(", ")}`,
  "",
  "Every option is prompted for when omitted.",
  "",
  "The admin connection string is NOT an option. It carries a password, and argv is",
  "world-readable in `ps` and lands in shell history, so it is read from",
  "WAITRON_ADMIN_DATABASE_URL or from an echo-off prompt — and from nowhere else.",
  "It must be a URL: postgres://user:pass@host:port/database. A libpq keyword/value",
  "string or a bare socket path is refused — see README.md, 'Secrets'.",
  "",
  "There is no `tenant` yet: see docs/superpowers/specs/2026-07-29-provisioning-tool-design.md.",
].join("\n");

/**
 * Returns the exit code rather than calling `process.exit`, so every path is reachable from a test
 * that does not have to kill the runner to observe it. `bin.ts` is the only thing that touches the
 * process.
 *
 * The command name is taken off the front HERE rather than parsed: it is a positional, and
 * `allowPositionals: false` below is what rejects a stray one AFTER the command. Same split
 * `packages/credentials/src/cli.ts` uses.
 */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "keyring":
      return keyring(rest, deps);
    case "instance":
      return instance(rest, deps);
    case "status":
      return status(rest, deps);
    default:
      deps.io.stderr(USAGE);
      return 2;
  }
}

/**
 * `strict: true` is what makes the "never accepts a secret as an argument" test pass: an unknown
 * flag such as `--password` or `--admin-url` is a parse error, not something silently ignored. If a
 * future maintainer adds one, `cli.test.ts` goes red — which is the point.
 *
 * `allowPositionals: false` is the second half: node:util treats an unrecognized `--flag value` as
 * a boolean flag followed by a stray positional, so without it the two-token form of a rejected
 * flag would be accepted and its value dropped on the floor.
 */
function parse<T extends NonNullable<Parameters<typeof parseArgs>[0]>["options"]>(
  argv: string[],
  options: T,
) {
  return parseArgs({ args: argv, options, strict: true, allowPositionals: false });
}

/**
 * `keyring` takes no options — and parses its arguments anyway, which is the whole point.
 *
 * Discarding `argv` here instead left a hole in the guarantee `USAGE` and `README.md` both state
 * universally. Verified through the built bundle before this function existed:
 * `node dist/bin.js keyring --admin-url=postgres://admin:hunter2@h/db --password hunter2` printed
 * the key ring and exited 0. Nothing read or printed the flags, so no secret leaked out of the
 * tool — but the operator had just been told such a flag would be REFUSED, and their shell history
 * now held a connection string on the strength of that. A guarantee that holds for two commands out
 * of three is not the guarantee the documentation makes.
 *
 * `parse(argv, {})` with no declared options means every flag is unknown and every positional is
 * stray, so `strict: true` and `allowPositionals: false` reject the lot.
 */
async function keyring(argv: string[], deps: CliDeps): Promise<number> {
  try {
    parse(argv, {});
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }
  return runKeyring(deps.io);
}

async function instance(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      database: { type: "string" },
      environment: { type: "string" },
      yes: { type: "boolean" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  try {
    // Both resolved and VALIDATED before the admin connection string is even asked for: a mistyped
    // database name should not cost the operator a paste of a privileged credential first.
    const database = await resolveOption(values.database, "database name: ", deps);
    assertIdentifier("database", database);
    const environment = assertEnvironment(
      await resolveOption(
        values.environment,
        `deployment environment (${ENVIRONMENTS.join(" | ")}): `,
        deps,
      ),
    );
    const adminUri = await resolveAdminUri(deps);

    return await withState(adminUri, database, deps, async (state, admin, openTarget) => {
      const actions = planInstance(state, { database, environment });

      // Never empty in practice, and deliberately not special-cased: `planInstance` re-issues every
      // grant on every run (instance-plan.ts's "Grants are re-issued on every run rather than
      // diffed"), so even a fully-provisioned database yields the two grant actions. A "nothing to
      // do" branch here would be unreachable code claiming to handle a state that cannot arise.
      deps.io.stdout(`Plan for ${database} (${environment}):`);
      // Which cluster, so the operator confirming this can see the mistake the summary otherwise
      // hides — see `describeAdmin`. Never the password.
      deps.io.stdout(`Cluster: ${describeAdmin(adminUri)}`);
      deps.io.stdout("");
      for (const action of actions) deps.io.stdout(`  ${describeAction(action)}`);
      deps.io.stdout("");

      const created = actions.filter((action) => action.kind === "create-role");
      if (created.length === 0) {
        // Disclosed HERE, above the prompt, rather than in `reportRoles` where the same fact used to
        // surface first. `reportRoles` runs after create, migrate and stamp, so an operator who
        // would have declined on learning this learnt it too late to decline. The plan is pure and
        // `created` falls straight out of it, so nothing has to be reached to know it.
        //
        // The case is a second database on a cluster that already carries the three roles — the
        // roles are cluster-global while the database is not — and the reason no string can be
        // printed is `reportRoles`': this tool did not generate those passwords and cannot read one
        // back out of `pg_authid`.
        deps.io.stdout("No connection strings will be printed: every role this needs already");
        deps.io.stdout("exists, and this tool cannot recover a password it did not generate.");
        deps.io.stdout("");
      }

      if (values.yes !== true) {
        const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          deps.io.stderr("Nothing was applied.");
          return 1;
        }
      }

      try {
        await deps.apply(actions, {
          admin,
          database,
          adminUri,
          migrationsRoot: deps.migrationsRoot,
          // `withState`'s accessor, NOT a second dial of the same database. On every re-run
          // `withState` already holds a connection to the target — it opened one to read the
          // deployment's state — and the migrator's schema grant is re-issued unconditionally, so
          // `applyInstance` wants one on every run too. Passing `() => deps.connect(...)` here
          // opened a second identical connection each time; `createPostgresDb` connects and
          // releases up front, so that was a real TCP connect and auth handshake, not a cheap
          // object. See `withState` for why it is safe to lend, and `TargetConnection` for who
          // closes it.
          openTarget,
        });
      } catch (error) {
        if (created.length > 0) {
          // The unrecoverable half of a partial apply, said plainly rather than left for the
          // operator to discover: `applyInstance` is not one transaction (PostgreSQL refuses CREATE
          // DATABASE inside one), so a role may exist carrying a password this run generated in
          // memory and is now about to lose. A re-run will not recreate it — the planner sees it
          // and leaves it alone — so the only way back is to drop it.
          //
          // The roles are NAMED. `created` is right here and holds exactly the roles this run
          // minted; the previous wording sent the operator to run `status` and work out for
          // themselves which `waitron_*` roles they had no connection string for, which is
          // re-deriving something already in scope, at the one moment the tool has just failed.
          // Only `created`, never `INSTANCE_ROLES`: a role that already existed has an owner and a
          // password this tool never generated, and telling anyone to drop it would be worse advice
          // than the vague version.
          deps.io.stderr("");
          deps.io.stderr(
            "The plan failed part-way through. Any role it created before failing now",
          );
          deps.io.stderr("exists with a password that was NOT printed and cannot be recovered.");
          deps.io.stderr("");
          deps.io.stderr("This run creates these roles, so drop whichever of them now exist:");
          for (const action of created) deps.io.stderr(`  DROP ROLE ${action.role};`);
          deps.io.stderr("");
          deps.io.stderr("`waitron-provision status` says which are present. Then run this again.");
        }
        throw error;
      }

      await reportRoles(created, adminUri, database, deps);
      return 0;
    });
  } catch (error) {
    return reportFailure(error, deps);
  }
}

async function status(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, { database: { type: "string" } }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  try {
    const database = await resolveOption(values.database, "database name: ", deps);
    assertIdentifier("database", database);
    const adminUri = await resolveAdminUri(deps);
    return await withState(adminUri, database, deps, async (state) => {
      for (const line of formatStatus(state)) deps.io.stdout(line);
      return 0;
    });
  } catch (error) {
    return reportFailure(error, deps);
  }
}

/**
 * Opens the connections, reads the deployment's state, runs `body`, and closes everything.
 *
 * Two reads rather than one: `readInstanceState`'s `target` argument is a connection to a database
 * that, on a first provision, does not exist yet. The first read answers whether it does; only then
 * can the second look inside.
 *
 * Any failure carrying a SQLSTATE — from the CONNECT or from either read — becomes
 * `provisioning.state_unreadable`, because the likeliest ones are not bugs. Both were reproduced
 * through the built bundle against `postgres:18-alpine`, not reasoned about:
 *
 * - An admin that did NOT create the target database holds no privilege on the tables inside it,
 *   so the stamp read fails `permission denied for table deployment` (42501). Raw, the operator
 *   saw `unexpected failure (Error)` and nothing else — no database named, no code, no remedy.
 * - A wrong password in the admin connection string fails 28P01 at `deps.connect`, NOT at the
 *   first read: `pg` authenticates when the pool hands out its first connection, which is why the
 *   connect is inside this guard rather than above it. An earlier draft of this comment claimed
 *   the opposite ("`pg` authenticates lazily on first use"); the container disagreed, printing
 *   `unexpected failure (error)` with the connect left outside.
 *
 * README.md carries both transcripts and the remedy for each.
 *
 * A failure with NO SQLSTATE is rethrown untouched. It is a broken socket or a bug, not a fact
 * about this database, and labelling it one would be this repository's dominant defect class.
 */
async function withState(
  adminUri: string,
  database: string,
  deps: CliDeps,
  body: (
    state: InstanceState,
    admin: Database,
    openTarget: () => Promise<TargetConnection>,
  ) => Promise<number>,
): Promise<number> {
  let admin: Database;
  try {
    admin = await deps.connect(adminUri);
  } catch (error) {
    throw asUnreadable(error, database);
  }

  let target: Database | null = null;
  try {
    let state: InstanceState;
    try {
      const probe = await deps.readState(admin, database, null);
      if (probe.databaseExists) target = await deps.connect(withDatabase(adminUri, database));
      state = target === null ? probe : await deps.readState(admin, database, target);
    } catch (error) {
      throw asUnreadable(error, database);
    }
    // The ONE place a connection to the target is opened, for both the state read above and for
    // anything `body` hands to `applyInstance`. `release` is a no-op because this function's own
    // `finally` is what closes it — ownership stated once, here, rather than split across two
    // files that each half-assume it.
    return await body(state, admin, async () => {
      target ??= await deps.connect(withDatabase(adminUri, database));
      return { db: target, release: async () => {} };
    });
  } finally {
    // Nested so a failure closing the target cannot skip closing the admin connection. Both are
    // pools; leaking either keeps the process alive after `main` returns.
    try {
      await target?.close();
    } finally {
      await admin.close();
    }
  }
}

/**
 * The structured form of a failure to reach or read a deployment — or the original error, when it
 * carries no SQLSTATE and is therefore not the database's verdict on anything.
 *
 * Returns the error to throw rather than throwing it, so each call site reads as `throw
 * asUnreadable(...)` and TypeScript still sees the path as terminating.
 */
function asUnreadable(error: unknown, database: string): unknown {
  const sqlState = sqlStateOf(error);
  if (sqlState === null) return error;
  return new AppError("provisioning.state_unreadable", { database, sqlState });
}

/** A flag's value, or the answer to a question. An empty flag (`--database=`) counts as absent. */
async function resolveOption(
  value: string | undefined,
  question: string,
  deps: CliDeps,
): Promise<string> {
  if (typeof value === "string" && value !== "") return value;
  return (await deps.io.prompt(question)).trim();
}

/**
 * The admin connection string, from the environment or from an echo-off prompt.
 *
 * There is no third source, and specifically no flag: the string carries a password, `argv` is
 * world-readable in `ps` and lands in shell history, and `parse` above is `strict` precisely so
 * that adding one is a parse error rather than a silent acceptance.
 *
 * **An empty answer is refused, not returned.** The env var was already guarded for `""`; the
 * prompt's answer was not, and `bin.ts`'s `ask` returns `""` deliberately for an exhausted stdin or
 * a Ctrl+D. `pg` treats an empty connection string as no connection string at all rather than as an
 * error — run against this repo's `pg@8.22.0`, `new Client({ connectionString: "" })` resolved to
 * `{host:"localhost",port:5432,user:"<OS user>",database:"<OS user>"}`, and `pg-pool@3.14.0` builds
 * its clients with `new this.Client(this.options)` (`index.js:241`) from the same options — so
 * `instance` would have created, migrated and STAMPED a database on whatever cluster answers there.
 * See `errors.ts` for why that is the unacceptable failure mode rather than merely a confusing one.
 *
 * **A string that is not a URL is refused too**, and this is the ONE place that decides it, for
 * both commands and both sources. `pg` accepts forms `new URL` rejects — measured, not assumed:
 * inside a `postgres:18-alpine` container (PostgreSQL 18.4) with this repo's `pg@8.22.0`, the
 * connection string `/var/run/postgresql` parsed to `{host:"/var/run/postgresql",port:5432}`,
 * `connect()` succeeded and `select inet_server_addr() is null` returned `t`, while
 * `new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the same process. Every
 * consumer of this string after this function re-points it with `new URL` — `withState`'s
 * `withDatabase`, the migrator's URL in `instance-apply.ts`, `roleUri` for each printed connection
 * string, `describeAdmin` for the plan summary — so a form only `pg` accepts is a form this tool
 * cannot carry. `errors.ts` records why the fix is a refusal rather than a conninfo parser.
 */
async function resolveAdminUri(deps: CliDeps): Promise<string> {
  const uri = await readAdminUri(deps);
  // `URL.canParse` rather than a try/catch: there is then no caught error object in scope for a
  // future edit to print, and the error thrown here carries no part of the string by construction.
  if (!URL.canParse(uri)) {
    throw new AppError("provisioning.admin_uri_not_a_url", { variable: ADMIN_URI_VARIABLE });
  }
  return uri;
}

async function readAdminUri(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_URI_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  const answer = (await deps.io.promptSecret("admin connection string (not shown): ")).trim();
  if (answer === "") {
    throw new AppError("provisioning.admin_uri_missing", { variable: ADMIN_URI_VARIABLE });
  }
  return answer;
}

/**
 * WHICH CLUSTER is about to be written to, for the confirmation an operator gives.
 *
 * The plan summary named a database and an environment and nothing else, so it could not reveal
 * the one mistake it exists to catch: an admin connection string pointing somewhere other than
 * where the operator believes. That is the fiscally expensive mistake — one database per
 * environment, a pre-production database is never promoted, and `instance` migrates and STAMPS
 * whatever it is pointed at.
 *
 * Host, port and username. NEVER the password and never the whole string: `README.md`'s "Secrets"
 * section used to promise the admin's username was never printed either, and was narrowed in the
 * commit that added this rather than left to contradict the code.
 *
 * `new URL` cannot throw here, and that is a fact about `resolveAdminUri` rather than about this
 * function: it refuses a string `new URL` cannot parse before returning one, so the only strings
 * that reach here have already been parsed once. This used to carry its own `try`/`catch`
 * returning "unknown — the admin connection string is not a URL", which was the right answer while
 * such a string could get this far. It no longer can, and the case it existed for — a Unix-socket
 * directory path such as `/var/run/postgresql`, which `pg` connects with and `new URL` rejects —
 * is now refused up front, because `withDatabase` and `roleUri` needed the same parse and threw a
 * bare `TypeError` at it after `migrate` and `stamp` had already run.
 */
function describeAdmin(adminUri: string): string {
  const url = new URL(adminUri);
  return url.username === "" ? url.host : `${url.username}@${url.host}`;
}

function assertEnvironment(environment: string): DeploymentEnvironment {
  if (environment !== "production" && environment !== "preproduction") {
    throw new AppError("deployment.unknown_environment", {
      environment,
      known: [...ENVIRONMENTS],
    });
  }
  return environment;
}

/**
 * One line per role, and a connection string only for the roles this run created.
 *
 * A role that already existed gets a line saying so and NOTHING else: this tool did not generate
 * its password, cannot read one back out of `pg_authid` (it is hashed), and a connection string
 * with a wrong password is worse than no connection string — it looks usable and fails at the
 * host's first connect.
 *
 * The screen is cleared afterwards, on the same terms and with the same caveat `runKeyring` states,
 * but ONLY when something secret was printed. Nothing was created means nothing to wipe, and
 * wiping would take the plan summary with it for no benefit.
 */
async function reportRoles(
  created: readonly Extract<InstanceAction, { kind: "create-role" }>[],
  adminUri: string,
  database: string,
  deps: CliDeps,
): Promise<void> {
  const passwords = new Map<InstanceRole, string>(
    created.map((action) => [action.role, action.password]),
  );

  deps.io.stdout("");
  deps.io.stdout("Roles:");
  deps.io.stdout("");
  for (const role of INSTANCE_ROLES) {
    const password = passwords.get(role);
    if (password === undefined) {
      deps.io.stdout(`  ${role}: already existed — no connection string, because this tool did`);
      deps.io.stdout(`  ${" ".repeat(role.length)}  not generate its password and cannot read it.`);
      continue;
    }
    deps.io.stdout(`  ${role}: ${roleUri(adminUri, role, password, database)}`);
  }

  if (created.length === 0) return;

  deps.io.stdout("");
  deps.io.stdout("Each connection string above is shown ONCE. The password in it was generated");
  deps.io.stdout("here, is stored nowhere, and cannot be recovered — a role whose string is lost");
  deps.io.stdout("has to be dropped and re-created.");
  deps.io.stdout("");
  deps.io.stdout("waitron_app is the host's DATABASE_URL; waitron_migrator is its");
  deps.io.stdout("WAITRON_MIGRATIONS_DATABASE_URL. See apps/server/README.md.");
  deps.io.stdout("");
  // The same wording and the same honesty as `runKeyring`: clearing is a real improvement and not a
  // guarantee.
  deps.io.stdout("The screen and scrollback will be cleared when you continue. That is not a");
  deps.io.stdout("guarantee: a terminal that logs to disk, or tmux's own buffer, still has it.");
  // AWAITED, not fired and forgotten. `keyring-command.test.ts`'s "waits for the operator before
  // clearing" documents the mutant this rules out: `void io.prompt(...)` records the same call
  // order and wipes an unrecoverable secret off the screen before it has been copied.
  await deps.io.prompt("Press enter once you have stored them. ");
  deps.io.clearScreen();
}

/** The admin's connection string, re-pointed at one role and the target database. The generated
 * password needs no escaping: base64url's alphabet is `[A-Za-z0-9_-]` (identifiers.ts). */
function roleUri(adminUri: string, role: string, password: string, database: string): string {
  const u = new URL(adminUri);
  u.username = role;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * An `AppError` as the one line this tool ever prints for it: the CODE and the structured params,
 * never a raw message and never a value. Params are field names, identifiers, environment-variable
 * names and SQLSTATEs by construction — `errors.ts`'s header is what keeps that true.
 *
 * Exported because `bin.ts` prints the SAME line for an `AppError` that escaped `runCli` entirely,
 * and it had its own copy of this template. Two implementations of "never a message" is one too
 * many when the message is what carries `CREATE ROLE … PASSWORD '<generated>'`, and `bin.ts` is on
 * the coverage-excluded side, so the copy that could drift was the one no test would catch.
 */
export function formatAppError(error: AppError): string {
  return `${error.code} ${JSON.stringify(error.params)}`;
}

/** Reports an `AppError` and rethrows anything else — a database fault or a bug is not something
 * this file understood, and flattening it into an exit code would claim otherwise. */
function reportFailure(error: unknown, deps: CliDeps): number {
  if (isAppError(error)) {
    deps.io.stderr(formatAppError(error));
    return 1;
  }
  throw error;
}
