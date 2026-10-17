import { assertVenueFirstSetupAllowed } from "./first-setup-state.js";
import { parseArgs, isDeepStrictEqual } from "node:util";
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
  verifyPin,
} from "@waitron/identity";
import {
  enabledModules,
  initialSetupFor,
  type ModuleConfig,
  type WaitronModule,
} from "@waitron/module";
import { randomBytes } from "node:crypto";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import { prepareFirstSetupCommand, resumeFirstSetupCommand } from "./first-setup-command.js";
import {
  completeFirstSetupCommand,
  type FirstSetupCommandDeployment,
} from "./first-setup-command-activation.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import { resolveEnvironment } from "./environment.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import type { ProvisioningIo } from "./io.js";
import { runKeyring } from "./keyring-command.js";
import { applyVenue, type VenueApplyDeps } from "./venue-apply.js";
import { initialVenueApplyInput } from "./initial-venue-input.js";
import { readInitialVenueFile } from "./initial-venue-file.js";
import { describeVenueAction, planVenue, type VenueRequest } from "./venue-plan.js";
import { assertNoForeignTenant, readTenantIdentities } from "./tenant-guard.js";
import "./errors.js";

export interface CliDeps {
  io: ProvisioningIo;
  env: Record<string, string | undefined>;
  /** The caller closes the store, which owns both files. */
  openVenue(directory: string): Promise<VenueDatabase>;
  applyVenue: typeof applyVenue;
  /** The composition list (`@waitron/composition`'s `ALL_MODULES`). */
  modules: readonly WaitronModule[];
  configureVenueModules?: (directory: string) => readonly WaitronModule[];
  configureFirstSetup?: (directory: string) => ReturnType<typeof createFirstSetupRuntime>;
  firstSetupDeployment?: (context: {
    runtime: ReturnType<typeof createFirstSetupRuntime>;
    db: Database;
  }) => FirstSetupCommandDeployment;
  initialVenue?: Pick<VenueApplyDeps, "moduleInputs" | "initialNodeId" | "initialAdministratorId">;
  /** Absent, no `modules.json` is written. */
  writeModuleConfig?: (config: ModuleConfig) => Promise<void>;
  readEnvironment: typeof readDeploymentEnvironment;
  /** Tells a migrated directory with no stamp (stamped) from one nothing has migrated (refused);
   * `readEnvironment` answers `null` for both. */
  readDeploymentTable: typeof deploymentTableExists;
  /** The same primitive the setup wizard's handler stamps with (`provisionVenue`,
   * `apps/server/src/provision.ts`). */
  stampEnvironment: typeof stampDeployment;
  readTenants: typeof readTenantIdentities;
}

/** The variable `apps/server` reads the venue directory from, so the tool and the server open the
 * same directory. */
const VENUE_DIR_VARIABLE = "WAITRON_VENUE_DIR";

/** A login secret never comes from argv (world-readable in `ps`, kept in shell history): only from
 * these variables or an echo-off prompt. `parse` declares no such flag, so `strict: true` refuses
 * one. */
const ADMIN_PIN_VARIABLE = "WAITRON_ADMIN_PIN";
const ADMIN_PASSWORD_VARIABLE = "WAITRON_ADMIN_PASSWORD";

const USAGE = [
  "usage: waitron-provision <command> [options]",
  "",
  "  keyring                                            generate the credential key ring",
  "  venue    [--venue-dir <path>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]",
  "           [--taxpayer-domicile <address>]",
  "           [--location-name <name>] [--territory <t>] [--locale <l>]...",
  "           [--operation-description <text>] [--address-line1 <text>] [--address-line2 <text>]",
  "           [--postal-code <code>] [--city <name>] [--province <name>] [--time-zone <tz>]",
  "           [--day-cutover <HH:MM>] [--series-code <code>] [--full-series-code <code>]",
  "           [--rectificative-code <code>] [--admin-name <name>] [--admin-email <email>]",
  "           [--admin-first-names <names>] [--admin-last-names <names>] [--yes] [--test-fiscal]",
  "           [--recovery-pdf <absolute path outside box state and venue directories>]",
  "",
  "Missing venue details are prompted for. --full-series-code defaults to FF.",
  "The admin's real name is left unset when --admin-first-names and --admin-last-names",
  "are omitted. Select --recovery-pdf explicitly; --yes never confirms that you kept it.",
  "Production reads certificate and email settings from WAITRON_SETUP_SETTINGS_FILE (JSON).",
  "It requires an accepted readiness test for the same certificate, venue and build.",
  "Use --test-fiscal to run it in a separate preproduction database. Confirm separately, even with --yes.",
  "",
  "--venue-dir is the directory holding this node's two SQLite files. Omitted, it is",
  "read from WAITRON_VENUE_DIR — the same variable the server reads — and only then",
  "asked for. There is no connection string and no database name: one directory is the",
  "database.",
  "",
  "A directory that carries no environment stamp is STAMPED from WAITRON_ENV — unset",
  "means preproduction, and production has to be typed out in full. A directory already",
  "stamped for the OTHER environment is refused, never re-stamped. The venue must already",
  "be migrated. A bundled fiscal test reads migrations from WAITRON_MIGRATIONS_DIR.",
  "",
  "The admin PIN and dashboard password (venue) are NOT options either, for the same reason: a",
  "login secret must not reach argv, so each is read from WAITRON_ADMIN_PIN /",
  "WAITRON_ADMIN_PASSWORD or an echo-off prompt — and from nowhere else. The admin display name",
  "(--admin-name) is not a secret and stays a flag.",
].join("\n");

