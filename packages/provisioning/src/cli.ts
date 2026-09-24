import { parseArgs } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import {
  deploymentTableExists,
  isUniqueViolation,
  readDeploymentEnvironment,
  stampDeployment,
  type Database,
  type DeploymentEnvironment,
  type VenueDatabase,
} from "@waitron/db";
import {
  assertPasswordLength,
  assertPinLength,
  hashPassword,
  hashPin,
  normalizeAndValidateEmail,
} from "@waitron/identity";
import { enabledModules, type ModuleConfig, type WaitronModule } from "@waitron/module";
import { resolveEnvironment } from "./environment.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import type { ProvisioningIo } from "./io.js";
import { runKeyring } from "./keyring-command.js";
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
  /** Opens this node's venue directory — the two SQLite files it stores everything in. The caller
   * closes the store, which owns both. */
  openVenue(directory: string): Promise<VenueDatabase>;
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
  /** Reads a target database's deployment stamp. Injected so the stamping paths are reachable
   * without a live directory; the real one (`@waitron/db`) needs the target connection. */
  readEnvironment: typeof readDeploymentEnvironment;
  /** Whether the target's `deployment` table exists at all — what tells a MIGRATED directory
   * carrying no stamp (which `venue` stamps) from one nothing has migrated (which it refuses),
   * since `readEnvironment` answers `null` for both. Injected for the same reason. */
  readDeploymentTable: typeof deploymentTableExists;
  /** Writes the target's deployment stamp. The SAME primitive the browser setup wizard's handler
   * calls in the same position (`provisionVenue`, `apps/server/src/provision.ts`), so the two
   * stamping paths agree by construction rather than by two people typing the same rule: it is
   * idempotent for the value already there, refuses a DIFFERENT one with
   * `deployment.already_stamped`, and writes only when there is none. Injected for the same reason
   * as the reads. */
  stampEnvironment: typeof stampDeployment;
  /** Reads the fiscal identity of every tenant already in the target database. Injected like
   * `readEnvironment` so the foreign-tenant refusal is reachable without a container; the real one
   * (`readTenantIdentities`, `./tenant-guard.js`) needs the target connection. */
  readTenants: typeof readTenantIdentities;
}

/** The environment variable `apps/server` reads the venue directory from (`config.ts`'s `venueDir`).
 * `venue` reads the same one, so a box's own setting is what stands its venue up: an operator asked
 * to type the path instead could provision a directory the server never opens. Named once so the
 * fallback and the error that reports nothing supplied it cannot drift apart. */
const VENUE_DIR_VARIABLE = "WAITRON_VENUE_DIR";

/** The env var the admin PIN is read from. A login PIN is a secret, so it is NEVER an argv flag
 * (`argv` is world-readable in `ps` and lands in shell history): it comes from this variable or an
 * echo-off prompt, and from nowhere else. `parse`
 * declares no `--admin-pin`, so `strict: true` turns one into a parse error rather than a silent
 * acceptance. */
const ADMIN_PIN_VARIABLE = "WAITRON_ADMIN_PIN";

/** The env var the admin dashboard PASSWORD is read from. Like the PIN, a login secret never comes
 * from argv (`argv` is world-readable in `ps` and lands in shell history): it comes from this
 * variable or an echo-off prompt, and from nowhere else. `parse` declares
 * no `--password`/`--admin-password`, so `strict: true` turns either into a parse error. */
const ADMIN_PASSWORD_VARIABLE = "WAITRON_ADMIN_PASSWORD";

