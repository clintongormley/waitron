import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { invoiceSeries, readDeploymentEnvironment, withTransaction } from "@waitron/db";
import { DatabaseSync } from "node:sqlite";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue, createProduct } from "@waitron/catalogue";
import { hashPassword, hashPin } from "@waitron/identity";
import { appliedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import {
  completeFirstSetupCommand,
  createFirstSetupCommandDeployment,
  createFirstSetupRuntime,
  planVenue,
  prepareFirstSetupCommand,
  venueFiscalSelection,
  type FirstSetupOwnerAttempt,
} from "@waitron/provisioning";
import { applyHistoricalTestVenue } from "../test/allocated-venue.js";
import { request, PASSWORD } from "../test/first-setup-request.js";
import { stageConfigurationImport } from "./configuration-import.js";
import {
  buildConfigurationBundle,
  encodeConfigurationBundle,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(newTaxpayer = false, change?: (bundle: ConfigurationBundle) => void) {
  const root = await mkdtemp(join(tmpdir(), "command-import-"));
  roots.push(root);
  const stateDir = join(root, "state");
  await mkdir(stateDir);
  const environment = {
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
    WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
  };
  const ring = loadKeyRing(environment);
  const modules = enabledModules(
    ALL_MODULES,
    venueFiscalSelection(ALL_MODULES, "ES-common").config,
  );
  const versions: Record<string, number> = {};
  for (const module of modules)
    versions[module.name] = await appliedSchemaVersion(source.db, module.migrations);
  const seeded = await applyHistoricalTestVenue(
    planVenue(
      {
        ...request,
        admin: {
          displayName: request.admin.displayName,
          email: request.admin.email,
          pinHash: hashPin(request.admin.pin),
          passwordHash: hashPassword(PASSWORD),
        },
      },
      modules,
    ),
    { db: source.db, modules },
  );
  await withTransaction(source.db, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Imported dishes" });
    await createProduct(tx, {
      name: "Imported gazpacho",
      catalogueId: catalogue.id,
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "7.25",
      vatClass: "general",
    });
    await tx.update(invoiceSeries).set({ nextNumber: 23 });
  });
  const bundle = await buildConfigurationBundle(
    source.db,
    {
      ...seeded,
      sourceOperatorId: (
        await source.db.execute<{ id: string }>("select id from persons where role = 'admin'")
      ).rows[0]!.id,
    },
    modules,
    new Date(),
    versions,
  );
  change?.(bundle);
  const artifact = encodeConfigurationBundle(bundle, "synthetic export passphrase");
  await stageConfigurationImport(
    stateDir,
    ring,
    artifact,
    "synthetic export passphrase",
    async (candidate) => {
      // A retained artifact can have been staged against an older target schema.
      if (change === undefined) validateConfigurationBundle(candidate, modules, versions);
    },
  );
  const digest = createHash("sha256").update(artifact).digest("hex");
  const runtime = createFirstSetupRuntime({
    stateDir,
    venueDir: join(root, "venue"),
    environment,
    modules: ALL_MODULES,
    database: () => target.db,
    freezeConfiguration: async () => ({ digest, newTaxpayer }),
  });
  const claim = await runtime.owner.claimFirstSetup(
    {
      environment: "preproduction",
      configurationImport: true,
      newTaxpayer,
      request: {
        ...request,
        taxId: newTaxpayer ? "B12345674" : request.taxId,
        admin: { ...request.admin, firstNames: null, lastNames: null, locale: null },
      },
    },
    randomBytes(32).toString("base64url"),
  );
  let owner: FirstSetupOwnerAttempt = { ...claim.state, capability: claim.capability };
  const io = {
    stdout() {},
    stderr() {},
    clearScreen() {},
    prompt: async (question: string) => (question.startsWith("Have you kept") ? "yes" : "no"),
    promptSecret: async () => PASSWORD,
  };
  const prepared = await prepareFirstSetupCommand(runtime, owner, io);
  expect(prepared.status).toBe("ready");
  if (prepared.status !== "ready") throw new Error("hour not prepared");
  owner = prepared.owner;
  expect(
    (await runtime.commandDelivery.deliver(owner, io, join(root, "recovery.pdf"), "es")).status,
  ).toBe("ready");
  const deployment = createFirstSetupCommandDeployment({ runtime, db: target.db, environment });
  return { root, stateDir, runtime, owner, deployment, bundle, artifact, seeded };
}

it.each([false, true])(
  "command completion imports configuration with fresh identity and counters (new taxpayer %s)",
  async (newTaxpayer) => {
    const f = await fixture(newTaxpayer);
    const before = (await f.runtime.store.read())!;
    const result = await completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment);
    expect((await target.db.execute("select name from products")).rows).toEqual([
      { name: "Imported gazpacho" },
    ]);
    expect((await target.db.execute("select tax_id as taxId from tenants")).rows).toEqual([
      { taxId: newTaxpayer ? "B12345674" : "50000000R" },
    ]);
    expect(
      (
        await target.db
          .select({ code: invoiceSeries.code, nextNumber: invoiceSeries.nextNumber })
          .from(invoiceSeries)
      ).sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "A-06RB", nextNumber: 1 },
      { code: "FF-06RB", nextNumber: 1 },
      { code: "R-06RB", nextNumber: 1 },
    ]);
    expect(result.nodeId).not.toBe(f.seeded.nodeId);
    expect((await target.db.execute("select id from nodes")).rows).toEqual([{ id: result.nodeId }]);
    expect(
      (await target.db.execute("select count(*) as n from registros_facturacion")).rows,
    ).toEqual([{ n: 0 }]);
    expect((await f.runtime.store.read())!.frozen).toEqual(before.frozen);
    const { $publication, ...inputs } = (await f.runtime.store.read())!.inputs;
    expect($publication).toEqual({ digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(inputs).toEqual(before.inputs);
    expect((await f.runtime.store.read())!.status).toBe("complete");
    await expect(readFile(join(f.stateDir, "configuration-import.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("command completion refuses a replaced retained artifact before stamping or activation", async () => {
  const f = await fixture();
  await writeFile(
    join(f.stateDir, "configuration-import.artifact"),
    encodeConfigurationBundle(
      { ...f.bundle, venue: { ...f.bundle.venue, legalName: "Changed export" } },
      "synthetic export passphrase",
    ),
  );
  await expect(
    completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readDeploymentEnvironment(target.db)).toBeNull();
  expect((await target.db.execute("select count(*) as n from tenants")).rows).toEqual([{ n: 0 }]);
  expect((await target.db.execute("select count(*) as n from fiscal_allocations")).rows).toEqual([
    { n: 0 },
  ]);
});

it.each([
  [
    "country",
    (bundle: ConfigurationBundle) => {
      bundle.venue.country = "PT";
    },
    "configurationImport",
  ],
  [
    "taxpayer",
    (bundle: ConfigurationBundle) => {
      bundle.venue.taxId = "B12345674";
    },
    "configurationImport",
  ],
  [
    "schema version",
    (bundle: ConfigurationBundle) => {
      bundle.modules.core = bundle.modules.core! - 1;
    },
    "module:core",
  ],
] as const)(
  "command refuses retained %s mismatch before stamping",
  async (_label, change, field) => {
    const f = await fixture(false, change);
    await expect(
      completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field } });
    expect(await readDeploymentEnvironment(target.db)).toBeNull();
    expect((await target.db.execute("select count(*) as n from tenants")).rows).toEqual([{ n: 0 }]);
  },
);

it("command refuses new-taxpayer import retaining the source taxpayer", async () => {
  const f = await fixture(true, (bundle) => {
    bundle.venue.taxId = "B12345674";
  });
  await expect(
    completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
  ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "taxId" } });
  expect(await readDeploymentEnvironment(target.db)).toBeNull();
});

