import { parseArgs } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import { assertIdentifier } from "./identifiers.js";
import { applyInstance, withDatabase } from "./instance-apply.js";
import { planInstance, type InstanceAction } from "./instance-plan.js";
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
      return runKeyring(deps.io);
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

    return await withState(adminUri, database, deps, async (state, admin) => {
      const actions = planInstance(state, { database, environment });

      // Never empty in practice, and deliberately not special-cased: `planInstance` re-issues every
      // grant on every run (instance-plan.ts's "Grants are re-issued on every run rather than
      // diffed"), so even a fully-provisioned database yields the two grant actions. A "nothing to
      // do" branch here would be unreachable code claiming to handle a state that cannot arise.
      deps.io.stdout(`Plan for ${database} (${environment}):`);
      deps.io.stdout("");
      for (const action of actions) deps.io.stdout(`  ${describe(action)}`);
      deps.io.stdout("");

      if (values.yes !== true) {
        const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          deps.io.stderr("Nothing was applied.");
          return 1;
        }
      }

      const created = actions.filter((action) => action.kind === "create-role");
      try {
        await deps.apply(actions, {
          admin,
          database,
          adminUri,
          migrationsRoot: deps.migrationsRoot,
          // Its own connection, not the one `withState` holds: `applyInstance` closes whatever this
          // returns, and `withState` closes its own — one handle closed twice is an error in `pg`.
          openTarget: () => deps.connect(withDatabase(adminUri, database)),
        });
      } catch (error) {
        if (created.length > 0) {
          // The unrecoverable half of a partial apply, said plainly rather than left for the
          // operator to discover: `applyInstance` is not one transaction (PostgreSQL refuses CREATE
          // DATABASE inside one), so a role may exist carrying a password this run generated in
          // memory and is now about to lose. A re-run will not recreate it — the planner sees it
          // and leaves it alone — so the only way back is to drop it.
          deps.io.stderr("");
          deps.io.stderr(
            "The plan failed part-way through. Any role it created before failing now",
          );
          deps.io.stderr("exists with a password that was NOT printed and cannot be recovered.");
          deps.io.stderr(
            "Run `waitron-provision status`, DROP ROLE every waitron_* role listed as",
          );
          deps.io.stderr("present that you have no connection string for, then run this again.");
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
  body: (state: InstanceState, admin: Database) => Promise<number>,
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
    return await body(state, admin);
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
 */
async function resolveAdminUri(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env.WAITRON_ADMIN_DATABASE_URL;
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return (await deps.io.promptSecret("admin connection string (not shown): ")).trim();
}

function assertEnvironment(value: string): DeploymentEnvironment {
  if (value !== "production" && value !== "preproduction") {
    throw new AppError("deployment.unknown_environment", { value, known: [...ENVIRONMENTS] });
  }
  return value;
}

/**
 * One plan action, as a line an operator can check.
 *
 * The `create-role` case prints the role's attributes and memberships and NOT `action.password`.
 * That is the whole reason this is a function rather than `JSON.stringify(action)`: the plan is
 * printed before the confirmation, on a screen that is not cleared afterwards unless something was
 * created, and `cli.test.ts`'s "never puts a generated password in the plan summary" counts each
 * password's occurrences in the whole transcript to keep it that way.
 */
function describe(action: InstanceAction): string {
  switch (action.kind) {
    case "create-database":
      return `create database ${action.database}`;
    case "create-role": {
      const attributes = ["login", ...(action.createRole ? ["createrole"] : [])];
      const memberships =
        action.memberOf.length > 0 ? `, member of ${action.memberOf.join(", ")}` : "";
      return `create role ${action.role} (${attributes.join(", ")}${memberships})`;
    }
    case "grant-membership":
      return `grant ${action.memberOf} to ${action.role}`;
    case "grant-database-create":
      return `grant create on database ${action.database} to ${action.role}`;
    case "grant-schema-create":
      return `grant create on schema public to ${action.role}${
        action.withGrantOption ? " with grant option" : ""
      }`;
    case "migrate":
      return "apply every migration set";
    case "stamp":
      return `stamp the database as ${action.environment}`;
  }
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

/** Prints an AppError's CODE and structured params — never a raw message, and never a value. Params
 * are field names, identifiers and SQLSTATEs by construction (see errors.ts). */
function reportFailure(error: unknown, deps: CliDeps): number {
  if (isAppError(error)) {
    deps.io.stderr(`${error.code} ${JSON.stringify(error.params)}`);
    return 1;
  }
  throw error;
}