const USAGE = [
  "usage: waitron-provision <command> [options]",
  "",
  "  keyring                                            generate the credential key ring",
  "  venue    [--venue-dir <path>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]",
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
  "--venue-dir is the directory holding this node's two SQLite files. Omitted, it is",
  "read from WAITRON_VENUE_DIR — the same variable the server reads — and only then",
  "asked for. There is no connection string and no database name: one directory is the",
  "database.",
  "",
  "A directory that carries no environment stamp is STAMPED from WAITRON_ENV — unset",
  "means preproduction, and production has to be typed out in full. A directory already",
  "stamped for the OTHER environment is refused, never re-stamped. Nothing here migrates:",
  "a directory nothing has migrated is refused too.",
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
 * now held a connection string on the strength of that. A guarantee that holds for every command
 * but one is not the guarantee the documentation makes.
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
 * The ORDER: everything that can be resolved and validated WITHOUT a database is done first — the
 * fiscal regime's own venue-field seat, which refuses a legal name or operation description
 * carrying a character XML forbids, an operation description over 500 characters, and either series
 * code outside AEAT's character set or longer than the 38-character base (`setup.request_invalid`,
 * naming the offending field), and then the pure `planVenue`, which refuses an unimplemented
 * territory, a bad locale count and duplicate series codes — so a malformed request opens nothing
 * (venue-plan.ts's "no admin connection is spent on a malformed request", which is now "no venue
 * directory is opened"). Only then is the directory opened.
 *
 * It opens the venue directory and writes through its venue file; there is no cluster, no second
 * role and no grant to widen. The whole apply is one transaction (`applyVenue`), which a partial
 * venue must never be.
 */
async function venue(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      "venue-dir": { type: "string" },
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
    // Resolved and VALIDATED before anything is opened — a mistyped country or a directory nothing
    // supplied should cost no open at all. The directory is checked only for being SUPPLIED: a path
    // has no grammar this tool can hold it to, and the engine's own refusal to open it is the check
    // (`withVenueState`). The rest are free text (a legal name has spaces, a territory has hyphens)
    // and are checked only where a check has meaning — the country's shape here, the deeper request
    // shape in `planVenue` below.
    const venueDir = await resolveVenueDir(values["venue-dir"], deps);
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
    // The PIN and dashboard password are SECRETS, so each is read from WAITRON_ADMIN_PIN /
    // WAITRON_ADMIN_PASSWORD or an echo-OFF prompt, NEVER from argv
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
    // regime package. Run HERE, long before `applyVenue` mints the tenant, node, SIF and hash
    // chain, so a refusal opens nothing and leaves nothing behind (CLAUDE.md §5). Without it this command could provision a
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
    // codes. Kept BEFORE the venue directory is opened on purpose — see this function's header.
    const actions = planVenue(request, modules);
    // The environment this run would stamp an UNSTAMPED directory for, derived from `WAITRON_ENV`
    // (`environment.ts`, CLAUDE.md §5: unset means preproduction, production is typed out in full).
    // Pure, so it is resolved here with the rest of the validation: a misspelled variable costs no
    // open and writes nothing.
    const requested = resolveEnvironment(deps.env);

    return await withVenueState(venueDir, deps, async (target) => {
      let environment: DeploymentEnvironment | null;
      let migrated: boolean;
      try {
        // The STATE READS: a venue file that opened and then could not be read — a corrupt or
        // truncated one. Classified via `asUnreadable`, like the open in `withVenueState`; the venue
        // APPLY below keeps its own mapping (`venue_conflict`/propagate), so an apply fault is never
        // dressed as a read one. Only these reads are wrapped, NOT `applyVenue` and NOT the stamp.
        environment = await deps.readEnvironment(target);
        // Asked only when there is no stamp, because a stamp is itself proof the table is there.
        migrated = environment !== null || (await deps.readDeploymentTable(target));
      } catch (error) {
        throw asUnreadable(error, venueDir);
      }
      if (!migrated) {
        // No stamp AND no `deployment` table: nothing has migrated this directory. This is the
        // commonest wrong-path mistake, because opening a virgin directory SUCCEEDS — the store
        // creates it. Refused here rather than left to the first query that meets a table which is
        // not there (the taxpayer read below, then the stamp's own insert): with this block deleted
        // and the bundle rebuilt, that run printed `unexpected failure (Error)`.
        throw new AppError("provisioning.database_unmigrated", { database: venueDir });
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
          venueDir,
        );
      }

      // The DIRECTORY, so the operator confirming this sees the mistake the summary otherwise hides:
      // a venue stood up somewhere the server never opens. The environment is the one ALREADY
      // stamped when there is one, so the header never announces a value the stamp below is about
      // to refuse.
      deps.io.stdout(`Plan for a venue in ${venueDir} (${environment ?? requested}):`);
      deps.io.stdout("");
      if (environment === null) {
        // An unstamped directory is about to be stamped, and a stamp cannot be taken back (§5), so
        // the irreversible write is in the list the operator is confirming rather than implied by
        // the header.
        deps.io.stdout(`  stamp this venue directory ${requested} — permanent, from WAITRON_ENV`);
      }
      for (const action of actions) deps.io.stdout(`  ${describeVenueAction(action)}`);
      deps.io.stdout("");

      if (values.yes !== true) {
        const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          deps.io.stderr("Nothing was applied.");
          return 1;
        }
      }

      // The stamp, in the position the browser setup wizard's handler puts it — the last thing
      // before the mint (`provisionVenue` step 3, `apps/server/src/provision.ts`) — and through the
      // same primitive, so the two paths that stamp cannot disagree. It writes ONLY when there is
      // no stamp; a directory already stamped for this environment passes through untouched, and one
      // stamped for the OTHER environment is refused here with `deployment.already_stamped`, which
      // propagates exactly as it does out of the wizard. That refusal is the fiscal invariant: a
      // pre-production database promoted to production leaves a permanent hole in the invoice series
      // (CLAUDE.md §5), and no re-stamp can take it back.
      //
      // AFTER the confirmation prompt, unlike the wizard, which has none. Stamping is permanent, so
      // an operator who answers anything but `y` must leave the directory exactly as it was found.
      await deps.stampEnvironment(target, requested);

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
          throw new AppError("provisioning.venue_conflict", { database: venueDir });
        }
        throw error;
      }
    });
  } catch (error) {
    return reportFailure(error, deps);
  }
}