it("command rechecks the artifact after publication settings have been checked", async () => {
  const f = await fixture();
  const assertReady = f.deployment.assertReady;
  f.deployment.assertReady = async (state) => {
    await assertReady(state);
    await writeFile(
      join(f.stateDir, "configuration-import.artifact"),
      encodeConfigurationBundle(
        { ...f.bundle, venue: { ...f.bundle.venue, legalName: "Replaced during readiness" } },
        "synthetic export passphrase",
      ),
    );
  };
  await expect(
    completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readDeploymentEnvironment(target.db)).toBeNull();
  expect((await target.db.execute("select count(*) as n from tenants")).rows).toEqual([{ n: 0 }]);
});

it("an import refusal rolls back the venue and fiscal activation together", async () => {
  const f = await fixture(false, (bundle) => {
    bundle.tables.products![0]!.unexpected_column = "invalid";
  });
  await expect(
    completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
  ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "table:products" } });
  expect(await readDeploymentEnvironment(target.db)).toBe("preproduction");
  for (const name of ["tenants", "fiscal_allocations", "products"])
    expect(
      (await target.db.execute(sql`select count(*) as n from ${sql.identifier(name)}`)).rows,
    ).toEqual([{ n: 0 }]);
  expect(await readFile(join(f.stateDir, "configuration-import.artifact"))).toEqual(f.artifact);
});