/** Returns the exit code rather than calling `process.exit`; `bin.ts` is the only thing that
 * touches the process. */
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

/** `strict: true` makes an undeclared flag such as `--password` a parse error rather than silently
 * ignored, so a secret typed as a flag is refused; `allowPositionals: false` refuses a stray
 * positional after the command. */
function parse<T extends NonNullable<Parameters<typeof parseArgs>[0]>["options"]>(
  argv: string[],
  options: T,
) {
  return parseArgs({ args: argv, options, strict: true, allowPositionals: false });
}

/** `keyring` takes no options and parses its arguments anyway, so a flag carrying a secret is
 * refused rather than ignored. */
async function keyring(argv: string[], deps: CliDeps): Promise<number> {
  try {
    parse(argv, {});
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }
  return runKeyring(deps.io);
}

async function venue(argv: string[], deps: CliDeps): Promise<number> {
  let values;
  try {
    ({ values } = parse(argv, {
      "venue-dir": { type: "string" },
      country: { type: "string" },
      "tax-id": { type: "string" },
      "legal-name": { type: "string" },
      "taxpayer-domicile": { type: "string" },
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
      "series-code": { type: "string" },
      "full-series-code": { type: "string" },
      "rectificative-code": { type: "string" },
      "admin-name": { type: "string" },
      "admin-first-names": { type: "string" },
      "admin-last-names": { type: "string" },
      "admin-email": { type: "string" },
      "recovery-pdf": { type: "string" },
      "test-fiscal": { type: "boolean" },
      yes: { type: "boolean" },
    }));
  } catch {
    deps.io.stderr(USAGE);
    return 2;
  }

  try {
    const venueDir = await resolveVenueDir(values["venue-dir"], deps);
    const country = assertCountry(
      await resolveOption(values.country, "country (ISO-3166 alpha-2, e.g. ES): ", deps),
    );
    const taxId = await resolveOption(values["tax-id"], "tax id (NIF): ", deps);
    const legalName = await resolveOption(values["legal-name"], "legal name: ", deps);
    const taxpayerDomicile = await resolveOption(
      values["taxpayer-domicile"],
      "taxpayer legal domicile: ",
      deps,
    );
    if (taxpayerDomicile === "") {
      throw new AppError("setup.request_invalid", { field: "taxpayerDomicile" });
    }
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
    // Optional: a blank answer means no second line, not "ask again".
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
    const seriesCode = await resolveOption(values["series-code"], "series code: ", deps);
    const fullSeriesCode = resolveWithoutPrompt(values["full-series-code"]) ?? "FF";
    const rectificativeSeriesCode = await resolveOption(
      values["rectificative-code"],
      "rectificative series code: ",
      deps,
    );
    const adminName = await resolveOption(values["admin-name"], "admin name: ", deps);
    // Never prompted for, so a script driving this command non-interactively meets no new question.
    const adminFirstNames = resolveWithoutPrompt(values["admin-first-names"]);
    const adminLastNames = resolveWithoutPrompt(values["admin-last-names"]);
    const adminEmail = normalizeAndValidateEmail(
      await resolveOption(values["admin-email"], "admin email: ", deps),
    );
    // `hashPin`/`hashPassword` validate nothing, so the admin account's floors are checked here.
    const adminPin = await readAdminPin(deps);
    assertPinLength(adminPin);
    const adminPassword = await readAdminPassword(deps);
    assertPasswordLength(adminPassword);
    // Hashed here, so no plaintext secret enters the plan, an error param or the output.
    const request: VenueRequest = {
      country,
      taxId,
      legalName,
      taxpayerDomicile,
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
      seriesCode,
      fullSeriesCode,
      rectificativeSeriesCode,
      admin: {
        displayName: adminName,
        firstNames: adminFirstNames,
        lastNames: adminLastNames,
        // No browser here to read a UI-language preference from.
        locale: null,
        pinHash: hashPin(adminPin),
        passwordHash: hashPassword(adminPassword),
        email: adminEmail,
      },
    };
    const runtime = deps.configureFirstSetup?.(venueDir);
    const installed = runtime?.modules ?? deps.configureVenueModules?.(venueDir) ?? deps.modules;
    const selection = venueFiscalSelection(installed, request.location.fiscalTerritory);
    const fiscalConfig = selection.config;
    // The regime's own rules on the fields just typed, through the seat the setup wizard uses, before
    // anything is minted (CLAUDE.md §5). A regime that files nothing offers no seat.
    selection.contribution?.venueFields?.validate({
      legalName: request.legalName,
      seriesCode: request.seriesCode,
      fullSeriesCode: request.fullSeriesCode ?? "FF",
      rectificativeSeriesCode: request.rectificativeSeriesCode,
      operationDescription: request.location.operationDescription,
    });
    const modules = enabledModules(installed, fiscalConfig);

    const actions = planVenue(request, modules);
    const requested = resolveEnvironment(deps.env);
    const owned =
      runtime !== undefined && modules.some((module) => initialSetupFor(modules, module.name));
    if ((values["recovery-pdf"] !== undefined || values["test-fiscal"]) && !owned)
      throw new AppError("setup.not_ready", {});
    let owner: FirstSetupOwnerAttempt | undefined;
    if (owned) {
      if (deps.initialVenue !== undefined || deps.env.WAITRON_INITIAL_VENUE_INPUT?.trim())
        throw new AppError("provisioning.initial_input_invalid", {});
      const retained = await runtime.store.readForRepair();
      if (retained !== null) {
        const state = retained.state;
        if (
          ![
            "claimed",
            "consumption-intent",
            "activation-started",
            "committed",
            "publication",
          ].includes(state.status)
        )
          throw new AppError("setup.attempt_uncertain", {});
        runtime.assertSelection(state);
        if (
          state.frozen.environment !== requested ||
          !isDeepStrictEqual(
            withoutCredentials(state.frozen.request),
            withoutCredentials(request),
          ) ||
          !(await verifyPin(adminPin, state.frozen.request.admin.pinHash))
        )
          throw new AppError("setup.attempt_conflict", {});
        if (!(await confirmVenuePlan(actions, venueDir, requested, requested, values.yes, deps)))
          return 1;
        const inspection = await runtime.resolution.inspectFirstSetupResolution();
        const recovered = await runtime.owner.recoverFirstSetupOwner({
          inspectionId: inspection.inspectionId,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          clientClaimNonce: randomBytes(32).toString("base64url"),
          password: adminPassword,
        });
        owner = { ...recovered.state, capability: recovered.capability };
      }
    }

    return await withVenueState(
      venueDir,
      deps,
      async (target) => {
        let environment: DeploymentEnvironment | null;
        let migrated: boolean;
        try {
          // Only the state reads are classified as unreadable; the stamp and the apply keep their own
          // errors.
          environment = await deps.readEnvironment(target);
          // A stamp is itself proof the table is there.
          migrated = environment !== null || (await deps.readDeploymentTable(target));
        } catch (error) {
          throw asUnreadable(error, venueDir);
        }
        if (!migrated) {
          // Opening a virgin directory succeeds — the store creates it — so a mistyped path lands here.
          throw new AppError("provisioning.database_unmigrated", { database: venueDir });
        }
        if (owned && environment !== null && environment !== requested)
          throw new AppError("deployment.already_stamped", {
            stamped: environment,
            requested,
          });

        // `provisionVenue` and `adoptFromPrimary` run the same guard.
        const ensure = actions.find((a) => a.kind === "ensure-tenant");
        if (ensure !== undefined && ensure.kind === "ensure-tenant") {
          assertNoForeignTenant(
            await deps.readTenants(target),
            { country: ensure.country, taxId: ensure.taxId },
            venueDir,
          );
        }

        if (
          owner === undefined &&
          !(await confirmVenuePlan(actions, venueDir, environment, requested, values.yes, deps))
        )
          return 1;

        if (owned) {
          if (owner === undefined) {
            const claim = await runtime.owner.claimFirstSetup(
              {
                environment: requested,
                request: {
                  ...withoutCredentials(request),
                  admin: {
                    ...withoutCredentials(request).admin,
                    password: adminPassword,
                    pin: adminPin,
                  },
                },
              },
              randomBytes(32).toString("base64url"),
            );
            owner = { ...claim.state, capability: claim.capability };
          }
          const state = await runtime.owner.authorize(owner);
          if (["claimed", "consumption-intent"].includes(state.status)) {
            const prepared = await prepareFirstSetupCommand(runtime, owner, deps.io);
            if (prepared.status !== "ready") return 1;
            owner = prepared.owner;
            const destination = values["recovery-pdf"];
            if (destination !== undefined) {
              const delivered = await runtime.commandDelivery.deliver(
                owner,
                deps.io,
                destination,
                invoiceLocales[0]?.startsWith("es") ? "es" : "en",
              );
              if (delivered.status !== "ready") return 1;
            }
            const ownership = [...state.history]
              .reverse()
              .find((event) => ["claim", "resume", "recover"].includes(event.kind));
            if (ownership?.kind === "recover") {
              const resumed = await resumeFirstSetupCommand(runtime, owner, deps.io);
              if (resumed.status !== "ready") return 1;
            }
          }
          if (deps.firstSetupDeployment === undefined) throw new AppError("setup.not_ready", {});
          const deployment = deps.firstSetupDeployment({ runtime, db: target });
          if (values["test-fiscal"] && ["claimed", "consumption-intent"].includes(state.status)) {
            if (deployment.runReadiness === undefined) throw new AppError("setup.not_ready", {});
            const answer = (await deps.io.prompt("Send a preproduction fiscal test? [y/N]: "))
              .trim()
              .toLowerCase();
            if (!["y", "yes"].includes(answer)) return 1;
            const result = await deployment.runReadiness(await runtime.owner.authorize(owner));
            deps.io.stdout(`Fiscal test: ${result.status}`);
            if (!["accepted", "not-applicable"].includes(result.status)) return 1;
          }
          const result = await completeFirstSetupCommand(runtime, target, owner, deployment);
          deps.io.stdout("");
          deps.io.stdout(`node:     ${result.nodeId}`);
          for (const s of result.seeded) deps.io.stdout(`seeded:   ${s.module} — ${s.report}`);
          return 0;
        }

        // Refuses a directory stamped for the other environment (CLAUDE.md §5). After the confirmation:
        // stamping is permanent, so declining must leave the directory exactly as it was found.
        const inputPath = deps.env.WAITRON_INITIAL_VENUE_INPUT;
        const initialVenue =
          deps.initialVenue ??
          (inputPath?.trim()
            ? initialVenueApplyInput(await readInitialVenueFile(inputPath))
            : undefined);
        if (
          [...(initialVenue?.moduleInputs?.keys() ?? [])].some(
            (name) =>
              !modules.some(
                (module) => module.name === name && module.provisioning?.seed !== undefined,
              ),
          )
        )
          throw new AppError("provisioning.initial_input_invalid", {});
        await deps.stampEnvironment(target, requested);

        try {
          const result = await deps.applyVenue(actions, {
            ...initialVenue,
            db: target,
            modules,
          });
          if (deps.writeModuleConfig !== undefined) await deps.writeModuleConfig(fiscalConfig);
          deps.io.stdout("");
          deps.io.stdout(`node:     ${result.nodeId}`);
          for (const s of result.seeded) deps.io.stdout(`seeded:   ${s.module} — ${s.report}`);
          return 0;
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new AppError("provisioning.venue_conflict", { database: venueDir });
          }
          throw error;
        }
      },
      owner === undefined ? undefined : () => runtime!.owner.authorize(owner!),
    );
  } catch (error) {
    return reportFailure(error, deps);
  }
}