/**
 * Opens the venue DIRECTORY, runs `body` against its venue file, and closes the store in a
 * `finally`. The store owns both files, so closing it closes both — there is nothing else to
 * manage: no cluster handle, no connection string, no role to assume.
 *
 * `body` is handed the VENUE handle. A venue plan writes the taxpayer, the location, the till, the
 * node, its series and each module's seed, and every migration set is applied to the venue file
 * (`packages/migrations/src/apply.ts`), none to the node file. The same handle `apps/server`'s
 * boot uses (`const db = store.venue`).
 *
 * The OPEN is classified: a failure carrying an error `code` — the engine's or the filesystem's —
 * becomes `provisioning.state_unreadable` naming the directory (via `asUnreadable`), while a failure
 * with no code (a bug) is rethrown untouched.
 * The other classified reads, the deployment-stamp read (`deps.readEnvironment`) and the
 * `deployment`-table probe beside it (`deps.readDeploymentTable`), are wrapped the same way in
 * `venue()`'s body, so open and state reads carry the same contract. The STAMP is not: a refused
 * stamp is `deployment.already_stamped`, a verdict about environments rather than about whether the
 * directory could be read.
 *
 * What is deliberately NOT classified is the venue APPLY: `applyVenue`'s own failures keep their
 * mapping in `venue()` (a unique violation → `provisioning.venue_conflict`, anything else rethrown).
 * A genuine insert error is not a fact about whether the directory was readable, and labelling it
 * `state_unreadable` would be wrong — the §1 defect class this repository guards against.
 */
async function withVenueState(
  venueDir: string,
  deps: CliDeps,
  body: (target: Database) => Promise<number>,
): Promise<number> {
  let store: VenueDatabase;
  try {
    store = await deps.openVenue(venueDir);
  } catch (error) {
    throw asUnreadable(error, venueDir);
  }
  try {
    return await body(store.venue);
  } finally {
    // Two open SQLite files; leaking them keeps the process alive after `main` returns.
    await store.close();
  }
}

/**
 * The structured form of a failure to open or read a venue directory — or the original error, when
 * it carries no code and is therefore not the engine's or the filesystem's verdict on anything.
 *
 * `reason` is the error's own `code`, never its message: a driver message can quote the failing
 * statement, and an `Error` here has already reached a path where nothing may be echoed unchecked.
 * The two real shapes, measured on Node v26.7.0 against `openVenueDatabase` — a directory path
 * running through a regular file gives `code: "ENOTDIR"`, and a directory whose `venue.db` is not a
 * database gives `code: "ERR_SQLITE_ERROR"` (errcode 26, "file is not a database"). A VIRGIN
 * directory is not a failure at all: it is created and opened, so the commonest wrong-path mistake
 * reaches `provisioning.database_unmigrated` rather than this.
 *
 * Returns the error to throw rather than throwing it, so each call site reads as `throw
 * asUnreadable(...)` and TypeScript still sees the path as terminating.
 */
function asUnreadable(error: unknown, venueDir: string): unknown {
  const reason = (error as { code?: unknown } | null)?.code;
  if (typeof reason !== "string") return error;
  return new AppError("provisioning.state_unreadable", { database: venueDir, reason });
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
 * The venue directory: the `--venue-dir` flag, then `WAITRON_VENUE_DIR`, then a prompt.
 *
 * The variable sits BETWEEN the flag and the prompt on purpose. It is the one `apps/server` reads
 * for the same directory (`config.ts`'s `venueDir`), so on a box that has it set the tool and the
 * server agree by construction; an operator asked to type the path could type a different one and
 * stand a venue up in a directory the server never opens. A flag still wins, because an operator
 * naming a directory explicitly means that one.
 *
 * **An empty answer is refused, not returned.** Every path `openVenueStore` builds is
 * `join(directory, …)`, and `join("", "venue.db")` is the RELATIVE `venue.db` — so an empty value
 * stands a venue up wherever the process happens to be running, silently, and a hash chain and a
 * series number cannot be taken back (CLAUDE.md §5). `bin.ts`'s `ask` returns `""` deliberately for
 * an exhausted stdin or a Ctrl+D, which is exactly the non-interactive shape `README.md` documents,
 * so the prompt answering nothing is a real case rather than a theoretical one. The same guard
 * `apps/server`'s `config.ts` carries for the same variable, for the same reason.
 *
 * Not a secret, and not an identifier either: a directory path has no grammar this tool can hold it
 * to (`assertIdentifier`'s lower-case-and-underscores rule described a database NAME, which had to
 * survive a connection string and a DDL statement). Whether the path is usable is the engine's
 * answer, and `withVenueState` classifies it.
 */
async function resolveVenueDir(flag: string | undefined, deps: CliDeps): Promise<string> {
  const fromFlag = flag?.trim();
  if (fromFlag !== undefined && fromFlag !== "") return fromFlag;
  const fromEnv = deps.env[VENUE_DIR_VARIABLE]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const answer = (await deps.io.prompt("venue directory: ")).trim();
  if (answer === "") {
    throw new AppError("provisioning.venue_dir_missing", { variable: VENUE_DIR_VARIABLE });
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
 * many when the message is the part that can carry whatever a statement put in its own text, and
 * `bin.ts` is on the coverage-excluded side, so the copy that could drift was the one no test would
 * catch.
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