it("recovered exact Finish completes after imported configuration has been cleared", async () => {
  const f = await fixture();
  const publication = f.deployment.publication;
  f.deployment.publication = async (state) => {
    const result = await publication(state);
    const clear = result.deps.clearConfiguration!;
    result.deps.clearConfiguration = async () => {
      await clear();
      throw new Error("synthetic interruption after import cleanup");
    };
    return result;
  };
  await expect(
    completeFirstSetupCommand(f.runtime, target.db, f.owner, f.deployment),
  ).rejects.toThrow("synthetic interruption after import cleanup");
  expect((await target.db.execute("select name from products")).rows).toEqual([
    { name: "Imported gazpacho" },
  ]);
  const series = await target.db.select().from(invoiceSeries);
  const products = (await target.db.execute("select * from products")).rows;
  const inputs = (await f.runtime.store.read())!.inputs;
  await expect(readFile(join(f.stateDir, "configuration-import.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const recovered = await f.runtime.owner.recoverFirstSetup(randomBytes(32).toString("base64url"), {
    password: PASSWORD,
  });
  const owner = { ...recovered.state, capability: recovered.capability };
  const deployment = createFirstSetupCommandDeployment({
    runtime: f.runtime,
    db: target.db,
    environment: {
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
      WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
    },
  });
  await completeFirstSetupCommand(f.runtime, target.db, owner, deployment);
  expect((await f.runtime.store.read())!.status).toBe("complete");
  expect((await f.runtime.store.read())!.inputs).toEqual(inputs);
  expect(await target.db.select().from(invoiceSeries)).toEqual(series);
  expect((await target.db.execute("select * from products")).rows).toEqual(products);
  expect((await target.db.execute("select name from products")).rows).toEqual([
    { name: "Imported gazpacho" },
  ]);
});

it("the actual relocated command resumes a retained import and publishes it once", async () => {
  vi.setSystemTime(new Date("2026-10-18T11:40:00Z"));
  const f = await fixture();
  const pdfPath = join(f.root, "recovery.pdf");
  const pdf = await readFile(pdfPath);
  const before = (await f.runtime.store.read())!;
  const venueDir = join(f.root, "venue");
  await mkdir(venueDir, { recursive: true });
  const files = (await target.db.execute<{ name: string; file: string }>("pragma database_list"))
    .rows;
  const databaseDir = dirname(files.find((row) => row.name === "main")!.file);
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(databaseDir, name), join(venueDir, name));
  const binary = join(f.root, "provision.js");
  const environment = { ...process.env };
  for (const name of Object.keys(environment))
    if (name.startsWith("GIT_")) delete environment[name];
  const buildScript = join(f.root, "build-command.mjs");
  await writeFile(
    buildScript,
    `import { bundle } from ${JSON.stringify(new URL("../../../scripts/bundle-node.mjs", import.meta.url).href)};
bundle([{ entry: "src/bin.ts", outfile: ${JSON.stringify(binary)} }], {
  release: {
    sourceCommit: "${"a".repeat(40)}",
    committedAt: "2026-10-15T00:00:00.000Z",
    instantMs: Date.parse("2026-10-15T00:00:00Z"),
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "${"b".repeat(64)}",
  },
});
`,
  );
  await promisify(execFile)(process.execPath, [buildScript], {
    timeout: 120_000,
    env: environment,
  });
  const preload = join(f.root, "offline-clock.mjs");
  await writeFile(
    preload,
    `import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
https.request = () => { throw new Error("synthetic offline clock"); };
syncBuiltinESMExports();
const OriginalDate = Date;
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : ["2026-10-18T11:40:00Z"])); }
  static now() { return OriginalDate.parse("2026-10-18T11:40:00Z"); }
};
Object.defineProperty(performance, "now", { value: () => 0 });
`,
  );
  const values = {
    "venue-dir": venueDir,
    country: request.country,
    "tax-id": request.taxId,
    "legal-name": request.legalName,
    "taxpayer-domicile": request.taxpayerDomicile,
    "location-name": request.location.name,
    territory: request.location.fiscalTerritory,
    locale: "es-ES",
    "operation-description": request.location.operationDescription,
    "address-line1": request.location.addressLine1,
    "address-line2": "",
    "postal-code": request.location.postalCode,
    city: request.location.city,
    province: request.location.province,
    "time-zone": request.location.timeZone,
    "day-cutover": request.location.dayCutover,
    "series-code": "A",
    "full-series-code": "FF",
    "rectificative-code": "R",
    "admin-name": request.admin.displayName,
    "admin-email": request.admin.email,
    "recovery-pdf": pdfPath,
  };
  const child = spawn(
    process.execPath,
    [
      "--import",
      preload,
      binary,
      "venue",
      ...Object.entries(values).flatMap(([name, value]) => [`--${name}`, value]),
      "--yes",
    ],
    {
      env: {
        ...environment,
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_ENV: "preproduction",
        WAITRON_ADMIN_PASSWORD: PASSWORD,
        WAITRON_ADMIN_PIN: request.admin.pin,
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
        WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
        WAITRON_SETUP_SETTINGS_FILE: "",
        WAITRON_INITIAL_VENUE_INPUT: "",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  let output = "",
    errors = "",
    childError: string | undefined;
  const replies = new Map<string, number>();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    for (const [question, answer] of [
      ["address line 2 (blank if none): ", ""],
      ["Confirm setup password: ", PASSWORD],
      ["The box's displayed date and time are correct? [y/N]: ", "yes"],
      [
        "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
        "no",
      ],
      ["Have you kept this recovery PDF? [y/N]: ", "yes"],
    ]) {
      const count = output.split(question!).length - 1;
      for (let i = replies.get(question!) ?? 0; i < count; i++) child.stdin.write(`${answer}\n`);
      replies.set(question!, count);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const code = await new Promise<number | null>((done) => {
    child.once("error", (error) => {
      childError = error.name;
    });
    child.once("close", done);
  });
  expect({ code, errors, childError }, output).toEqual({
    code: 0,
    errors: "",
    childError: undefined,
  });
  const disk = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
  try {
    expect(disk.prepare("select name from products").all()).toEqual([
      { name: "Imported gazpacho" },
    ]);
    expect(
      disk
        .prepare("select code, next_number as nextNumber from invoice_series order by code")
        .all(),
    ).toEqual([
      { code: "A-06SV", nextNumber: 1 },
      { code: "FF-06SV", nextNumber: 1 },
      { code: "R-06SV", nextNumber: 1 },
    ]);
  } finally {
    disk.close();
  }
  const after = JSON.parse(await readFile(join(f.stateDir, "first-setup.json"), "utf8"));
  expect(after.status).toBe("complete");
  expect(after.frozen).toEqual(before.frozen);
  expect(after.inputs["fiscal-verifactu"]).toEqual(before.inputs["fiscal-verifactu"]);
  expect(await readFile(pdfPath)).toEqual(pdf);
  await expect(readFile(join(f.stateDir, "configuration-import.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(output + errors).not.toContain(PASSWORD);
});
