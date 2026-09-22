import { parseArgs } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import {
  isUniqueViolation,
  readDeploymentEnvironment,
  type Database,
  type DeploymentEnvironment,
} from "@waitron/db";
import {
  assertPasswordLength,
  assertPinLength,
  hashPassword,
  hashPin,
  normalizeAndValidateEmail,
} from "@waitron/identity";
import { enabledModules, type ModuleConfig, type WaitronModule } from "@waitron/module";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { assertIdentifier, withDatabase, withRole } from "./identifiers.js";
import type { ProvisioningIo } from "./io.js";
import { runKeyring } from "./keyring-command.js";
import { sqlStateOf } from "./sql-state.js";
import { applyVenue } from "./venue-apply.js";
import { describeVenueAction, planVenue, type VenueRequest } from "./venue-plan.js";
import { assertNoForeignTenant, readTenantIdentities } from "./tenant-guard.js";
import "./errors.js";

/**
 * Everything this CLI does to the outside world, injected — so the whole wizard is testable with no
 * process, no tty and no container, and nothing here can print a secret behind the suite's back.
 *
 * `applyVenue` is injected for the same reason `random` is injected into `generateKeyRing`: its
 * real implementation needs a live target database, and what THIS file decides — what it asks for,
 * what it prints, what it refuses, whether it writes at all — is none of that. `planVenue` is
 * deliberately NOT injected: it is pure, so the tests run the real one and a summary is rendered
 * from a real plan rather than from a fixture that could drift from it.
 */
export interface CliDeps {
  io: ProvisioningIo;
  env: Record<string, string | undefined>;
  /** Opens a connection to a connection string. The caller of each connection closes it. */
  connect(uri: string): Promise<Database>;
  /** The venue apply: it runs the whole location flow as one transaction against a live target
   * database, and what `venue` decides — what it prompts, prints and refuses — is testable without
   * one. `planVenue`/`describeVenueAction` are pure, so they are NOT injected: the tests run the
   * real ones and the summary is rendered from a real plan rather than a fixture that could drift
   * from it. */
  applyVenue: typeof applyVenue;
  /** The composition list (`@waitron/composition`'s `ALL_MODULES`), injected like `applyVenue`. `venue`
   * resolves the fiscal slot from the territory (`selectFiscalModule`) and threads only the ENABLED set
   * into `planVenue`/`applyVenue`, so a no-regime (`GB-…`) venue never emits Veri*Factu's SIF seed. */
  modules: readonly WaitronModule[];
  /** Persists the resolved fiscal-slot `modules.json` after a successful venue apply, so a box booting
   * against this database reads a slot that resolves (design §4). OPTIONAL and injected (`bin.ts` wires
   * it to write `<WAITRON_STATE_DIR>/modules.json` when that env var is set): absent, `venue` still
   * selects the fiscal module for the plan/apply but writes no file. */
  writeModuleConfig?: (config: ModuleConfig) => Promise<void>;
  /** Reads a target database's deployment stamp. Injected so the "unstamped is refused" path is
   * reachable without a container; the real one (`@waitron/db`) needs the target connection. */
  readEnvironment: typeof readDeploymentEnvironment;
  /** Reads the fiscal identity of every tenant already in the target database. Injected like
   * `readEnvironment` so the foreign-tenant refusal is reachable without a container; the real one
   * (`readTenantIdentities`, `./tenant-guard.js`) needs the target connection. */
  readTenants: typeof readTenantIdentities;
}

/** The one environment variable this tool reads a secret from. Named once so the guard that
 * refuses an empty one and the error that reports it cannot drift apart. */
const ADMIN_URI_VARIABLE = "WAITRON_ADMIN_DATABASE_URL";

/** The env var the admin PIN is read from. A login PIN is a secret, so — exactly like the admin
 * connection string above — it is NEVER an argv flag (`argv` is world-readable in `ps` and lands in
 * shell history): it comes from this variable or an echo-off prompt, and from nowhere else. `parse`
 * declares no `--admin-pin`, so `strict: true` turns one into a parse error rather than a silent
 * acceptance, the same defence `ADMIN_URI_VARIABLE` relies on. */
const ADMIN_PIN_VARIABLE = "WAITRON_ADMIN_PIN";

