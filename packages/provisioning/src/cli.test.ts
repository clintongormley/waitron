import { describe, expect, it, vi } from "vitest";
import type { ModuleConfig, WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
// A test file may name a regime package: `scripts/module-seams.test.ts` skips test files.
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import type { DeploymentEnvironment, VenueDatabase } from "@waitron/db";
import { verifyPassword, verifyPin } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { runCli } from "./cli.js";
import type { CliDeps } from "./cli.js";
import type { VenueAction } from "./venue-plan.js";
import type { VenueApplyDeps, VenueResult } from "./venue-apply.js";

const VENUE_DIR = "/var/lib/waitron/venue";

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

const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("probe", {
    provisioning: { seed: { summary: "seed the probe", run: async () => "done" } },
  }),
];

/** Every venue option, so no option is prompted for. */
const VENUE_ARGS = [
  "venue",
  "--venue-dir",
  VENUE_DIR,
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

/** Both secrets from the env, so no echo-off prompt fires; the prompt-path tests omit them. */
const VENUE_ENV = {
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
  readDeploymentTable: ReturnType<typeof vi.fn>;
  stampEnvironment: ReturnType<typeof vi.fn>;
  readTenants: ReturnType<typeof vi.fn>;
  openVenue: ReturnType<typeof vi.fn>;
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
    readDeploymentTable?: () => Promise<boolean>;
    stampEnvironment?: CliDeps["stampEnvironment"];
    readTenants?: () => Promise<{ country: string; taxId: string }[]>;
    openVenue?: (directory: string) => Promise<VenueDatabase>;
  } = {},
): Harness {
  const lines: string[] = [];
  const asked: string[] = [];
  const askedSecretly: string[] = [];
  const answers = [...(options.answers ?? [])];
  const secrets = [...(options.secrets ?? [])];
  let cleared = 0;
  let closes = 0;

  // `closes` counts stores, not handles: the store owns both files.
  const store = {
    venue: { name: "venue file" },
    node: { name: "node file" },
    close: async () => void (closes += 1),
  } as unknown as VenueDatabase;
  const openVenue = vi.fn(options.openVenue ?? (async () => store));
  const applyVenue = vi.fn(options.applyVenue ?? (async () => VENUE_RESULT));
  const writeModuleConfig = vi.fn(options.writeModuleConfig ?? (async () => {}));
  const readEnvironment = vi.fn(
    options.readEnvironment ?? (async () => "preproduction" as DeploymentEnvironment),
  );
  const readDeploymentTable = vi.fn(options.readDeploymentTable ?? (async () => true));
  // A recorder: what the real primitive writes or refuses is `cli.stamp.test.ts`'s.
  const stampEnvironment = vi.fn(options.stampEnvironment ?? (async () => {}));
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
    readDeploymentTable,
    stampEnvironment,
    readTenants,
    openVenue,
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
      openVenue: openVenue as unknown as CliDeps["openVenue"],
      applyVenue: applyVenue as unknown as CliDeps["applyVenue"],
      modules: options.modules ?? MODULES,
      writeModuleConfig: writeModuleConfig as unknown as CliDeps["writeModuleConfig"],
      readEnvironment: readEnvironment as unknown as CliDeps["readEnvironment"],
      readDeploymentTable: readDeploymentTable as unknown as CliDeps["readDeploymentTable"],
      stampEnvironment: stampEnvironment as unknown as CliDeps["stampEnvironment"],
      readTenants: readTenants as unknown as CliDeps["readTenants"],
    },
  };
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
    // `keyring` too, though it takes no options.
    for (const flag of ["--password", "--key", "--admin-password"]) {
      for (const command of ["keyring", "venue"]) {
        expect(await runCli([command, flag, "hunter2"], harness().deps)).toBe(2);
        expect(await runCli([command, `${flag}=hunter2`], harness().deps)).toBe(2);
      }
    }
  });

  it("refuses --admin-url as a flag, in both argv forms", async () => {
    // A URL-shaped value carries a password: it must meet a parse error, not be silently ignored.
    const URL_SHAPED = "postgres://admin:adminsecret@db.example:5432/postgres";
    for (const command of ["keyring", "venue"]) {
      const h = harness();
      expect(await runCli([command, "--admin-url", URL_SHAPED], h.deps)).toBe(2);
      expect(h.openVenue).not.toHaveBeenCalled();

      const g = harness();
      expect(await runCli([command, `--admin-url=${URL_SHAPED}`], g.deps)).toBe(2);
      expect(g.openVenue).not.toHaveBeenCalled();
    }
  });

  it("rejects a stray positional after the command", async () => {
    const h = harness();
    expect(await runCli(["venue", "waitron_demo"], h.deps)).toBe(2);
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("rejects a stray positional after keyring, which takes no options at all", async () => {
    const h = harness();
    expect(await runCli(["keyring", "extra"], h.deps)).toBe(2);
    // Refused BEFORE the unrecoverable key is generated and printed.
    expect(h.lines.join("\n")).not.toContain("WAITRON_CREDENTIALS_KEY=");
  });

  it("keyring opens no venue directory at all", async () => {
    const h = harness();
    expect(await runCli(["keyring"], h.deps)).toBe(0);
    expect(h.openVenue).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.lines.join("\n")).toContain("WAITRON_CREDENTIALS_KEY=");
  });

  it("prompts for what a flag did not supply", async () => {
    const dropped = VENUE_ARGS.indexOf("--legal-name");
    const args = [...VENUE_ARGS.slice(0, dropped), ...VENUE_ARGS.slice(dropped + 2)];
    const h = harness({ answers: ["Acme SL", "n"], env: VENUE_ENV });
    await runCli(args, h.deps);
    expect(h.asked.join(" ")).toMatch(/legal name/i);
    expect(h.asked.join(" ")).not.toMatch(/city/i);
  });
});

