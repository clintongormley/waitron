import { describe, expect, it, vi } from "vitest";
import type { ModuleConfig, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
// The REAL Veri*Factu slot contribution, so the venue-field cases below run the regime's own rules
// rather than a stub of them. A test file may name a regime package — `scripts/module-seams.test.ts`
// scans shipped source only, and this package already declares it as a devDependency for
// `venue-apply.e2e.test.ts`.
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import { verifyPassword, verifyPin } from "@waitron/identity";
import { runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { withDatabase, withRole } from "./identifiers.js";
import type { VenueAction } from "./venue-plan.js";
import type { VenueApplyDeps, VenueResult } from "./venue-apply.js";

const DATABASE = "waitron_demo";
const ADMIN_URI = "postgres://admin:adminsecret@db.example:5432/postgres";
/** The connection `venue` opens to the target database: re-pointed at `waitron_demo` and carrying
 * the role option so the session runs AS `waitron_migrator`, the table owner. */
const TARGET_URI = withRole(withDatabase(ADMIN_URI, DATABASE), "waitron_migrator");

/** What the injected `applyVenue` hands back — the ids and seed reports `venue` prints in its result
 * summary. */
const VENUE_RESULT = {
  locationId: "22222222-2222-2222-2222-222222222222",
  tillId: "33333333-3333-3333-3333-333333333333",
  nodeId: "44444444-4444-4444-4444-444444444444",
  seriesIds: ["66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"],
  seeded: [
    {
      module: "fiscal-verifactu",
      report: "SIF 55555555-5555-5555-5555-555555555555 (installation 1)",
    },
  ],
} as unknown as VenueResult;

/** The composition list the CLI injects into `planVenue`/`applyVenue`. Fake, because what `venue`
 * decides is which list it threads, not what any real module seeds. */
const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("probe", {
    provisioning: { seed: { summary: "seed the probe", run: async () => "done" } },
  }),
];

/** Every venue option supplied, so a run reaches the apply with no prompt. `--territory ES-common`
 * is the one implemented set (fiscal-modules.ts); tests that need a refusal swap it out. */
const VENUE_ARGS = [
  "venue",
  "--database",
  DATABASE,
  "--country",
  "ES",
  "--tax-id",
  "B12345678",
  "--legal-name",
  "Acme SL",
  "--location-name",
  "Centro",
  "--territory",
  "ES-common",
  "--locale",
  "es-ES",
  "--operation-description",
  "Restaurante",
  "--address-line1",
  "Calle Mayor 1",
  "--address-line2",
  "Piso 2",
  "--postal-code",
  "28001",
  "--city",
  "Madrid",
  "--province",
  "Madrid",
  "--time-zone",
  "Europe/Madrid",
  "--day-cutover",
  "06:00",
  "--till-name",
  "Barra 1",
  "--series-code",
  "A",
  "--rectificative-code",
  "R",
  "--admin-name",
  "Owner",
  "--admin-email",
  "owner@example.test",
];

/** The three secrets `venue` reads the SAME way — from the env or an echo-off prompt, never argv: the
 * admin connection string (WAITRON_ADMIN_DATABASE_URL), the admin PIN (WAITRON_ADMIN_PIN) and the
 * admin dashboard PASSWORD (WAITRON_ADMIN_PASSWORD). Most venue tests supply all three from the env so
 * no prompt fires; the ones that exercise the prompt path omit WAITRON_ADMIN_PIN / WAITRON_ADMIN_PASSWORD
 * and answer through `secrets` instead. The PIN is `4321` and the password `dashPass123` throughout, so
 * a seeded admin's hashes are checkable with `verifyPin("4321", …)` / `verifyPassword("dashPass123", …)`. */
const VENUE_ENV = {
  WAITRON_ADMIN_DATABASE_URL: ADMIN_URI,
  WAITRON_ADMIN_PIN: "4321",
  WAITRON_ADMIN_PASSWORD: "dashPass123",
};

interface Harness {
  deps: CliDeps;
  /** Everything written to either stream, in order. */
  lines: string[];
  /** Only the ECHOED prompts — what an operator was asked out loud. */
  asked: string[];
  /** Only the echo-OFF prompts. */
  askedSecretly: string[];
  cleared: () => number;
  applyVenue: ReturnType<typeof vi.fn>;
  writeModuleConfig: ReturnType<typeof vi.fn>;
  readEnvironment: ReturnType<typeof vi.fn>;
  readTenants: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  closes: () => number;
}

function harness(
  options: {
    answers?: string[];
    secrets?: string[];
    env?: Record<string, string | undefined>;
    applyVenue?: CliDeps["applyVenue"];
    writeModuleConfig?: CliDeps["writeModuleConfig"];
    modules?: readonly WaitronModule[];
    readEnvironment?: () => Promise<DeploymentEnvironment | null>;
    readTenants?: () => Promise<{ country: string; taxId: string }[]>;
    connect?: (uri: string) => Promise<Database>;
  } = {},
): Harness {
  const lines: string[] = [];
  const asked: string[] = [];
  const askedSecretly: string[] = [];
  const answers = [...(options.answers ?? [])];
  const secrets = [...(options.secrets ?? [ADMIN_URI])];
  let cleared = 0;
  let closes = 0;

  const db = { close: async () => void (closes += 1) } as unknown as Database;
  const connect = vi.fn(options.connect ?? (async () => db));
  // The venue seams, injected because their real implementations need a live target database and
  // what `venue` DECIDES — what it prompts, prints, refuses — does not.
  const applyVenue = vi.fn(options.applyVenue ?? (async () => VENUE_RESULT));
  const writeModuleConfig = vi.fn(options.writeModuleConfig ?? (async () => {}));
  const readEnvironment = vi.fn(
    options.readEnvironment ?? (async () => "preproduction" as DeploymentEnvironment),
  );
  // Empty by default: a fresh, single-tenant database, so the foreign-tenant guard proceeds. Tests
  // exercising the refusal supply an existing identity.
  const readTenants = vi.fn(options.readTenants ?? (async () => []));

  return {
    lines,
    asked,
    askedSecretly,
    cleared: () => cleared,
    closes: () => closes,
    applyVenue,
    writeModuleConfig,
    readEnvironment,
    readTenants,
    connect,
    deps: {
      io: {
        stdout: (line) => void lines.push(line),
        stderr: (line) => void lines.push(line),
        prompt: async (question) => {
          asked.push(question);
          return answers.shift() ?? "";
        },
        promptSecret: async (question) => {
          askedSecretly.push(question);
          return secrets.shift() ?? "";
        },
        clearScreen: () => void (cleared += 1),
      },
      env: options.env ?? {},
      connect: connect as unknown as CliDeps["connect"],
      applyVenue: applyVenue as unknown as CliDeps["applyVenue"],
      modules: options.modules ?? MODULES,
      writeModuleConfig: writeModuleConfig as unknown as CliDeps["writeModuleConfig"],
      readEnvironment: readEnvironment as unknown as CliDeps["readEnvironment"],
      readTenants: readTenants as unknown as CliDeps["readTenants"],
    },
  };
}

/** Every `postgres://` URI printed, in order. */
function printedUris(lines: string[]): string[] {
  return lines.join("\n").match(/postgres:\/\/\S+/g) ?? [];
}

describe("runCli", () => {
  it("prints usage and exits 2 for an unknown command", async () => {
    const h = harness();
    expect(await runCli(["frobnicate"], h.deps)).toBe(2);
    expect(h.lines.join("\n")).toContain("usage: waitron-provision");
  });

  it("prints usage and exits 2 when no command is given at all", async () => {
    const h = harness();
    expect(await runCli([], h.deps)).toBe(2);
    expect(h.lines.join("\n")).toContain("usage: waitron-provision");
  });

  it("refuses any flag that would put a secret in argv", async () => {
    // `strict: true` in the parser is what makes this a parse error rather than a silently ignored
    // flag. If a future maintainer adds --password or --key, this test goes red — which is the
    // point. Same guard packages/credentials/src/cli.test.ts makes.
    //
    // The `=` form matters and the two-token form does not carry the argument on its own: node:util
    // treats an UNRECOGNIZED `--flag value` as a boolean flag followed by a stray POSITIONAL, which
    // `allowPositionals: false` rejects independently of `strict`. `--flag=value` binds the value to
    // the flag regardless of whether the flag is known, so `strict: true` is the only thing
    // standing between it and an accepted secret.
    // BOTH commands, not only the one that takes options: `keyring` takes none and used to discard
    // its argv entirely, so `keyring --password hunter2` printed the key ring and exited 0 while
    // USAGE and README both promised such a flag was a parse error.
    for (const flag of ["--password", "--key", "--admin-password"]) {
      for (const command of ["keyring", "venue"]) {
        expect(await runCli([command, flag, "hunter2"], harness().deps)).toBe(2);
        expect(await runCli([command, `${flag}=hunter2`], harness().deps)).toBe(2);
      }
    }
  });

  it("refuses --admin-url as a flag, in both argv forms", async () => {
    // The admin connection string carries a password, so it is NOT an option — it comes from
    // WAITRON_ADMIN_DATABASE_URL or an echo-off prompt and from nowhere else. Pinned separately
    // from the loop above because `--admin-url` is the one an operator is most likely to try:
    // earlier drafts of this tool's own usage text advertised it.
    for (const command of ["keyring", "venue"]) {
      const h = harness();
      expect(await runCli([command, "--admin-url", ADMIN_URI], h.deps)).toBe(2);
      expect(h.connect).not.toHaveBeenCalled();

      const g = harness();
      expect(await runCli([command, `--admin-url=${ADMIN_URI}`], g.deps)).toBe(2);
      expect(g.connect).not.toHaveBeenCalled();
    }
  });

  it("rejects a stray positional after the command", async () => {
    const h = harness();
    expect(await runCli(["venue", "waitron_demo"], h.deps)).toBe(2);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("rejects a stray positional after keyring, which takes no options at all", async () => {
    const h = harness();
    expect(await runCli(["keyring", "extra"], h.deps)).toBe(2);
    // The refusal must come BEFORE the key ring is generated and printed — a tool that printed an
    // unrecoverable key and then complained about an argument would be worse than one that ignored
    // the argument.
    expect(h.lines.join("\n")).not.toContain("WAITRON_CREDENTIALS_KEY=");
  });

  it("keyring needs no database and no admin connection", async () => {
    const h = harness();
    expect(await runCli(["keyring"], h.deps)).toBe(0);
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.lines.join("\n")).toContain("WAITRON_CREDENTIALS_KEY=");
  });

  it("prompts for what a flag did not supply", async () => {
    // `--legal-name` dropped from an otherwise complete argv, so the run turns on exactly one
    // missing flag: it is asked for, and a flag that WAS supplied (`--city`) is not.
    const dropped = VENUE_ARGS.indexOf("--legal-name");
    const args = [...VENUE_ARGS.slice(0, dropped), ...VENUE_ARGS.slice(dropped + 2)];
    const h = harness({ answers: ["Acme SL", "n"], env: VENUE_ENV });
    await runCli(args, h.deps);
    expect(h.asked.join(" ")).toMatch(/legal name/i);
    expect(h.asked.join(" ")).not.toMatch(/city/i);
  });

  it("reads the admin connection string from the environment rather than asking", async () => {
    const h = harness({ answers: ["n"], env: VENUE_ENV });
    await runCli(VENUE_ARGS, h.deps);
    expect(h.askedSecretly).toEqual([]);
    // `venue` re-points the admin string at the target database, so the string itself is what
    // `targetUri` was built from rather than what `connect` was called with.
    expect(h.connect).toHaveBeenCalledWith(TARGET_URI);
  });

  it("asks for the admin connection string with the echo off when nothing supplied it", async () => {
    // The PIN and password come from the env so the ONE echo-off prompt left is the admin string.
    const h = harness({
      answers: ["n"],
      secrets: [ADMIN_URI],
      env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
    });
    await runCli(VENUE_ARGS, h.deps);
    // Read through `promptSecret`, never `prompt`: the difference is whether it appears on screen.
    expect(h.askedSecretly).toHaveLength(1);
    expect(h.asked.join(" ")).not.toContain("connection");
    expect(h.connect).toHaveBeenCalledWith(TARGET_URI);
  });

  it("refuses an empty admin connection string", async () => {
    // `pg` does not refuse one either, which is the whole hazard. Run against this repo's
    // `pg@8.23.0`: `new Client({ connectionString: "" })` came back as
    // `{host:"localhost",port:5432,user:"<OS user>",database:"<OS user>"}`, and `pg-pool@3.14.0`
    // builds every client with `new this.Client(this.options)` (`index.js:241`) off the same
    // options object. So an unset or misspelled WAITRON_ADMIN_DATABASE_URL plus a stdin that
    // answers nothing — the non-interactive shape README.md documents for CI, where `bin.ts`'s
    // `ask` returns `""` on an exhausted stream or Ctrl+D — would have had `venue` open whatever
    // cluster answers on localhost:5432 and mint a taxpayer, a node and its invoice series in it.
    // §5: a chain and a series number cannot be taken back.
    const h = harness({
      env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
      secrets: [""],
    });
    expect(await runCli([...VENUE_ARGS, "--yes"], h.deps)).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.admin_uri_missing {"variable":"WAITRON_ADMIN_DATABASE_URL"}',
    );
    // Nothing was opened, so nothing could be written. The exit code alone would pass against a
    // version that connected first and complained afterwards.
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("counts an empty env var and a blank answer as nothing supplied, not as a value", async () => {
    const SECRETS_IN_ENV = { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" };
    for (const options of [
      // Set but empty: `resolveAdminUri` falls through to the prompt, which also answers nothing.
      { env: { ...SECRETS_IN_ENV, WAITRON_ADMIN_DATABASE_URL: "" }, secrets: [""] },
      // Whitespace only, from the prompt: `.trim()` makes it the same case.
      { env: SECRETS_IN_ENV, secrets: ["   "] },
    ]) {
      const h = harness(options);
      expect(await runCli(VENUE_ARGS, h.deps)).toBe(1);
      expect(h.lines.join("\n")).toContain("provisioning.admin_uri_missing");
      expect(h.connect).not.toHaveBeenCalled();
    }
  });

  it("never echoes the admin connection string back, from either source", async () => {
    for (const h of [
      harness({ answers: ["n"], env: VENUE_ENV }),
      harness({
        answers: ["n"],
        secrets: [ADMIN_URI],
        env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
      }),
    ]) {
      await runCli(VENUE_ARGS, h.deps);
      expect(h.lines.join("\n")).not.toContain("adminsecret");
    }
  });
});

describe("runCli venue", () => {
  it("reads the stamp, applies the planned actions against the target, and exits 0", async () => {
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);

    // The environment stamp is READ before anything is applied — an unstamped database is refused
    // (see the next test), and the plan summary names the environment it read.
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);

    // Applied ONCE, with the plan `planVenue` produced, against the TARGET connection (the
    // owner-admin that owns the tables).
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
    const [actions, applyDeps] = h.applyVenue.mock.calls[0] as [VenueAction[], VenueApplyDeps];
    expect(actions.map((action) => action.kind)).toEqual([
      "ensure-tenant",
      "seed-admin",
      "seed-device-profiles",
      "create-location",
      "create-till",
      "create-node",
      "create-series",
      "create-series",
      "seed-module",
    ]);

    // The seed-admin action carries the admin's name and a HASH of the PIN — never the plaintext.
    // The salt is random, so the hash is checked with `verifyPin`, not by equality.
    const seedAdmin = actions.find((action) => action.kind === "seed-admin");
    expect(seedAdmin?.kind === "seed-admin" && seedAdmin.displayName).toBe("Owner");
    expect(seedAdmin?.kind === "seed-admin" && verifyPin("4321", seedAdmin.pinHash)).toBe(true);
    // The dashboard PASSWORD is hashed the same way — salt is random, so the hash is checked with
    // `verifyPassword`, never by equality. It came from WAITRON_ADMIN_PASSWORD in the env (VENUE_ENV).
    expect(
      seedAdmin?.kind === "seed-admin" && verifyPassword("dashPass123", seedAdmin.passwordHash),
    ).toBe(true);
    // The PIN and password came from the env (VENUE_ENV) — the env-var half of the same discipline the
    // admin connection string follows — so no echo-off prompt fired for either, and neither was read
    // from argv (VENUE_ARGS carries no PIN/password flag).
    expect(h.askedSecretly).toEqual([]);

    // `withVenueState` re-points the admin URI at the target database and hands THAT connection to
    // the apply. Every insert must reach that database through the same connection.
    expect(h.connect).toHaveBeenCalledTimes(1);
    // `venue` opens the target AS the migrator (the role option), because `applyVenue` inserts as the
    // table owner and a plain admin connection cannot CREATE TABLE in a migrator-owned database.
    expect(h.connect).toHaveBeenCalledWith(TARGET_URI);
    expect(applyDeps.db).toBe(await h.connect.mock.results[0].value);
    // The same (fiscal-slot-resolved) module list the plan was built from reaches the apply, so a
    // seed-module action always names a module the runner holds. The fake MODULES carries no fiscal-slot
    // member, so the selection leaves the set unchanged — hence content-equal to MODULES.
    expect(applyDeps.modules).toEqual(MODULES);
    // The resolved fiscal-slot config is persisted after the apply.
    expect(h.writeModuleConfig).toHaveBeenCalledTimes(1);

    const printed = h.lines.join("\n");
    expect(printed).toContain("Plan for a venue in waitron_demo (preproduction):");
    // The cluster the operator is about to write to — host, port, user; never the password.
    expect(printed).toContain("Cluster: admin@db.example:5432");
    expect(printed).toContain("ensure tenant ES/B12345678");
    // The admin is named in the plan the operator confirms — but the PIN is a secret and never
    // appears, neither in plaintext nor as a hash.
    expect(printed).toContain("seed admin Owner");
    expect(printed).toContain("create location Centro in ES-common");
    // The result summary names the node and one line per module seed the apply ran.
    expect(printed).toContain(`node:     ${VENUE_RESULT.nodeId}`);
    expect(printed).toContain(
      "seeded:   fiscal-verifactu — SIF 55555555-5555-5555-5555-555555555555 (installation 1)",
    );

    // No secret anywhere: the admin connection string is never echoed, the admin PIN never appears,
    // the admin dashboard password never appears, and venue mints no connection strings.
    expect(printed).not.toContain("adminsecret");
    expect(printed).not.toContain(ADMIN_URI);
    expect(printed).not.toContain("4321");
    expect(printed).not.toContain("dashPass123");
    expect(printedUris(h.lines)).toEqual([]);
    // The target connection was closed, whichever way the run ended.
    expect(h.closes()).toBe(1);
  });

  it("resolves the fiscal slot from the territory: a GB-vat venue disables verifactu, keeps `none`", async () => {
    // A synthetic composition list with BOTH fiscal-slot members — the real shape ALL_MODULES takes.
    // `--territory GB-vat` resolves `filing: "none"`, so the selection enables `fiscal-none` and disables
    // `fiscal-verifactu`; the persisted config carries exactly that, and only the enabled set reaches the
    // apply so verifactu's seed is never planned for a no-regime node.
    const contribution = (id: string): FiscalContribution => ({
      id,
      activationReadiness: "not-applicable",
      makeBackend: () => ({ id }) as unknown as FiscalBackend,
      drain: () => Promise.reject(new Error("cli selection tests never run the drain seat")),
    });
    const modules: readonly WaitronModule[] = [
      fakeModule("core"),
      fakeModule("fiscal-verifactu", { fiscal: contribution("verifactu") }),
      fakeModule("fiscal-none", { fiscal: contribution("none") }),
    ];
    let written: ModuleConfig | undefined;
    const h = harness({
      env: VENUE_ENV,
      modules,
      writeModuleConfig: async (config) => void (written = config),
    });
    // GB country + GB-vat territory (the territory must be country-prefixed).
    const gbArgs = VENUE_ARGS.map((arg) =>
      arg === "ES" ? "GB" : arg === "ES-common" ? "GB-vat" : arg,
    );
    const code = await runCli([...gbArgs, "--yes"], h.deps);
    expect(code).toBe(0);

    // Only the enabled set reaches the apply — verifactu (and its seed) is dropped for a no-regime node.
    const [, applyDeps] = h.applyVenue.mock.calls[0] as [VenueAction[], VenueApplyDeps];
    expect(applyDeps.modules.map((m) => m.name)).toEqual(["core", "fiscal-none"]);

    // The persisted config disables verifactu and enables `none`.
    expect(written?.overrides.get("fiscal-verifactu")).toBe(false);
    expect(written?.overrides.get("fiscal-none")).toBe(true);
  });

  /* `waitron-provision venue` prompts for the same four fields the setup wizard does — the legal
   * name, both invoice series codes and the operation description — and then mints the tenant,
   * node, SIF and hash chain from them. So it runs the regime's own rules on those fields through
   * the SAME contract seat the wizard reaches (`FiscalContribution.venueFields`), and the tests
   * below use the REAL Veri*Factu seat rather than a stub, so they fail if the rule and the CLI
   * ever disagree about what is acceptable.
   *
   * Deletion-proof: remove the `selection.contribution?.venueFields?.validate(…)` call from
   * `cli.ts` and the refusal case goes RED — the bad venue reaches `applyVenue` and is provisioned.
   * A venue provisioned that way is unrepairable: every sale it later takes is refused at the
   * chain-append seam, and re-running `venue` reuses the tenant rather than replacing it. */
  const verifactuModules: readonly WaitronModule[] = [
    fakeModule("core"),
    fakeModule("fiscal-verifactu", { fiscal: FISCAL_SLOT }),
  ];

  it("refuses a venue whose series code the tax agency would reject, before opening a connection", async () => {
    const h = harness({ env: VENUE_ENV, modules: verifactuModules });
    // A space is not in `NumSerieFactura`'s character set, so every record this venue ever filed
    // would carry an invoice number AEAT refuses.
    const args = VENUE_ARGS.map((arg) => (arg === "A" ? "Serie A" : arg));

    const code = await runCli([...args, "--yes"], h.deps);

    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('setup.request_invalid {"field":"seriesCode"}');
    // The tenant, node, SIF and hash chain are unrepairable once minted (CLAUDE.md §5), so what
    // matters is that the mint was never reached — and that no admin credential was spent getting
    // there, which is why the seat runs before `resolveAdminUri`.
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("names the OTHER series code when that is the bad one", async () => {
    // Without this the refusal above could be wired to either code — or to any other string field
    // — and still pass, while the field name the operator is shown pointed at the wrong box.
    const h = harness({ env: VENUE_ENV, modules: verifactuModules });
    const args = VENUE_ARGS.map((arg) => (arg === "R" ? "Serie R" : arg));

    const code = await runCli([...args, "--yes"], h.deps);

    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'setup.request_invalid {"field":"rectificativeSeriesCode"}',
    );
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("provisions normally when the same real seat accepts the fields", async () => {
    // The control in the other direction: without it, a seat that refused EVERYTHING would pass
    // both cases above. VENUE_ARGS's own codes (`A`, `R`) are legal, so this run reaches the apply.
    const h = harness({ env: VENUE_ENV, modules: verifactuModules });

    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);

    expect(code).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
  });

  it("reads the admin PIN echo-OFF from a prompt when WAITRON_ADMIN_PIN is unset, and never prints it", async () => {
    // The prompt half of the PIN discipline. Here only the admin URI is in the env, so the PIN falls
    // through to an echo-OFF `promptSecret` — never the echoing `prompt`, exactly like the admin
    // connection string. It is hashed at the CLI boundary (`hashPin`), so only a hash reaches the
    // plan/apply and the plaintext appears nowhere in what the operator saw. The PIN is NOT a flag
    // (see the argv-refusal test), so VENUE_ARGS carries no PIN — the prompt is the only source left.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
      secrets: ["4321", "dashPass123"],
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);

    // The admin URI came from the env, so the echo-off prompts are the PIN then the password, in that
    // order — both echo-off, never on the visible `prompt` stream.
    expect(h.askedSecretly).toEqual(["admin PIN (not shown): ", "admin password (not shown): "]);
    expect(h.asked.join(" ")).not.toContain("PIN");
    expect(h.asked.join(" ")).not.toContain("password");

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const seedAdmin = actions.find((action) => action.kind === "seed-admin");
    expect(seedAdmin?.kind === "seed-admin" && seedAdmin.displayName).toBe("Owner");
    // The salt is random, so the hashes are checked with `verifyPin`/`verifyPassword`, not by
    // equality — and neither plaintext secret reaches the action or the transcript.
    expect(seedAdmin?.kind === "seed-admin" && verifyPin("4321", seedAdmin.pinHash)).toBe(true);
    expect(
      seedAdmin?.kind === "seed-admin" && verifyPassword("dashPass123", seedAdmin.passwordHash),
    ).toBe(true);
    const transcript = h.lines.join("\n");
    expect(transcript).not.toContain("4321");
    expect(transcript).not.toContain("dashPass123");
    expect(transcript).toContain("seed admin Owner");
  });

  it("carries the admin's real names from the two optional flags into seed-admin", async () => {
    const h = harness({ env: VENUE_ENV });
    const code = await runCli(
      [...VENUE_ARGS, "--admin-first-names", "Clinton", "--admin-last-names", "Gormley", "--yes"],
      h.deps,
    );
    expect(code).toBe(0);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    expect(actions.find((action) => action.kind === "seed-admin")).toMatchObject({
      displayName: "Owner",
      firstNames: "Clinton",
      lastNames: "Gormley",
    });
  });

  it("trims a padded real-name flag rather than planning the padding", async () => {
    // Every other venue option is trimmed on its way in (`resolveOption`), and the wizard boundary
    // trims the same two fields, so the CLI must not be the one path that stores `"  Clinton  "`.
    const h = harness({ env: VENUE_ENV });
    const code = await runCli(
      [...VENUE_ARGS, "--admin-first-names", "  Clinton  ", "--yes"],
      h.deps,
    );
    expect(code).toBe(0);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    expect(actions.find((action) => action.kind === "seed-admin")).toMatchObject({
      firstNames: "Clinton",
    });
  });

  it.each([
    ["an empty", ""],
    ["a whitespace-only", "   "],
  ])("treats %s real-name flag as not given, never as an empty string", async (_label, value) => {
    // `--admin-last-names ""` is how a script says "no last name". An empty string reaches
    // `persons_last_names_ck`, which refuses it, so the operator would see a raw SQLSTATE from inside
    // applyVenue instead of a plan that simply leaves the name unset.
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...VENUE_ARGS, "--admin-last-names", value, "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.asked).toEqual([]); // and it still asks nothing rather than prompting for the blank
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    expect(actions.find((action) => action.kind === "seed-admin")).toMatchObject({
      lastNames: null,
    });
  });

  it("asks no new question when neither real-name flag is given, and plans both as null", async () => {
    // The two flags are read but NEVER prompted for, so a script that drove `venue` non-interactively
    // before this existed still runs to completion instead of blocking on a question.
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.askedSecretly).toEqual([]);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    expect(actions.find((action) => action.kind === "seed-admin")).toMatchObject({
      firstNames: null,
      lastNames: null,
    });
  });

  it("refuses --admin-pin as a flag — a login PIN is a secret and never comes from argv", async () => {
    // The PIN follows the admin-connection-string discipline: argv is world-readable in `ps` and
    // lands in shell history, so the PIN is read from WAITRON_ADMIN_PIN or an echo-off prompt and
    // from nowhere else. `parse` declares no `--admin-pin`, so `strict: true` makes either argv form
    // a parse error (exit 2) — nothing is opened. Mirrors the `--admin-url` refusal above.
    for (const args of [
      ["venue", "--admin-pin", "4321"],
      ["venue", "--admin-pin=4321"],
    ]) {
      const h = harness();
      expect(await runCli(args, h.deps)).toBe(2);
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.applyVenue).not.toHaveBeenCalled();
    }
  });

  it("refuses a too-short admin PIN and applies nothing — the floor createPerson enforces", async () => {
    // `hashPin` validates nothing, so without a length check at the boundary an operator could seed
    // the MOST-privileged account (role='admin') with an empty or trivially short PIN. The CLI
    // applies the same `MIN_PIN_LENGTH` floor `createPerson` does. `999` (length 3) is below it and
    // is a distinctive string absent from every other arg, so the leak-safety assertion is real.
    const h = harness({
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI, WAITRON_ADMIN_PIN: "999" },
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    // The error carries only the minimum, never the PIN.
    expect(h.lines.join("\n")).toContain('pin.too_short {"min":4}');
    expect(h.lines.join("\n")).not.toContain("999");
    // Refused before the plan is built and before any connection — nothing is applied.
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses a too-short admin password and applies nothing — the floor loginManager needs", async () => {
    // `hashPassword` validates nothing, so without a length check at the boundary an operator could
    // seed the admin with a trivially short dashboard password. The CLI applies the same
    // MIN_PASSWORD_LENGTH floor `setPassword` does. `shortpw` (length 7) is below it and is a
    // distinctive string absent from every other arg, so the leak-safety assertion is real.
    const h = harness({
      env: {
        WAITRON_ADMIN_DATABASE_URL: ADMIN_URI,
        WAITRON_ADMIN_PIN: "4321",
        WAITRON_ADMIN_PASSWORD: "shortpw",
      },
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('password.too_short {"min":8}');
    expect(h.lines.join("\n")).not.toContain("shortpw");
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses an unimplemented territory and applies nothing", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES-common" ? "ES-canary" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines).toContainEqual(expect.stringContaining("fiscal.regime_not_implemented"));
    expect(h.applyVenue).not.toHaveBeenCalled();
    // Refused by the PURE planner, before the admin credential is asked for or any connection is
    // opened (venue-plan.ts / errors.ts: "no admin connection is spent on a malformed request").
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses a territory that does not belong to the country, before connecting", async () => {
    // country=PT + territory=ES-common is incoherent: ES-common is Spain/Veri*Factu and the SIF's nif
    // comes from the tenant's tax_id, so a non-ES country would file under a non-NIF identity. Like
    // the unimplemented-territory refusal above, it is caught by the PURE planner before the admin
    // credential is asked for — so no connection is opened and nothing is applied.
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "PT" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.territory_country_mismatch {"country":"PT","fiscalTerritory":"ES-common"}',
    );
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("refuses an unstamped database before applying", async () => {
    const h = harness({
      env: VENUE_ENV,
      readEnvironment: async () => null,
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.database_unstamped {"database":"waitron_demo"}',
    );
    // The stamp was read — that is how the emptiness was learnt — and nothing was applied.
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("refuses a SECOND, DIFFERENT fiscal identity in the same database, before applying (§5)", async () => {
    // One tenant per database is the isolation boundary: no query filters rows by tenant, so a
    // second tenant would leak one business's rows to the other. `venue` is one of the tenant-creation paths (the setup-api
    // `provisionVenue` and the mirror `adoptFromPrimary` are the others), and each calls the shared
    // `assertNoForeignTenant`: it reads the existing `(country, tax_id)` set and refuses any identity
    // but the one present. Here the database already holds ES/B99999999 while the request is
    // ES/B12345678 (VENUE_ARGS), so the apply is refused — never reached — leaving no second tenant.
    const h = harness({
      env: VENUE_ENV,
      readTenants: async () => [{ country: "ES", taxId: "B99999999" }],
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('provisioning.foreign_tenant {"database":"waitron_demo"}');
    // The identities were read — that is how the foreign tenant was learnt — and nothing was
    // applied: no second tenant can be written.
    expect(h.readTenants).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("passes the SAME fiscal identity to the single-venue apply guard", async () => {
    // The tenant guard refuses a foreign identity. A database already holding ES/B12345678 proceeds
    // to applyVenue, where the exact same venue is reused and different venue details are refused.
    const h = harness({
      env: VENUE_ENV,
      readTenants: async () => [{ country: "ES", taxId: "B12345678" }],
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.readTenants).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
  });

  it("refuses a country that is not two ASCII letters, before connecting", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "ESP" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('provisioning.invalid_country {"value":"ESP"}');
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("upper-cases the country so es and ES are the same taxpayer", async () => {
    // ISO-3166 alpha-2 is upper-case by convention, but an operator may type `es`. `(country,
    // tax_id)` is a case-sensitive unique index and applyVenue compares the stored identity with
    // the requested one, so `es` and `ES` must NOT read as two different taxpayers — the CLI
    // normalises to upper-case at the boundary, which is what makes a D8 re-run the no-op it is.
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "es" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({
      kind: "ensure-tenant",
      country: "ES",
      taxId: "B12345678",
    });
  });

  it("trims a flag-provided --tax-id so surrounding whitespace is the SAME taxpayer", async () => {
    // Prompted values are trimmed (`(await io.prompt(...)).trim()`) but flag values were not, so
    // `--tax-id " B12345678 "` used to reach the plan verbatim and be stored as a different
    // identity from the trimmed form — a re-run refused for nothing but a stray space, the same
    // footgun class as the country-case bug. The stored tax_id must be the trimmed identity.
    const args = VENUE_ARGS.map((arg) => (arg === "B12345678" ? " B12345678 " : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({
      kind: "ensure-tenant",
      country: "ES",
      taxId: "B12345678",
    });
  });

  it("treats a whitespace-only flag as absent and prompts for it, matching a bare flag", async () => {
    // `resolveOption`'s docstring says an empty flag counts as absent; a whitespace-only flag must
    // too, so flag and prompt behave identically. `--legal-name "   "` therefore falls through to
    // the prompt rather than being accepted verbatim.
    const args = VENUE_ARGS.map((arg) => (arg === "Acme SL" ? "   " : arg));
    const h = harness({ answers: ["Acme SL"], env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    // The prompt for the legal name fired — the whitespace flag did not stand in for it.
    expect(h.asked).toContain("legal name: ");
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({ kind: "ensure-tenant", legalName: "Acme SL" });
  });

  it("trims a flag-provided --locale, matching the prompted path", async () => {
    // `resolveLocales`' prompted path trims each answer; the flag path did not, so `--locale
    // " es-ES "` used to reach the plan with the surrounding whitespace intact.
    const args = VENUE_ARGS.map((arg) => (arg === "es-ES" ? " es-ES " : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual(["es-ES"]);
  });

  it("refuses a database name outside the identifier rule before connecting", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === DATABASE ? "Waitron Prod" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain("provisioning.invalid_identifier");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("applies when the operator confirms with y", async () => {
    const h = harness({ answers: ["y"], env: VENUE_ENV });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
    // Without --yes, the plan confirmation IS asked.
    expect(h.asked.join(" ")).toMatch(/Apply this plan/i);
  });

  it("accepts a spelt-out 'yes' as confirmation too", async () => {
    const h = harness({ answers: ["yes"], env: VENUE_ENV });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
  });

  it("applies NOTHING when the operator declines", async () => {
    const h = harness({ answers: ["n"], env: VENUE_ENV });
    const code = await runCli(VENUE_ARGS, h.deps);
    expect(code).toBe(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    const printed = h.lines.join("\n");
    expect(printed).toContain("Nothing was applied.");
    // The plan was still shown before the decline, and the connection closed.
    expect(printed).toContain("Plan for a venue in waitron_demo");
    expect(h.closes()).toBe(1);
  });

  it("maps a concurrent unique-violation from the apply to provisioning.venue_conflict", async () => {
    // The crafted refusal carries the `errcode` + `message` pair `isUniqueViolation` reads
    // (`packages/db/src/constraint-target.ts`'s `refusalCode`, `packages/db/src/sql-state.ts`'s
    // `UNIQUE_VIOLATION`); the PostgreSQL SQLSTATE this used to carry is not a thing this engine
    // reports. Both values are copied from a real refusal on this index shape, measured on
    // node:sqlite / Node v26.7.0 — `persons_tenant_email_uq` is over `lower(email)`, and SQLite
    // names the INDEX rather than the columns when the index is over an expression, which is why
    // the message has that shape. A plain-column unique reads `UNIQUE constraint failed:
    // <table>.<column>` instead; both were run, with a succeeding insert as the control.
    const h = harness({
      env: VENUE_ENV,
      applyVenue: () =>
        Promise.reject(
          Object.assign(new Error("UNIQUE constraint failed: index 'persons_tenant_email_uq'"), {
            cause: {
              errcode: 2067,
              message: "UNIQUE constraint failed: index 'persons_tenant_email_uq'",
            },
          }),
        ),
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('provisioning.venue_conflict {"database":"waitron_demo"}');
    // The driver's own message can quote the failing statement; it is never printed.
    expect(h.lines.join("\n")).not.toContain("UNIQUE constraint failed");
    expect(h.closes()).toBe(1);
  });

  it("lets an unrecognised failure from the apply escape to bin.ts", async () => {
    // Anything that is not a unique violation is rethrown untouched — a database fault or a bug is
    // not something this file understood, mirroring the instance path.
    const h = harness({
      env: VENUE_ENV,
      applyVenue: () => Promise.reject(new TypeError("undefined is not a function")),
    });
    await expect(runCli([...VENUE_ARGS, "--yes"], h.deps)).rejects.toThrow(
      "undefined is not a function",
    );
    expect(h.closes()).toBe(1);
  });

  it("turns a refused CONNECT to the target into a structured code, applying nothing", async () => {
    // Mirrors `instance`'s "reports a refused CONNECT". `venue` opens ONE connection — the target,
    // via `withVenueState` — so a SQLSTATE-bearing connect failure (the target database absent,
    // 3D000, or the admin URI lacking privilege on it) is the refused-CONNECT case. Before this fix
    // it reached the operator as a raw `unexpected failure`; now it is `provisioning.state_unreadable`
    // naming the database, exactly as `instance`/`status`. The stamp read and the apply never run.
    const h = harness({ env: VENUE_ENV });
    h.connect.mockRejectedValue(
      Object.assign(new Error('database "waitron_demo" does not exist'), { code: "3D000" }),
    );
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain(
      'provisioning.state_unreadable {"database":"waitron_demo","sqlState":"3D000"}',
    );
    expect(h.readEnvironment).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
    // No secret and no SQLSTATE-less raw driver text leaked into the operator's terminal.
    expect(printed).not.toContain("adminsecret");
    expect(printed).not.toContain(ADMIN_URI);
    // Nothing was opened, so nothing was closed.
    expect(h.closes()).toBe(0);
  });

  it("turns a refused stamp READ into a structured code, applying nothing", async () => {
    // Mirrors `instance`'s "turns a read that the database refused into a structured code": an admin
    // that did not create the target holds no privilege on its tables, so the deployment-stamp read
    // fails 42501. A fact about the database, mapped to `provisioning.state_unreadable` — not the raw
    // `unexpected failure` it surfaced as before this fix. The apply must NOT run.
    // VENUE_ENV supplies the PIN and password from the env (like the refused-CONNECT mirror above), so
    // the boundary secret checks pass and the run reaches the stamp read this test is about.
    const h = harness({
      env: VENUE_ENV,
      readEnvironment: () =>
        Promise.reject(
          Object.assign(new Error("permission denied for table deployment"), { code: "42501" }),
        ),
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain(
      'provisioning.state_unreadable {"database":"waitron_demo","sqlState":"42501"}',
    );
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    // The target connection WAS opened for the read, so it is still closed on the way out.
    expect(h.closes()).toBe(1);
    // No secret and no raw driver text leaked.
    expect(printed).not.toContain("adminsecret");
    expect(printed).not.toContain(ADMIN_URI);
  });

  it("prompts for every omitted option, in order, reading the admin URI from the env", async () => {
    const h = harness({
      answers: [
        DATABASE,
        "ES",
        "B12345678",
        "Acme SL",
        "Centro",
        "ES-common",
        "es-ES", // first invoice locale
        "ca-ES", // a second one
        "", // blank ends the locale loop
        "Restaurante",
        "Calle Mayor 1",
        "", // address line 2 is optional — blank means none
        "28001",
        "Madrid",
        "Madrid",
        "Europe/Madrid",
        "06:00",
        "Barra 1",
        "A",
        "R",
        "Owner", // admin name
        "owner@example.test", // admin email
      ],
      // The admin PIN and dashboard password are the echo-OFF options here: WAITRON_ADMIN_PIN and
      // WAITRON_ADMIN_PASSWORD are unset (URL-only env), so each is read through `promptSecret`, never
      // the visible `prompt`, PIN first then password. Only the admin URI is env-fed.
      secrets: ["4321", "dashPass123"],
      env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI },
    });
    // `--yes` so the confirmation prompt does not appear amid the option prompts.
    const code = await runCli(["venue", "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);

    // The exact question sequence — proving both order and wording. The two invoice-locale entries
    // exercise the repeat-until-blank loop, and the admin URI came from the env (echo-off prompt
    // never fired).
    expect(h.asked).toEqual([
      "database name: ",
      "country (ISO-3166 alpha-2, e.g. ES): ",
      "tax id (NIF): ",
      "legal name: ",
      "location name: ",
      "fiscal territory (e.g. ES-common): ",
      "invoice locale (e.g. es-ES): ",
      "another invoice locale (blank to finish): ",
      "another invoice locale (blank to finish): ",
      "operation description: ",
      "address line 1: ",
      "address line 2 (blank if none): ",
      "postal code: ",
      "city: ",
      "province: ",
      "time zone (e.g. Europe/Madrid): ",
      "day cutover (HH:MM): ",
      "till name: ",
      "series code: ",
      "rectificative series code: ",
      "admin name: ",
      "admin email: ",
    ]);
    // The admin PIN and password are the echo-off prompts, in that order (the admin URI came from the
    // env; WAITRON_ADMIN_PIN / WAITRON_ADMIN_PASSWORD are unset here so both fall through to a prompt).
    expect(h.askedSecretly).toEqual(["admin PIN (not shown): ", "admin password (not shown): "]);

    // The two locales prompted for reach the plan.
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual([
      "es-ES",
      "ca-ES",
    ]);
    // The optional address line 2 was left blank, so it is null in the plan.
    expect(location?.kind === "create-location" && location.addressLine2).toBeNull();
  });
});

describe("the error codes this CLI raises", () => {
  it("names the domain concept, never the package", async () => {
    // The house rule (packages/shared/src/errors.ts): `series.not_found`, not
    // `db.series_not_found`. `fiscal.regime_not_implemented` is about a FISCAL regime, which is why
    // it sits under `fiscal.` even though `venue` is where an operator meets it — the provisioning
    // tool is merely where the territory happens to be typed.
    const args = VENUE_ARGS.map((arg) => (arg === "ES-common" ? "ES-canary" : arg));
    const h = harness({ env: VENUE_ENV });
    await runCli([...args, "--yes"], h.deps);
    const line = h.lines.find((l) => l.startsWith("fiscal.regime_not_implemented"));
    expect(line).toBeDefined();
    // `territory`, the name the declaration in `packages/fiscal/src/errors.ts` actually gives it.
    expect(line).toContain('"territory":"ES-canary"');
  });
});