/** The env var the admin dashboard PASSWORD is read from. Like the PIN and the admin connection
 * string, a login secret never comes from argv (`argv` is world-readable in `ps` and lands in shell
 * history): it comes from this variable or an echo-off prompt, and from nowhere else. `parse` declares
 * no `--password`/`--admin-password`, so `strict: true` turns either into a parse error. */
const ADMIN_PASSWORD_VARIABLE = "WAITRON_ADMIN_PASSWORD";

const USAGE = [
  "usage: waitron-provision <command> [options]",
  "",
  "  keyring                                            generate the credential key ring",
  "  venue    [--database <name>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]",
  "           [--location-name <name>] [--territory <t>] [--locale <l>]...",
  "           [--operation-description <text>] [--address-line1 <text>] [--address-line2 <text>]",
  "           [--postal-code <code>] [--city <name>] [--province <name>] [--time-zone <tz>]",
  "           [--day-cutover <HH:MM>] [--till-name <name>] [--series-code <code>]",
  "           [--rectificative-code <code>] [--admin-name <name>] [--admin-email <email>]",
  "           [--admin-first-names <names>] [--admin-last-names <names>] [--yes]",
  "",
  "Every option is prompted for when omitted, except --admin-first-names and",
  "--admin-last-names: the admin's real name is left unset when neither is given, so a",
  "script driving this command is never stopped by a question it did not expect.",
  "",
  "The admin connection string is NOT an option. It carries a password, and argv is",
  "world-readable in `ps` and lands in shell history, so it is read from",
  "WAITRON_ADMIN_DATABASE_URL or from an echo-off prompt — and from nowhere else.",
  "It must be a URL: postgres://user:pass@host:port/database. A libpq keyword/value",
  "string or a bare socket path is refused — see README.md, 'Secrets'.",
  "",
  "The admin PIN and dashboard password (venue) are NOT options either, for the same reason: a",
  "login secret must not reach argv, so each is read from WAITRON_ADMIN_PIN /",
  "WAITRON_ADMIN_PASSWORD or an echo-off prompt — and from nowhere else. The admin display name",
  "(--admin-name) is not a secret and stays a flag.",
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
    case "venue":
      return venue(rest, deps);
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

/**
 * Stands a venue up: a tenant, a location, a till, a node, its two invoice series, and every
 * injected module's own seed for that node (the fiscal seed is what registers it as a SIF) — the
 * whole slice `planVenue`/`applyVenue` compose.
 *
 * The ORDER mirrors `instance`: everything that can be resolved and validated WITHOUT a database is
 * done first — the fiscal regime's own venue-field seat, which refuses a legal name or operation
 * description carrying a character XML forbids, an operation description over 500 characters, and
 * either series code outside AEAT's character set or longer than the 38-character base
 * (`setup.request_invalid`, naming the offending field), and then the pure `planVenue`, which
 * refuses an unimplemented territory, a bad locale count and duplicate series codes — so a
 * malformed request costs the operator neither a pasted admin credential nor an opened connection
 * (venue-plan.ts's "no admin connection is spent on a malformed request"). Only then is the admin
 * URI asked for and the target opened.
 *
 * Unlike `instance`, the connection is to the TARGET database as the OWNER-admin, not to the cluster
 * admin: `applyVenue` inserts as the role that owns the tables, so there is no
 * second role and no grant to widen. The whole apply is one transaction (`applyVenue`), which a
 * partial venue must never be.
 */
async function venue(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      database: { type: "string" },
      country: { type: "string" },
      "tax-id": { type: "string" },
      "legal-name": { type: "string" },
      "location-name": { type: "string" },
      territory: { type: "string" },
      locale: { type: "string", multiple: true },
      "operation-description": { type: "string" },
      "address-line1": { type: "string" },
      "address-line2": { type: "string" },
      "postal-code": { type: "string" },
      city: { type: "string" },
      province: { type: "string" },
      "time-zone": { type: "string" },
      "day-cutover": { type: "string" },
      "till-name": { type: "string" },
      "series-code": { type: "string" },
      "rectificative-code": { type: "string" },
      "admin-name": { type: "string" },
      "admin-first-names": { type: "string" },
      "admin-last-names": { type: "string" },
      "admin-email": { type: "string" },
      yes: { type: "boolean" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  try {
    // Resolved and VALIDATED before the admin connection string is even asked for — a mistyped
    // country or database name should not cost the operator a paste of a privileged credential. Only
    // the database name uses `assertIdentifier`; the rest are free text (a legal name has spaces, a
    // territory has hyphens) and are checked only where a check has meaning — the country's shape
    // here, the deeper request shape in `planVenue` below.
    const database = await resolveOption(values.database, "database name: ", deps);
    assertIdentifier("database", database);
    const country = assertCountry(
      await resolveOption(values.country, "country (ISO-3166 alpha-2, e.g. ES): ", deps),
    );
    const taxId = await resolveOption(values["tax-id"], "tax id (NIF): ", deps);
    const legalName = await resolveOption(values["legal-name"], "legal name: ", deps);
    const locationName = await resolveOption(values["location-name"], "location name: ", deps);
    const fiscalTerritory = await resolveOption(
      values.territory,
      "fiscal territory (e.g. ES-common): ",
      deps,
    );
    const invoiceLocales = await resolveLocales(values.locale, deps);
    const operationDescription = await resolveOption(
      values["operation-description"],
      "operation description: ",
      deps,
    );
    const addressLine1 = await resolveOption(values["address-line1"], "address line 1: ", deps);
    // Optional: an empty answer means "no second line", NOT "ask again" — so `resolveOption`'s
    // prompt-once is right and the empty string becomes `null` for the schema's nullable column.
    const addressLine2Raw = await resolveOption(
      values["address-line2"],
      "address line 2 (blank if none): ",
      deps,
    );
    const postalCode = await resolveOption(values["postal-code"], "postal code: ", deps);
    const city = await resolveOption(values.city, "city: ", deps);
    const province = await resolveOption(values.province, "province: ", deps);
    const timeZone = await resolveOption(
      values["time-zone"],
      "time zone (e.g. Europe/Madrid): ",
      deps,
    );
    const dayCutover = await resolveOption(values["day-cutover"], "day cutover (HH:MM): ", deps);
    const tillName = await resolveOption(values["till-name"], "till name: ", deps);
    const seriesCode = await resolveOption(values["series-code"], "series code: ", deps);
    const rectificativeSeriesCode = await resolveOption(
      values["rectificative-code"],
      "rectificative series code: ",
      deps,
    );
    // The admin's DISPLAY NAME is not a secret, so it is a normal flag-or-prompt field.
    const adminName = await resolveOption(values["admin-name"], "admin name: ", deps);
    // The admin's REAL name: read from a flag but NEVER prompted for, unlike every other venue
    // option, so a script that already drives this command non-interactively does not gain a question
    // it cannot answer. The setup wizard always supplies both; a CLI-seeded admin can fill them in
    // from the dashboard later. Trimmed, and a blank read as "not given", exactly as every sibling
    // option is — see `resolveWithoutPrompt` for why that cannot be `resolveOption` itself.
    const adminFirstNames = resolveWithoutPrompt(values["admin-first-names"]);
    const adminLastNames = resolveWithoutPrompt(values["admin-last-names"]);
    const adminEmail = normalizeAndValidateEmail(
      await resolveOption(values["admin-email"], "admin email: ", deps),
    );
    // The PIN and dashboard password are SECRETS, resolved exactly as the admin connection string is:
    // from WAITRON_ADMIN_PIN / WAITRON_ADMIN_PASSWORD or an echo-OFF prompt, NEVER from argv
    // (`readAdminPin` / `readAdminPassword`). Each is then checked against the same floor the identity
    // package enforces, through the SAME `assertPinLength` / `assertPasswordLength` — this seeds the
    // MOST-privileged account (`role='admin'`) and `hashPin` / `hashPassword` themselves validate
    // nothing, so without these an operator could seed an admin with an empty PIN or a trivially short
    // password. `pin.too_short` / `password.too_short` carry only `{ min }`, never the secret.
    const adminPin = await readAdminPin(deps);
    assertPinLength(adminPin);
    const adminPassword = await readAdminPassword(deps);
    assertPasswordLength(adminPassword);
    // Hashed HERE, at the CLI boundary, so only `pinHash`/`passwordHash` ever flow through
    // `VenueRequest`/`VenueAction`/`applyVenue`: neither plaintext secret enters the plan, is ever an
    // error param, or is ever printed (§ SECRET DISCIPLINE).
    const request: VenueRequest = {
      country,
      taxId,
      legalName,
      location: {
        name: locationName,
        fiscalTerritory,
        invoiceLocales,
        operationDescription,
        addressLine1,
        addressLine2: addressLine2Raw === "" ? null : addressLine2Raw,
        postalCode,
        city,
        province,
        timeZone,
        dayCutover,
      },
      tillName,
      seriesCode,
      rectificativeSeriesCode,
      admin: {
        displayName: adminName,
        firstNames: adminFirstNames,
        lastNames: adminLastNames,
        // No browser, so no `Accept-Language` to read a UI-language preference from, and asking would
        // be one more prompt for something the admin can change from their own profile screen. Null
        // leaves them on the venue default until they do.
        locale: null,
        pinHash: hashPin(adminPin),
        passwordHash: hashPassword(adminPassword),
        email: adminEmail,
      },
    };
    // Resolve the fiscal slot from the territory (authoritative, design §4) through the shared
    // `venueFiscalSelection` seam: it enables the module whose contribution id is the territory's
    // `filing`, disables every other slot member, and throws `fiscal.regime_not_implemented` for an
    // unimplemented territory — the same code `planVenue` raises below (and before any admin
    // connection). The CLI has no operator `modules.json`, so the base is empty (the seam's default).
    // `modules` is the ENABLED subset, so a no-regime (`GB-…`) venue drops `fiscal-verifactu` and its
    // SIF seed is never planned.
    const selection = venueFiscalSelection(deps.modules, request.location.fiscalTerritory);
    const fiscalConfig = selection.config;
    // The regime's own rules on the four fields the operator just typed, reached through the same
    // contract seat the setup wizard uses (`FiscalContribution.venueFields`) — this file names no
    // regime package. Run HERE, before `resolveAdminUri` asks for an admin credential and long
    // before `applyVenue` mints the tenant, node, SIF and hash chain, so a refusal costs no
    // connection and leaves nothing behind (CLAUDE.md §5). Without it this command could provision a
    // venue whose series code the tax agency rejects, and every sale it ever took would be refused
    // at the chain seam with no way back — `create-series` is ON CONFLICT DO NOTHING, so re-running
    // reuses the tenant. A regime that files nothing offers no seat; the optional call is how its
    // venues skip the check.
    selection.contribution?.venueFields?.validate({
      legalName: request.legalName,
      seriesCode: request.seriesCode,
      rectificativeSeriesCode: request.rectificativeSeriesCode,
      operationDescription: request.location.operationDescription,
    });
    const modules = enabledModules(deps.modules, fiscalConfig);

    // Pure, and the last thing that can refuse the request without touching a database: an
    // unimplemented territory (`fiscal.regime_not_implemented`), a bad locale count, equal series
    // codes. Kept BEFORE `resolveAdminUri` on purpose — see this function's header.
    const actions = planVenue(request, modules);

    const adminUri = await resolveAdminUri(deps);

    return await withVenueState(adminUri, database, deps, async (target) => {
      let environment: DeploymentEnvironment | null;
      try {
        // The SQLSTATE-bearing STATE READ: reading the deployment stamp as an admin that may lack
        // privilege on the target's tables fails 42501, exactly as `instance`/`status` read theirs.
        // Classified via `asUnreadable`, like the connect in `withVenueState`; the venue APPLY below
        // keeps its own mapping (`venue_conflict`/propagate), so an apply fault is never dressed as a
        // read one. Only this stamp read is wrapped, NOT `applyVenue`.
        environment = await deps.readEnvironment(target);
      } catch (error) {
        throw asUnreadable(error, database);
      }
      if (environment === null) {
        // A venue cannot be filed against a database with no environment stamp — stamping is
        // `instance`'s job, and one database per environment is a fiscal invariant. Refused, not
        // stamped here.
        throw new AppError("provisioning.database_unstamped", { database });
      }

      // One tenant per database is the post-RLS isolation boundary (§5), enforced here, at the
      // setup-api provision handler (`provisionVenue`) and at the mirror adopt orchestrator
      // (`adoptFromPrimary`) — every tenant-creation path — through the shared `assertNoForeignTenant`
      // guard: no query filters rows by tenant, so a foreign
      // `(country, tax_id)` in this database would expose one business's rows to the other. The SAME
      // identity proceeds to `applyVenue`, which reuses an exact same-venue plan and refuses different
      // venue details — and an empty database proceeds as the first tenant. The identity applied is the
      // ensure-tenant action's, canonicalized by planVenue.
      const ensure = actions.find((a) => a.kind === "ensure-tenant");
      if (ensure !== undefined && ensure.kind === "ensure-tenant") {
        assertNoForeignTenant(
          await deps.readTenants(target),
          { country: ensure.country, taxId: ensure.taxId },
          database,
        );
      }

      deps.io.stdout(`Plan for a venue in ${database} (${environment}):`);
      // Which cluster, so the operator confirming this sees the mistake the summary otherwise hides.
      // Never the password.
      deps.io.stdout(`Cluster: ${describeAdmin(adminUri)}`);
      deps.io.stdout("");
      for (const action of actions) deps.io.stdout(`  ${describeVenueAction(action)}`);
      deps.io.stdout("");

      if (values.yes !== true) {
        const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          deps.io.stderr("Nothing was applied.");
          return 1;
        }
      }

      try {
        const result = await deps.applyVenue(actions, { db: target, modules });
        // Persist the resolved fiscal slot so a box booting against this database reads a set that
        // resolves (design §4). After the apply commits; a no-op when the writer is not wired.
        if (deps.writeModuleConfig !== undefined) await deps.writeModuleConfig(fiscalConfig);
        deps.io.stdout("");
        deps.io.stdout(`node:     ${result.nodeId}`);
        for (const s of result.seeded) deps.io.stdout(`seeded:   ${s.module} — ${s.report}`);
        return 0;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent venue run created a conflicting row between this run's plan and its apply.
          // `applyVenue` guards the natural keys it knows with `ON CONFLICT DO NOTHING`; this is the
          // residual race, named rather than left to reach the operator as `unexpected failure`.
          throw new AppError("provisioning.venue_conflict", { database });
        }
        throw error;
      }
    });
  } catch (error) {
    return reportFailure(error, deps);
  }
}