/**
 * `body` is handed the VENUE file's handle: every migration set is applied to that file, none to the
 * node file. Only the open is classified (`asUnreadable`); `body`'s own failures pass through.
 */
async function withVenueState(
  venueDir: string,
  deps: CliDeps,
  body: (target: Database) => Promise<number>,
  authorize?: () => Promise<unknown>,
): Promise<number> {
  if (authorize === undefined) await assertVenueFirstSetupAllowed(venueDir);
  else await authorize();
  let store: VenueDatabase;
  try {
    store = await deps.openVenue(venueDir);
  } catch (error) {
    throw asUnreadable(error, venueDir);
  }
  try {
    if (authorize === undefined) await assertVenueFirstSetupAllowed(venueDir);
    else await authorize();
    return await body(store.venue);
  } finally {
    await store.close();
  }
}

function withoutCredentials(request: VenueRequest) {
  const { pinHash: _, passwordHash: __, ...admin } = request.admin;
  void _;
  void __;
  return { ...request, admin };
}

async function confirmVenuePlan(
  actions: ReturnType<typeof planVenue>,
  venueDir: string,
  environment: DeploymentEnvironment | null,
  requested: DeploymentEnvironment,
  yes: boolean | undefined,
  deps: CliDeps,
): Promise<boolean> {
  deps.io.stdout(`Plan for a venue in ${venueDir} (${environment ?? requested}):`);
  deps.io.stdout("");
  if (environment === null)
    deps.io.stdout(`  stamp this venue directory ${requested} — permanent, from WAITRON_ENV`);
  for (const action of actions) deps.io.stdout(`  ${describeVenueAction(action)}`);
  deps.io.stdout("");
  if (yes === true) return true;
  const answer = (await deps.io.prompt("Apply this plan? [y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  deps.io.stderr("Nothing was applied.");
  return false;
}

/**
 * A failure carrying an error `code` — the engine's or the filesystem's — becomes
 * `provisioning.state_unreadable`; one with no code (a bug) is returned untouched. `reason` is the
 * code, never the message: a driver message can quote the failing statement. An `AppError` already
 * names its own cause (`provisioning.database_in_use`) and is passed on unchanged.
 */
function asUnreadable(error: unknown, venueDir: string): unknown {
  if (isAppError(error)) return error;
  const reason = (error as { code?: unknown } | null)?.code;
  if (typeof reason !== "string") return error;
  return new AppError("provisioning.state_unreadable", { database: venueDir, reason });
}

/** A blank or whitespace-only flag counts as absent and falls through to the prompt. */
async function resolveOption(
  value: string | undefined,
  question: string,
  deps: CliDeps,
): Promise<string> {
  const trimmed = value?.trim();
  if (trimmed !== undefined && trimmed !== "") return trimmed;
  return (await deps.io.prompt(question)).trim();
}

/** A blank becomes `null`, not `""`: `persons_first_names_ck` / `persons_last_names_ck` refuse an
 * empty string. */
function resolveWithoutPrompt(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** An empty list is not special-cased: `planVenue` refuses it, as it does an over-count. */
async function resolveLocales(supplied: string[] | undefined, deps: CliDeps): Promise<string[]> {
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
 * The variable sits before the prompt so that on a box which sets it, the tool opens the directory
 * the server does. A blank answer — what `bin.ts`'s `ask` returns for an exhausted stdin or Ctrl+D —
 * is refused with the variable's name rather than passed on as a path.
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

/** Not trimmed: every character of a secret is significant. An empty answer is refused by the
 * caller's length check, so there is no separate "missing" code. */
async function readAdminPin(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_PIN_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return deps.io.promptSecret("admin PIN (not shown): ");
}

/** Not trimmed, like `readAdminPin`. */
async function readAdminPassword(deps: CliDeps): Promise<string> {
  const fromEnv = deps.env[ADMIN_PASSWORD_VARIABLE];
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
  return deps.io.promptSecret("admin password (not shown): ");
}

/** The SHAPE of an ISO-3166-1 alpha-2 code, not a membership check: it catches a typo such as `ESP`
 * early. `value` is echoed: it is operator-typed configuration, never a secret. */
const COUNTRY = /^[A-Za-z]{2}$/;
function assertCountry(value: string): string {
  if (!COUNTRY.test(value)) {
    throw new AppError("provisioning.invalid_country", { value });
  }
  return value.toUpperCase();
}

/** Exported so `bin.ts`, which coverage excludes, prints the same line rather than its own copy. */
export function formatAppError(error: AppError): string {
  return `${error.code} ${JSON.stringify(error.params)}`;
}

/** Anything but an `AppError` is rethrown: a database fault or a bug is not something this file
 * understood. */
function reportFailure(error: unknown, deps: CliDeps): number {
  if (isAppError(error)) {
    deps.io.stderr(formatAppError(error));
    return 1;
  }
  throw error;
}