describe("runCli venue", () => {
  it("reads the stamp, applies the planned actions against the target, and exits 0", async () => {
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);

    expect(h.readEnvironment).toHaveBeenCalledTimes(1);

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

    // The salt is random, so the hashes are checked with `verifyPin`/`verifyPassword`, not equality.
    const seedAdmin = actions.find((action) => action.kind === "seed-admin");
    expect(seedAdmin?.kind === "seed-admin" && seedAdmin.displayName).toBe("Owner");
    expect(seedAdmin?.kind === "seed-admin" && verifyPin("4321", seedAdmin.pinHash)).toBe(true);
    expect(
      seedAdmin?.kind === "seed-admin" && verifyPassword("dashPass123", seedAdmin.passwordHash),
    ).toBe(true);
    expect(h.askedSecretly).toEqual([]);

    expect(h.openVenue).toHaveBeenCalledTimes(1);
    expect(h.openVenue).toHaveBeenCalledWith(VENUE_DIR);
    const opened = (await h.openVenue.mock.results[0].value) as VenueDatabase;
    expect(applyDeps.db).toBe(opened.venue);
    // MODULES has no fiscal-slot member, so the selection leaves the set unchanged.
    expect(applyDeps.modules).toEqual(MODULES);
    expect(h.writeModuleConfig).toHaveBeenCalledTimes(1);

    const printed = h.lines.join("\n");
    expect(printed).toContain(`Plan for a venue in ${VENUE_DIR} (preproduction):`);
    expect(printed).toContain("ensure tenant ES/B12345678");
    expect(printed).toContain("seed admin Owner");
    expect(printed).toContain("create location Centro in ES-common");
    expect(printed).toContain(`node:     ${VENUE_RESULT.nodeId}`);
    expect(printed).toContain(
      "seeded:   fiscal-verifactu — SIF 55555555-5555-5555-5555-555555555555 (installation 1)",
    );

    expect(printed).not.toContain("4321");
    expect(printed).not.toContain("dashPass123");
    expect(h.closes()).toBe(1);
  });

  it("resolves the fiscal slot from the territory: a GB-vat venue disables verifactu, keeps `none`", async () => {
    // Both fiscal-slot members, as `ALL_MODULES` has. `GB-vat` resolves `filing: "none"`.
    const contribution = (id: string): FiscalContribution => ({
      id,
      activationReadiness: "not-applicable",
      makeBackend: () => ({ id }) as unknown as FiscalBackend,
      drain: () => Promise.reject(new Error("cli selection tests never run the drain seat")),
      resetInFlight: () =>
        Promise.reject(new Error("cli selection tests never run the reset seat")),
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
    // The territory must be prefixed by the country.
    const gbArgs = VENUE_ARGS.map((arg) =>
      arg === "ES" ? "GB" : arg === "ES-common" ? "GB-vat" : arg,
    );
    const code = await runCli([...gbArgs, "--yes"], h.deps);
    expect(code).toBe(0);

    const [, applyDeps] = h.applyVenue.mock.calls[0] as [VenueAction[], VenueApplyDeps];
    expect(applyDeps.modules.map((m) => m.name)).toEqual(["core", "fiscal-none"]);

    expect(written?.overrides.get("fiscal-verifactu")).toBe(false);
    expect(written?.overrides.get("fiscal-none")).toBe(true);
  });

  // The REAL Veri*Factu seat, not a stub, so these fail if the regime's rule and the CLI disagree.
  const verifactuModules: readonly WaitronModule[] = [
    fakeModule("core"),
    fakeModule("fiscal-verifactu", { fiscal: FISCAL_SLOT }),
  ];

  it("refuses a venue whose series code the tax agency would reject, before opening a connection", async () => {
    const h = harness({ env: VENUE_ENV, modules: verifactuModules });
    // A space is not in `NumSerieFactura`'s character set.
    const args = VENUE_ARGS.map((arg) => (arg === "A" ? "Serie A" : arg));

    const code = await runCli([...args, "--yes"], h.deps);

    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('setup.request_invalid {"field":"seriesCode"}');
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("names the OTHER series code when that is the bad one", async () => {
    // Without this the refusal above could be wired to any field and still pass.
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
    // The control: a seat that refused everything would pass both cases above.
    const h = harness({ env: VENUE_ENV, modules: verifactuModules });

    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);

    expect(code).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
  });

  it("reads the admin PIN echo-OFF from a prompt when WAITRON_ADMIN_PIN is unset, and never prints it", async () => {
    const h = harness({
      env: {},
      secrets: ["4321", "dashPass123"],
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);

    expect(h.askedSecretly).toEqual(["admin PIN (not shown): ", "admin password (not shown): "]);
    expect(h.asked.join(" ")).not.toContain("PIN");
    expect(h.asked.join(" ")).not.toContain("password");

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const seedAdmin = actions.find((action) => action.kind === "seed-admin");
    expect(seedAdmin?.kind === "seed-admin" && seedAdmin.displayName).toBe("Owner");
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
    // `--admin-last-names ""` is how a script says "no last name"; `persons_last_names_ck` refuses
    // an empty string.
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
    for (const args of [
      ["venue", "--admin-pin", "4321"],
      ["venue", "--admin-pin=4321"],
    ]) {
      const h = harness();
      expect(await runCli(args, h.deps)).toBe(2);
      expect(h.openVenue).not.toHaveBeenCalled();
      expect(h.applyVenue).not.toHaveBeenCalled();
    }
  });

  it("refuses a too-short admin PIN and applies nothing — the floor createPerson enforces", async () => {
    // `999` appears in no other argument, so the leak assertion below means something.
    const h = harness({
      env: { WAITRON_ADMIN_PIN: "999" },
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('pin.too_short {"min":4}');
    expect(h.lines.join("\n")).not.toContain("999");
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("refuses a too-short admin password and applies nothing — the floor loginManager needs", async () => {
    // `shortpw` appears in no other argument, so the leak assertion below means something.
    const h = harness({
      env: {
        WAITRON_ADMIN_PIN: "4321",
        WAITRON_ADMIN_PASSWORD: "shortpw",
      },
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain('password.too_short {"min":8}');
    expect(h.lines.join("\n")).not.toContain("shortpw");
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("refuses an unimplemented territory and applies nothing", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES-common" ? "ES-canary" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines).toContainEqual(expect.stringContaining("fiscal.regime_not_implemented"));
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("refuses a territory that does not belong to the country, before connecting", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "ES" ? "PT" : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.territory_country_mismatch {"country":"PT","fiscalTerritory":"ES-common"}',
    );
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("stamps a MIGRATED directory that carries no stamp, then applies", async () => {
    // `WAITRON_ENV` is unset, so preproduction (CLAUDE.md §5).
    const h = harness({ env: VENUE_ENV, readEnvironment: async () => null });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.stampEnvironment).toHaveBeenCalledTimes(1);
    expect(h.stampEnvironment.mock.calls[0]![1]).toBe("preproduction");
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
    expect(h.lines.join("\n")).toContain(`Plan for a venue in ${VENUE_DIR} (preproduction):`);
    expect(h.lines.join("\n")).toContain(
      "stamp this venue directory preproduction — permanent, from WAITRON_ENV",
    );
  });

  it("stamps production when WAITRON_ENV is production", async () => {
    const h = harness({
      env: { ...VENUE_ENV, WAITRON_ENV: "production" },
      readEnvironment: async () => null,
    });
    expect(await runCli([...VENUE_ARGS, "--yes"], h.deps)).toBe(0);
    expect(h.stampEnvironment.mock.calls[0]![1]).toBe("production");
    expect(h.lines.join("\n")).toContain(`Plan for a venue in ${VENUE_DIR} (production):`);
  });

  it("stamps AFTER the operator confirms, never before", async () => {
    // Declining must leave the directory exactly as it was found, and a stamp is permanent.
    const h = harness({ env: VENUE_ENV, readEnvironment: async () => null, answers: ["n"] });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(1);
    expect(h.lines.join("\n")).toContain("Nothing was applied.");
    expect(h.stampEnvironment).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("hands the stamp the value WAITRON_ENV resolved to even when the directory is stamped", async () => {
    // Unconditional, as in the wizard's handler: the primitive decides between no-op and refusal.
    const h = harness({ env: VENUE_ENV, readEnvironment: async () => "production" });
    expect(await runCli([...VENUE_ARGS, "--yes"], h.deps)).toBe(0);
    expect(h.stampEnvironment.mock.calls[0]![1]).toBe("preproduction");
    expect(h.lines.join("\n")).toContain(`Plan for a venue in ${VENUE_DIR} (production):`);
    expect(h.lines.join("\n")).not.toContain("stamp this venue directory");
    expect(h.readDeploymentTable).not.toHaveBeenCalled();
  });

  it("propagates the stamp's own refusal, applying nothing", async () => {
    const h = harness({
      env: VENUE_ENV,
      readEnvironment: async () => "production",
      stampEnvironment: async () => {
        throw new AppError("deployment.already_stamped", {
          stamped: "production",
          requested: "preproduction",
        });
      },
    });
    expect(await runCli([...VENUE_ARGS, "--yes"], h.deps)).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'deployment.already_stamped {"stamped":"production","requested":"preproduction"}',
    );
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("refuses a venue directory nothing has migrated, before stamping", async () => {
    // Opening a virgin directory succeeds — the store creates it — so this, not a failed open, is
    // what a mistyped path meets.
    const h = harness({
      env: VENUE_ENV,
      readEnvironment: async () => null,
      readDeploymentTable: async () => false,
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      `provisioning.database_unmigrated {"database":"${VENUE_DIR}"}`,
    );
    expect(h.stampEnvironment).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("refuses a WAITRON_ENV that is neither environment, before opening the directory", async () => {
    const h = harness({ env: { ...VENUE_ENV, WAITRON_ENV: "prod" } });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(
      'provisioning.invalid_environment {"variable":"WAITRON_ENV","value":"prod"}',
    );
    expect(h.openVenue).not.toHaveBeenCalled();
  });

  it("refuses a SECOND, DIFFERENT fiscal identity in the same database, before applying (§5)", async () => {
    // The database holds ES/B99999999; VENUE_ARGS asks for ES/B12345678.
    const h = harness({
      env: VENUE_ENV,
      readTenants: async () => [{ country: "ES", taxId: "B99999999" }],
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    expect(h.lines.join("\n")).toContain(`provisioning.foreign_tenant {"database":"${VENUE_DIR}"}`);
    expect(h.readTenants).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
  });

  it("passes the SAME fiscal identity to the single-venue apply guard", async () => {
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
    expect(h.openVenue).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("upper-cases the country so es and ES are the same taxpayer", async () => {
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
    const args = VENUE_ARGS.map((arg) => (arg === "Acme SL" ? "   " : arg));
    const h = harness({ answers: ["Acme SL"], env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.asked).toContain("legal name: ");
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const ensureTenant = actions.find((action) => action.kind === "ensure-tenant");
    expect(ensureTenant).toMatchObject({ kind: "ensure-tenant", legalName: "Acme SL" });
  });

  it("trims a flag-provided --locale, matching the prompted path", async () => {
    const args = VENUE_ARGS.map((arg) => (arg === "es-ES" ? " es-ES " : arg));
    const h = harness({ env: VENUE_ENV });
    const code = await runCli([...args, "--yes"], h.deps);
    expect(code).toBe(0);
    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual(["es-ES"]);
  });

  it("refuses a venue directory nothing supplied, rather than opening the working directory", async () => {
    // `bin.ts`'s `ask` returns `""` for an exhausted stdin or a Ctrl+D.
    for (const args of [
      // Neither flag nor variable, and the prompt answers nothing.
      ["venue", ...VENUE_ARGS.slice(3)],
      // A whitespace-only flag counts as absent, falls through to the same prompt.
      VENUE_ARGS.map((arg) => (arg === VENUE_DIR ? "   " : arg)),
    ]) {
      const h = harness({ env: VENUE_ENV });
      expect(await runCli([...args, "--yes"], h.deps)).toBe(1);
      expect(h.lines.join("\n")).toContain(
        'provisioning.venue_dir_missing {"variable":"WAITRON_VENUE_DIR"}',
      );
      // The exit code alone would pass against a version that opened something first.
      expect(h.openVenue).not.toHaveBeenCalled();
      expect(h.applyVenue).not.toHaveBeenCalled();
    }
  });

  it("takes the venue directory from WAITRON_VENUE_DIR when no flag supplies it", async () => {
    const h = harness({ env: { ...VENUE_ENV, WAITRON_VENUE_DIR: VENUE_DIR } });
    expect(await runCli(["venue", ...VENUE_ARGS.slice(3), "--yes"], h.deps)).toBe(0);
    expect(h.openVenue).toHaveBeenCalledWith(VENUE_DIR);
    expect(h.asked.join(" ")).not.toMatch(/venue directory/i);
  });

  it("prefers the flag over WAITRON_VENUE_DIR", async () => {
    const h = harness({ env: { ...VENUE_ENV, WAITRON_VENUE_DIR: "/somewhere/else" } });
    expect(await runCli([...VENUE_ARGS, "--yes"], h.deps)).toBe(0);
    expect(h.openVenue).toHaveBeenCalledWith(VENUE_DIR);
  });

  it("applies when the operator confirms with y", async () => {
    const h = harness({ answers: ["y"], env: VENUE_ENV });
    expect(await runCli(VENUE_ARGS, h.deps)).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);
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
    expect(printed).toContain(`Plan for a venue in ${VENUE_DIR}`);
    expect(h.closes()).toBe(1);
  });

  it("maps a concurrent unique-violation from the apply to provisioning.venue_conflict", async () => {
    // The `errcode` + `message` pair `isUniqueViolation` reads, copied from a real refusal on this
    // engine.
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
    expect(h.lines.join("\n")).toContain(`provisioning.venue_conflict {"database":"${VENUE_DIR}"}`);
    // The driver's message can quote the failing statement; it is never printed.
    expect(h.lines.join("\n")).not.toContain("UNIQUE constraint failed");
    expect(h.closes()).toBe(1);
  });

  it("lets an unrecognised failure from the apply escape to bin.ts", async () => {
    const h = harness({
      env: VENUE_ENV,
      applyVenue: () => Promise.reject(new TypeError("undefined is not a function")),
    });
    await expect(runCli([...VENUE_ARGS, "--yes"], h.deps)).rejects.toThrow(
      "undefined is not a function",
    );
    expect(h.closes()).toBe(1);
  });

  it("turns a refused OPEN of the venue directory into a structured code, applying nothing", async () => {
    // What the real open carries when the path runs through a regular file.
    const h = harness({ env: VENUE_ENV });
    h.openVenue.mockRejectedValue(
      Object.assign(new Error(`ENOTDIR: not a directory, mkdir '${VENUE_DIR}'`), {
        code: "ENOTDIR",
      }),
    );
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain(
      `provisioning.state_unreadable {"database":"${VENUE_DIR}","reason":"ENOTDIR"}`,
    );
    expect(h.readEnvironment).not.toHaveBeenCalled();
    expect(h.applyVenue).not.toHaveBeenCalled();
    // Nothing was opened, so nothing was closed.
    expect(h.closes()).toBe(0);
  });

  it("turns a refused stamp READ into a structured code, applying nothing", async () => {
    // A venue file that opened and then could not be read.
    const h = harness({
      env: VENUE_ENV,
      readEnvironment: () =>
        Promise.reject(
          Object.assign(new Error("file is not a database"), { code: "ERR_SQLITE_ERROR" }),
        ),
    });
    const code = await runCli([...VENUE_ARGS, "--yes"], h.deps);
    expect(code).toBe(1);
    const printed = h.lines.join("\n");
    expect(printed).toContain(
      `provisioning.state_unreadable {"database":"${VENUE_DIR}","reason":"ERR_SQLITE_ERROR"}`,
    );
    expect(h.readEnvironment).toHaveBeenCalledTimes(1);
    expect(h.applyVenue).not.toHaveBeenCalled();
    expect(h.closes()).toBe(1);
    // The driver's own message is never printed.
    expect(printed).not.toContain("file is not a database");
  });

  it("lets a failure carrying no code at all escape rather than dressing it as unreadable", async () => {
    // A bug's `TypeError` carries no `code`, so it is not dressed as `state_unreadable`.
    const h = harness({ env: VENUE_ENV });
    h.openVenue.mockRejectedValue(new TypeError("directory is not a function"));
    await expect(runCli([...VENUE_ARGS, "--yes"], h.deps)).rejects.toThrow(
      "directory is not a function",
    );
    expect(h.applyVenue).not.toHaveBeenCalled();
  });

  it("prompts for every omitted option, in order", async () => {
    const h = harness({
      answers: [
        VENUE_DIR,
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
      secrets: ["4321", "dashPass123"],
      env: {},
    });
    const code = await runCli(["venue", "--yes"], h.deps);
    expect(code).toBe(0);
    expect(h.applyVenue).toHaveBeenCalledTimes(1);

    expect(h.asked).toEqual([
      "venue directory: ",
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
    expect(h.askedSecretly).toEqual(["admin PIN (not shown): ", "admin password (not shown): "]);

    const [actions] = h.applyVenue.mock.calls[0] as [VenueAction[]];
    const location = actions.find((action) => action.kind === "create-location");
    expect(location?.kind === "create-location" && location.invoiceLocales).toEqual([
      "es-ES",
      "ca-ES",
    ]);
    expect(location?.kind === "create-location" && location.addressLine2).toBeNull();
  });
});

describe("the error codes this CLI raises", () => {
  it("names the domain concept, never the package", async () => {
    // `fiscal.` although `venue` is where an operator meets it: the code is about a fiscal regime.
    const args = VENUE_ARGS.map((arg) => (arg === "ES-common" ? "ES-canary" : arg));
    const h = harness({ env: VENUE_ENV });
    await runCli([...args, "--yes"], h.deps);
    const line = h.lines.find((l) => l.startsWith("fiscal.regime_not_implemented"));
    expect(line).toBeDefined();
    expect(line).toContain('"territory":"ES-canary"');
  });
});