/**
 * Opens the OWNER-admin connection to the TARGET database, runs `body`, and closes it in a
 * `finally`. The venue apply owns the tables and runs as itself, so there is one connection to
 * manage — no cluster-admin handle, no second read, no target that may not exist yet.
 *
 * The CONNECT is classified: a SQLSTATE-bearing failure — the target database absent, or the admin
 * URI lacking privilege on it — becomes `provisioning.state_unreadable` naming the database (via
 * `asUnreadable`), while a failure with NO SQLSTATE (a broken socket, a bug) is rethrown untouched.
 * The other SQLSTATE-bearing STATE READ, the deployment-stamp read (`deps.readEnvironment`), is
 * wrapped the same way in `venue()`'s body, so connect and state read carry the same contract.
 *
 * What is deliberately NOT classified is the venue APPLY: `applyVenue`'s own failures keep their
 * mapping in `venue()` (a unique violation → `provisioning.venue_conflict`, anything else rethrown).
 * A genuine insert error is not a fact about whether the database was readable, and labelling it
 * `state_unreadable` would be wrong — the §1 defect class this repository guards against.
 */
async function withVenueState(
  adminUri: string,
  database: string,
  deps: CliDeps,
  body: (target: Database) => Promise<number>,
): Promise<number> {
  let target: Database;
  try {
    // As the OWNER-admin, via the role option: `applyVenue` inserts as the table owner
    // (`MIGRATOR_ROLE`), and a plain admin connection cannot CREATE TABLE in a migrator-owned
    // database. There is no prior admin probe, so a refused SET ROLE surfaces here as
    // `state_unreadable` along with every other SQLSTATE the connect can carry.
    target = await deps.connect(targetUri(adminUri, database));
  } catch (error) {
    // A SQLSTATE-bearing connect failure is the database's verdict (absent, or no privilege on it);
    // `asUnreadable` maps it to `provisioning.state_unreadable` and returns a broken socket
    // untouched.
    throw asUnreadable(error, database);
  }
  try {
    return await body(target);
  } finally {
    // A pool; leaking it keeps the process alive after `main` returns.
    await target.close();
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

/**
 * The role `venue` opens its session as. It owns the target database's tables, so `applyVenue`
 * inserts as their owner.
 *
 * Named here rather than imported: the path that CREATED this role — `waitron-provision instance`
 * — was deleted with the rest of the PostgreSQL deployment model, so nothing in this repository
 * creates it any more. This command requires a database somebody else set up that way.
 */
const MIGRATOR_ROLE = "waitron_migrator";

/** The target database, opened AS the migrator via the session role option, so the session can
 * read and write a migrator-owned database. */
function targetUri(adminUri: string, database: string): string {
  return withRole(withDatabase(adminUri, database), MIGRATOR_ROLE);
}

/**
 * A flag's value, or the answer to a question. An empty OR whitespace-only flag (`--database=`,
 * `--database='  '`) counts as absent and falls through to the prompt.
 *
 * The flag value is trimmed, so flag and prompt behave IDENTICALLY — the prompt already trims
 * (`.trim()` below). This keeps every field's flag and prompt paths in step (a stored `legalName`,
 * `city`, etc. carries no leading/trailing spaces either way). For the fiscal identity specifically,
 * the casing / leading-or-trailing-whitespace footgun is closed further in — `planVenue`
 * canonicalizes `country`/`taxId` (`.trim().toUpperCase()`) — so a non-interactive
 * `--tax-id " B12345678 "` compares equal to the trimmed form an interactive operator would produce
 * when `assertNoForeignTenant` checks it against the stored taxpayer row; this trim is
 * belt-and-suspenders for it. (Only surrounding whitespace and letter case are collapsed; INTERNAL
 * whitespace is left intact, so `--tax-id "B123 45678"` stays a distinct identity.)
 */
async function resolveOption(
  value: string | undefined,
  question: string,
  deps: CliDeps,
): Promise<string> {
  const trimmed = value?.trim();
  if (trimmed !== undefined && trimmed !== "") return trimmed;
  return (await deps.io.prompt(question)).trim();
}

/**
 * `resolveOption`'s two lines of flag handling — the same trim, and the same reading of a blank as
 * "not given" — for an option with NO prompt behind it, which is why it cannot simply call
 * `resolveOption`: that asks a question when the value is blank, and an option whose whole point is
 * that it never interrupts a script cannot do that. A blank becomes `null` rather than an empty
 * string because `persons_first_names_ck` / `persons_last_names_ck` refuse an empty string
 * (packages/identity/src/schema/persons.ts), so `--admin-last-names ""` — how a script says "no last
 * name" — would otherwise surface as a SQLSTATE from inside `applyVenue` rather than as a plan that
 * leaves the name unset.
 */
function resolveWithoutPrompt(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * The invoice locales: every `--locale` supplied (empties dropped), or, when none was, one prompt
 * per locale until a blank answer ends the list. `planVenue` enforces the one-or-two cardinality the
 * schema requires, so an empty list here is not special-cased — it reaches `planVenue` and is
 * refused there with `provisioning.invalid_locales`, in the same place a `--locale=x --locale=y
 * --locale=z` over-count is.
 */
async function resolveLocales(supplied: string[] | undefined, deps: CliDeps): Promise<string[]> {
  // Each flag locale is trimmed and empties dropped, matching the prompted path below (which
  // `.trim()`s every answer) — so `--locale " es-ES "` reaches the plan as `es-ES`.
  const fromFlags = (supplied ?? [])
    .map((locale) => locale.trim())
    .filter((locale) => locale !== "");
  if (fromFlags.length > 0) return fromFlags;
  const locales: string[] = [];
  for (;;) {
    const answer = (
      await deps.io.prompt(
        locales.length === 0
          ? "invoice locale (e.g. es-ES): "
          : "another invoice locale (blank to finish): ",
      )
    ).trim();
    if (answer === "") break;
    locales.push(answer);
  }
  return locales;
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
 * error — run against this repo's `pg@8.23.0`, `new Client({ connectionString: "" })` resolved to
 * `{host:"localhost",port:5432,user:"<OS user>",database:"<OS user>"}`, and `pg-pool@3.14.0` builds
 * its clients with `new this.Client(this.options)` (`index.js:241`) from the same options — so
 * `instance` would have created, migrated and STAMPED a database on whatever cluster answers there.
 * See `errors.ts` for why that is the unacceptable failure mode rather than merely a confusing one.
 *
 * **A string that is not a URL is refused too**, and this is the ONE place that decides it, for
 * both commands and both sources. `pg` accepts forms `new URL` rejects — measured, not assumed:
 * inside a `postgres:18-alpine` container (PostgreSQL 18.4) with `pg@8.22.0`, the
 * connection string `/var/run/postgresql` parsed to `{host:"/var/run/postgresql",port:5432}`,
 * `connect()` succeeded and `select inet_server_addr() is null` returned `t`, while
 * `new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the same process. The parse
 * half still holds on the installed `pg@8.23.0` — same `{host,port}`, same `new URL` throw — but
 * the container half, the socket connect, has not been re-run since. Every
 * consumer of this string after this function re-points it with `new URL` — `targetUri`'s
 * `withDatabase` and `describeAdmin` for the plan summary — so a form only `pg` accepts is a form
 * this tool cannot carry. `errors.ts` records why the fix is a refusal rather than a conninfo parser.
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
 * The admin PIN, from WAITRON_ADMIN_PIN or an echo-off prompt — and from nowhere else, for the same
 * reason `readAdminUri` refuses a flag: a PIN is a login secret, `argv` is world-readable in `ps` and
 * lands in shell history. Structurally mirrors `readAdminUri` (env via the injected `deps.env`, else
 * `deps.io.promptSecret`) so it stays testable with no tty.
 *
 * Deliberately NOT trimmed, unlike `readAdminUri`: a PIN is opaque and every character it carries is
 * significant, and the caller checks its length against `MIN_PIN_LENGTH` exactly as `createPerson`
 * does — so an empty answer (Ctrl+D, exhausted stdin) is rejected there as `pin.too_short` rather
 * than here, and no separate "missing" code is needed.
 */
async function readAdminPin(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_PIN_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return deps.io.promptSecret("admin PIN (not shown): ");
}

/**
 * The admin dashboard PASSWORD, from WAITRON_ADMIN_PASSWORD or an echo-off prompt — and from nowhere
 * else, for the same reason `readAdminPin` refuses a flag: a password is a login secret. Structurally
 * mirrors `readAdminPin`. Deliberately NOT trimmed (every character is significant), and the caller
 * checks its length against `MIN_PASSWORD_LENGTH` via `assertPasswordLength` — so an empty answer
 * (Ctrl+D, exhausted stdin) is rejected there as `password.too_short`, and no separate "missing" code
 * is needed.
 */
async function readAdminPassword(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_PASSWORD_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return deps.io.promptSecret("admin password (not shown): ");
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
 * is now refused up front, because `withDatabase` needed the same parse and threw a bare
 * `TypeError` at it only once a connection had already been opened.
 */
function describeAdmin(adminUri: string): string {
  const url = new URL(adminUri);
  return url.username === "" ? url.host : `${url.username}@${url.host}`;
}

/** The shape of an ISO-3166-1 alpha-2 country code — two ASCII letters. Not a membership check
 * (there is no list here): it rejects the typo an operator makes, `ESP` or `E1`, before it is stored
 * on the taxpayer row. The regex accepts either case; the value is UPPER-CASED before it is
 * returned. This upper-casing is BELT-AND-SUSPENDERS rather than the sole defence: `planVenue`
 * canonicalizes BOTH `country` and `taxId` (`.trim().toUpperCase()`) for BOTH paths — so the wizard,
 * which never calls `assertCountry`, is covered, and a taxId that differs only in letter case or in
 * leading/trailing whitespace is handled too. The footgun this all defends: `assertNoForeignTenant`
 * (`tenant-guard.ts`) compares a fresh plan's `(country, taxId)` byte-for-byte against the stored
 * taxpayer row, so `es` against a stored `ES` (or a taxId differing only in case or surrounding
 * whitespace) would read as a DIFFERENT business and refuse a same-venue retry with
 * `provisioning.foreign_tenant` (§5). `.trim().toUpperCase()` collapses exactly case and surrounding
 * whitespace; INTERNAL whitespace is left intact (a taxId's inner content is not ours to alter), so
 * `"B123 45678"` stays a distinct identity. Canonicalizing collapses the case/space variants to the
 * one taxpayer (ISO-3166 alpha-2 is upper-case by convention); there is no data to preserve either
 * way (pre-production, no backfill). Keeping the shape-validation + upper-casing here is harmless and
 * still refuses a mistyped code early. `value` is echoed: it is operator-typed configuration, never a
 * secret. */
const COUNTRY = /^[A-Za-z]{2}$/;
function assertCountry(value: string): string {
  if (!COUNTRY.test(value)) {
    throw new AppError("provisioning.invalid_country", { value });
  }
  return value.toUpperCase();
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
