import { makeAuthority as makeCertificateAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { openVenueDatabase, readDeploymentEnvironment } from "@waitron/db";
import { readTenantIdentities } from "./tenant-guard.js";

const certificateMaterial = makeCertificateAuthority().issue({
  passphrase: "SYNTHETIC-certificate",
});

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const execute = promisify(execFile);
let directory: string | undefined;
let binary: string;
beforeAll(async () => {
  const scratch = resolve("../../.superpowers");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "cli-owned-entry-"));
  binary = join(directory, "provision.js");
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  const buildScript = join(directory, "build-command.mjs");
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
  await execute(process.execPath, [buildScript], { env, timeout: 120_000 });
});
afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

const SETTLE = "2026-10-18T11:40:00Z";
const AFTER_SETTLE = "2026-10-18T11:42:01Z";
/** A preload that fixes the child's clock at `instant` and has the internet's clock agree. */
function clockPreload(instant: string, extra = "") {
  return `import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
const date = new Date(${JSON.stringify(instant)}).toUTCString();
https.request = (_url, _options, respond) => {
  const request = new EventEmitter();
  request.end = () => queueMicrotask(() => respond({ statusCode: 200, headers: { date }, destroy() {} }));
  return request;
};
${extra}syncBuiltinESMExports();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${JSON.stringify(instant)}])); }
  static now() { return RealDate.parse(${JSON.stringify(instant)}); }
};
Object.defineProperty(performance, "now", { value: () => 0 });
`;
}
/** The first run stops at the settle wait and says until when; the operator runs it again after. */
async function runPastSettle(
  preload: string,
  run: () => Promise<{ code: number | null; errors: string; childError?: string; output: string }>,
  extra = "",
) {
  await writeFile(preload, clockPreload(SETTLE, extra));
  const waited = await run();
  expect(
    { code: waited.code, errors: waited.errors, childError: waited.childError },
    waited.output,
  ).toEqual({ code: 1, errors: "", childError: undefined });
  expect(waited.output).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.\nContinues at 2026-10-18T11:42:00.000Z; run the command again within a minute after that time (later, it waits again).\n",
  );
  await writeFile(preload, clockPreload(AFTER_SETTLE, extra));
}

it("with no network the built venue command explains, asks nothing and spends no name", async () => {
  const target = join(directory!, "venue");
  const stateDir = join(directory!, "state");
  await mkdir(target);
  const databases = await venue.db.execute<{ name: string; file: string }>("pragma database_list");
  const source = databases.rows.find((row) => row.name === "main")!.file;
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(dirname(source), name), join(target, name));
  const offline = join(directory!, "offline.mjs");
  await writeFile(
    offline,
    `import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
https.request = () => { throw new Error("synthetic offline clock"); };
syncBuiltinESMExports();\n`,
  );
  const values = {
    "venue-dir": target,
    country: "ES",
    "tax-id": "50000000R",
    "legal-name": "Olivo SL",
    "taxpayer-domicile": "Mayor 1 Madrid",
    "location-name": "Olivo",
    territory: "ES-common",
    locale: "es-ES",
    "operation-description": "Restaurant",
    "address-line1": "Mayor 1",
    "address-line2": "Local 2",
    "postal-code": "28001",
    city: "Madrid",
    province: "Madrid",
    "time-zone": "Europe/Madrid",
    "day-cutover": "06:00",
    "series-code": "A",
    "rectificative-code": "R",
    "admin-name": "Elena",
    "admin-email": "owner@example.test",
  };
  const child = spawn(
    process.execPath,
    [
      "--import",
      offline,
      binary,
      "venue",
      ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]),
      "--yes",
    ],
    {
      env: {
        ...process.env,
        WAITRON_STATE_DIR: stateDir,
        WAITRON_ENV: "preproduction",
        WAITRON_ADMIN_PIN: "4826",
        WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
        WAITRON_INITIAL_VENUE_INPUT: "",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  let output = "";
  let errors = "";
  const questions = ["Confirm setup password: "];
  const answered = new Set<string>();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    for (const question of questions)
      if (output.includes(question) && !answered.has(question)) {
        answered.add(question);
        child.stdin.write(
          question === "Confirm setup password: " ? "SYNTHETIC-owner-password\n" : "yes\n",
        );
      }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  let childError: string | undefined;
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      childError = error.name;
    });
    child.once("close", resolve);
  });
  expect(code, JSON.stringify({ output, errors, childError, answered: [...answered] })).toBe(1);
  expect({ code, errors }).toEqual({ code: 1, errors: "" });
  expect(output).toContain("No series is made without a confirmed time, so none is ever repeated.");
  expect(output).toContain(
    "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
  );
  expect(output).not.toContain("[no/yes/unknown]");
  expect(answered.size).toBe(0);
  expect(output).not.toContain("SYNTHETIC-owner-password");
  const state = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(state).toMatchObject({ status: "claimed", consumptionIntent: false, inputs: {} });
  await expect(readFile(join(stateDir, "module-preparation-state.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const stored = await openVenueDatabase(target);
  try {
    expect(await readTenantIdentities(stored.venue)).toEqual([]);
    expect(await readDeploymentEnvironment(stored.venue)).toBeNull();
  } finally {
    await stored.close();
  }
});

it.each([false, true])(
  "the built preproduction command completes checked publication (interrupted=%s)",
  async (interrupted) => {
    const root = join(directory!, interrupted ? "interrupted" : "normal");
    await mkdir(root);
    const target = join(root, "live-venue");
    const stateDir = join(root, "live-state");
    await mkdir(target);
    const databases = await venue.db.execute<{ name: string; file: string }>(
      "pragma database_list",
    );
    const source = databases.rows.find((row) => row.name === "main")!.file;
    for (const name of ["venue.db", "venue.db-wal"])
      await copyFile(join(dirname(source), name), join(target, name));
    const preload = join(root, "preproduction-clock.mjs");
    const values = {
      "venue-dir": target,
      country: "ES",
      "tax-id": "50000000R",
      "legal-name": "Olivo SL",
      "taxpayer-domicile": "Mayor 1 Madrid",
      "location-name": "Olivo",
      territory: "ES-common",
      locale: "es-ES",
      "operation-description": "Restaurant",
      "address-line1": "Mayor 1",
      "address-line2": "Local 2",
      "postal-code": "28001",
      city: "Madrid",
      province: "Madrid",
      "time-zone": "Europe/Madrid",
      "day-cutover": "06:00",
      "series-code": "A",
      "rectificative-code": "R",
      "admin-name": "Elena",
      "admin-email": "owner@example.test",
      "recovery-pdf": join(root, "kept-recovery.pdf"),
    };
    async function executeCommand(withPdf = true) {
      const child = spawn(
        process.execPath,
        [
          "--import",
          preload,
          binary,
          "venue",
          ...Object.entries(values)
            .filter(([key]) => withPdf || key !== "recovery-pdf")
            .flatMap(([key, value]) => [`--${key}`, value]),
          "--yes",
        ],
        {
          env: {
            ...process.env,
            WAITRON_STATE_DIR: stateDir,
            WAITRON_ENV: "preproduction",
            WAITRON_ADMIN_PIN: "4826",
            WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
            WAITRON_INITIAL_VENUE_INPUT: "",
            WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      let output = "";
      let errors = "";
      const questions = [
        ["Confirm setup password: ", "SYNTHETIC-owner-password"],
        ["Have you kept this recovery pack? [y/N]: ", "yes"],
      ] as const;
      const answered = new Map<string, number>();
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        for (const [question, answer] of questions) {
          const count = output.split(question).length - 1;
          const previous = answered.get(question) ?? 0;
          for (let i = previous; i < count; i++) child.stdin.write(`${answer}\n`);
          answered.set(question, count);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
      });
      let childError: string | undefined;
      const code = await new Promise<number | null>((resolve) => {
        child.once("error", (error) => {
          childError = error.name;
        });
        child.once("close", resolve);
      });
      return { code, errors, childError, output, answered };
    }
    await runPastSettle(preload, () => executeCommand());
    let before: unknown;
    let countersBefore: unknown;
    if (interrupted) {
      const obstruction = join(stateDir, "trading.env.tmp");
      await mkdir(obstruction);
      const first = await executeCommand();
      expect(
        { code: first.code, errors: first.errors, childError: first.childError },
        first.output,
      ).toEqual({ code: 1, errors: "unexpected failure (SystemError)\n", childError: undefined });
      before = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
      expect(before).toMatchObject({ status: "committed" });
      const stored = await openVenueDatabase(target);
      try {
        const { invoiceSeries } = await import("@waitron/db");
        countersBefore = await stored.venue.select().from(invoiceSeries);
      } finally {
        await stored.close();
      }
      await rm(obstruction, { recursive: true });
      const { createFirstSetupRuntime } = await import("./first-setup-runtime.js");
      const { ALL_MODULES } = await import("@waitron/composition");
      const probe = createFirstSetupRuntime({
        stateDir,
        venueDir: target,
        modules: ALL_MODULES,
        environment: {},
      });
      const inspectionBefore = await probe.resolution.inspectFirstSetupResolution();
      const inspectionAfter = await probe.resolution.inspectFirstSetupResolution();
      expect(inspectionAfter).toEqual(inspectionBefore);
    }
    const { code, errors, childError, output, answered } = await executeCommand(!interrupted);
    expect({ code, errors, childError }, output).toEqual({
      code: 0,
      errors: "",
      childError: undefined,
    });
    expect(output).not.toContain("SYNTHETIC-owner-password");
    expect(answered.get("Have you kept this recovery pack? [y/N]: ")).toBe(interrupted ? 0 : 1);
    if (interrupted) expect([...answered.values()].reduce((a, b) => a + b, 0)).toBe(0);
    const state = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
    expect(state.status).toBe("complete");
    if (interrupted) {
      expect(state.frozen).toEqual((before as { frozen: unknown }).frozen);
      expect(state.inputs).toEqual((before as { inputs: unknown }).inputs);
    }
    expect(JSON.parse(await readFile(join(stateDir, "modules.json"), "utf8"))).toEqual({
      modules: { "fiscal-verifactu": true, "fiscal-none": false },
    });
    const trading = await readFile(join(stateDir, "trading.env"), "utf8");
    expect(trading).toContain(`WAITRON_NODE_ID=${state.frozen.nodeId}\n`);
    expect(trading).toContain("WAITRON_ENV=preproduction\n");
    expect(trading).toContain("WAITRON_ONBOARDING_INTENT=live\n");
    const stored = await openVenueDatabase(target);
    try {
      expect(await readDeploymentEnvironment(stored.venue)).toBe("preproduction");
      const { invoiceSeries } = await import("@waitron/db");
      const series = await stored.venue.select().from(invoiceSeries);
      expect(series.map((row) => row.code).sort()).toEqual(["A-0CRFY", "FF-0CRFY", "R-0CRFY"]);
      expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
      if (interrupted) expect(series).toEqual(countersBefore);
      const identity = await stored.venue.execute<{ public_key: string }>(
        "select public_key from nodes",
      );
      expect(identity.rows).toHaveLength(1);
      expect(identity.rows[0]!.public_key).toEqual(expect.any(String));
      const { readNodeMembershipRow, readMembershipTrustSet } = await import("@waitron/db");
      const { verifyMembershipDocument, isMembershipDocument } =
        await import("@waitron/membership");
      const membership = (await readNodeMembershipRow(stored.venue))!;
      expect(isMembershipDocument(membership.document)).toBe(true);
      if (!isMembershipDocument(membership.document)) throw new Error("invalid membership");
      expect(
        verifyMembershipDocument(membership.document, await readMembershipTrustSet(stored.venue))
          .valid,
      ).toBe(true);
      expect(membership.document.body.nodes).toEqual([
        {
          nodeId: state.frozen.nodeId,
          contactUrl: "https://olivo.example.test:3443",
          standing: "serving-primary",
        },
      ]);
    } finally {
      await stored.close();
    }
  },
);

it("the built production command checks readiness and seals settings without sending a live test sale", async () => {
  const root = join(directory!, "production");
  const target = join(root, "venue");
  const stateDir = join(root, "state");
  await mkdir(target, { recursive: true });
  await mkdir(stateDir);
  const databases = await venue.db.execute<{ name: string; file: string }>("pragma database_list");
  const source = databases.rows.find((row) => row.name === "main")!.file;
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(dirname(source), name), join(target, name));
  const preload = join(root, "clock.mjs");
  const certificate = {
    pfxBase64: certificateMaterial.pfx.toString("base64"),
    passphrase: "SYNTHETIC-certificate",
    certKind: "sello",
  };
  const settingsPath = join(root, "settings.json");
  await writeFile(
    settingsPath,
    JSON.stringify({
      aeatCert: certificate,
      email: {
        server: "smtp.example.test",
        port: 465,
        encryption: "tls",
        from: "owner@example.test",
      },
    }),
    { mode: 0o600 },
  );
  const { ALL_MODULES } = await import("@waitron/composition");
  const { venueFiscalSelection } = await import("./venue-fiscal.js");
  const { enabledModules } = await import("@waitron/module");
  const { appliedSchemaVersion } = await import("@waitron/migrations");
  const { request } = await import("../test/first-setup-request.js");
  const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
  const versions: Record<string, number> = {};
  for (const module of enabledModules(ALL_MODULES, selected.config))
    versions[module.name] = await appliedSchemaVersion(venue.db, module.migrations);
  const { createFiscalReadinessStore } = await import("./fiscal-readiness.js");
  const { fiscalReadinessInput } = await import("./fiscal-readiness-input.js");
  await createFiscalReadinessStore(
    stateDir,
    async () => ({ status: "accepted" }),
    Buffer.alloc(32, 73),
  ).run(
    fiscalReadinessInput({
      venue: {
        ...request,
        admin: {
          displayName: "Elena",
          email: "owner@example.test",
          pinHash: "synthetic",
          passwordHash: "synthetic",
        },
      },
      contribution: selected.contribution!,
      secret: certificate,
      moduleVersions: versions,
      applicationVersion: "synthetic-production-build",
    }),
  );
  const values = {
    "venue-dir": target,
    country: request.country,
    "tax-id": request.taxId,
    "legal-name": request.legalName,
    "taxpayer-domicile": request.taxpayerDomicile,
    "location-name": request.location.name,
    territory: "ES-common",
    locale: "es-ES",
    "operation-description": request.location.operationDescription,
    "address-line1": request.location.addressLine1,
    "address-line2": "Local 2",
    "postal-code": request.location.postalCode,
    city: request.location.city,
    province: request.location.province,
    "time-zone": request.location.timeZone,
    "day-cutover": "06:00",
    "series-code": "A",
    "full-series-code": "FF",
    "rectificative-code": "R",
    "admin-name": "Elena",
    "admin-email": "owner@example.test",
    "recovery-pdf": join(root, "recovery.pdf"),
  };
  async function run() {
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
          ...process.env,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "production",
          WAITRON_ADMIN_PIN: "4826",
          WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
          WAITRON_INITIAL_VENUE_INPUT: "",
          WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_BUILD_ID: "synthetic-production-build",
          WAITRON_SETUP_SETTINGS_FILE: settingsPath,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const answers = [
      ["Confirm setup password: ", "SYNTHETIC-owner-password"],
      ["Have you kept this recovery pack? [y/N]: ", "yes"],
    ] as const;
    const answered = new Map<string, number>();
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      for (const [question, answer] of answers) {
        const count = output.split(question).length - 1;
        for (let i = answered.get(question) ?? 0; i < count; i++) child.stdin.write(`${answer}\n`);
        answered.set(question, count);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    let childError: string | undefined;
    const code = await new Promise<number | null>((resolve) => {
      child.once("error", (error) => {
        childError = error.name;
      });
      child.once("close", resolve);
    });
    return { code, errors, childError, output, answered };
  }
  await runPastSettle(preload, run);
  const { code, errors, childError, output } = await run();
  expect({ code, errors, childError }, output).toEqual({
    code: 0,
    errors: "",
    childError: undefined,
  });
  const state = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(state.status).toBe("complete");
  expect(JSON.stringify(state)).not.toContain(certificate.passphrase);
  expect(output).not.toContain(certificate.passphrase);
  const stored = await openVenueDatabase(target);
  try {
    expect(await readDeploymentEnvironment(stored.venue)).toBe("production");
    const { invoiceSeries, sales, withTransaction } = await import("@waitron/db");
    expect(await stored.venue.select().from(sales)).toEqual([]);
    const series = await stored.venue.select().from(invoiceSeries);
    expect(series.map((row) => row.code).sort()).toEqual(["A-0CRFY", "FF-0CRFY", "R-0CRFY"]);
    expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
    const { loadKeyRing, tryGetCredential } = await import("@waitron/credentials");
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64") });
    expect(
      await withTransaction(stored.venue, (tx) =>
        tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
      ),
    ).toEqual(certificate);
  } finally {
    await stored.close();
  }
});

it("the built production command runs a confirmed isolated test and refuses activation without acceptance", async () => {
  const root = join(directory!, "production-readiness");
  const target = join(root, "venue");
  const stateDir = join(root, "state");
  await mkdir(target, { recursive: true });
  await mkdir(stateDir);
  const databases = await venue.db.execute<{ name: string; file: string }>("pragma database_list");
  const source = databases.rows.find((row) => row.name === "main")!.file;
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(dirname(source), name), join(target, name));
  const preload = join(root, "clock.mjs");
  const certificate = {
    pfxBase64: certificateMaterial.pfx.toString("base64"),
    passphrase: "SYNTHETIC-certificate",
    certKind: "sello",
  };
  const settingsPath = join(root, "settings.json");
  await writeFile(
    settingsPath,
    JSON.stringify({
      aeatCert: certificate,
      email: {
        server: "smtp.example.test",
        port: 465,
        encryption: "tls",
        from: "owner@example.test",
      },
    }),
    { mode: 0o600 },
  );
  const { ALL_MODULES } = await import("@waitron/composition");
  const { venueFiscalSelection } = await import("./venue-fiscal.js");
  const { enabledModules } = await import("@waitron/module");
  const { appliedSchemaVersion } = await import("@waitron/migrations");
  const { request } = await import("../test/first-setup-request.js");
  const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
  const versions: Record<string, number> = {};
  for (const module of enabledModules(ALL_MODULES, selected.config))
    versions[module.name] = await appliedSchemaVersion(venue.db, module.migrations);
  const { fiscalReadinessInput } = await import("./fiscal-readiness-input.js");
  const readiness = fiscalReadinessInput({
    venue: {
      ...request,
      admin: {
        displayName: "Elena",
        email: "owner@example.test",
        pinHash: "synthetic",
        passwordHash: "synthetic",
      },
    },
    contribution: selected.contribution!,
    secret: certificate,
    moduleVersions: versions,
    applicationVersion: "synthetic-production-build",
  });
  const { manifestSets, migrationOptionsFor } = await import("@waitron/migrations");
  const { cp } = await import("node:fs/promises");
  const migrationsRoot = join(root, "migrations");
  const sets = manifestSets();
  const sourceSets = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries())
    await cp(sourceSets[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  const values = {
    "venue-dir": target,
    country: request.country,
    "tax-id": request.taxId,
    "legal-name": request.legalName,
    "taxpayer-domicile": request.taxpayerDomicile,
    "location-name": request.location.name,
    territory: "ES-common",
    locale: "es-ES",
    "operation-description": request.location.operationDescription,
    "address-line1": request.location.addressLine1,
    "address-line2": "Local 2",
    "postal-code": request.location.postalCode,
    city: request.location.city,
    province: request.location.province,
    "time-zone": request.location.timeZone,
    "day-cutover": "06:00",
    "series-code": "A",
    "full-series-code": "FF",
    "rectificative-code": "R",
    "admin-name": "Elena",
    "admin-email": "owner@example.test",
    "recovery-pdf": join(root, "recovery.pdf"),
  };
  async function run() {
    const child = spawn(
      process.execPath,
      [
        "--import",
        preload,
        binary,
        "venue",
        ...Object.entries(values).flatMap(([name, value]) => [`--${name}`, value]),
        "--yes",
        "--test-fiscal",
      ],
      {
        env: {
          ...process.env,
          WAITRON_STATE_DIR: stateDir,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "production",
          WAITRON_ADMIN_PIN: "4826",
          WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
          WAITRON_INITIAL_VENUE_INPUT: "",
          WAITRON_ADVERTISED_ORIGIN: "https://olivo.example.test:3443",
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_BUILD_ID: "synthetic-production-build",
          WAITRON_SETUP_SETTINGS_FILE: settingsPath,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const answers = [
      ["Confirm setup password: ", "SYNTHETIC-owner-password"],
      ["Have you kept this recovery pack? [y/N]: ", "yes"],
      ["Send a preproduction fiscal test? [y/N]: ", "yes"],
    ] as const;
    const answered = new Map<string, number>();
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      for (const [question, answer] of answers) {
        const count = output.split(question).length - 1;
        for (let i = answered.get(question) ?? 0; i < count; i++) child.stdin.write(`${answer}\n`);
        answered.set(question, count);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    let childError: string | undefined;
    const code = await new Promise<number | null>((resolve) => {
      child.once("error", (error) => {
        childError = error.name;
      });
      child.once("close", resolve);
    });
    return { code, errors, childError, output, answered };
  }
  await runPastSettle(
    preload,
    run,
    'import tls from "node:tls";\ntls.connect = () => { throw new Error("synthetic offline submission"); };\n',
  );
  const { code, errors, childError, output, answered } = await run();
  expect({ code, errors, childError }, output).toEqual({
    code: 1,
    errors: "",
    childError: undefined,
  });
  expect(answered.get("Send a preproduction fiscal test? [y/N]: ")).toBe(1);
  expect(output).toContain("Fiscal test: uncertain");
  expect(output).not.toContain(certificate.passphrase);
  expect(output).not.toContain(certificate.pfxBase64);
  const state = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(state.status).toBe("consumption-intent");
  const stored = await openVenueDatabase(target);
  try {
    expect(await readDeploymentEnvironment(stored.venue)).toBeNull();
    expect(await readTenantIdentities(stored.venue)).toEqual([]);
    const { invoiceSeries, sales } = await import("@waitron/db");
    expect(await stored.venue.select().from(sales)).toEqual([]);
    expect(await stored.venue.select().from(invoiceSeries)).toEqual([]);
  } finally {
    await stored.close();
  }
  const { fiscalReadinessBinding } = await import("./fiscal-readiness.js");
  const sample = await openVenueDatabase(
    join(stateDir, `fiscal-readiness-db-${fiscalReadinessBinding(readiness)}`),
  );
  try {
    expect(await readDeploymentEnvironment(sample.venue)).toBe("preproduction");
    const { sales, withTransaction } = await import("@waitron/db");
    const rows = await sample.venue.select().from(sales);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "readiness_test", deviceId: null });
    const { loadKeyRing, tryGetCredential } = await import("@waitron/credentials");
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64") });
    expect(
      await withTransaction(sample.venue, (tx) =>
        tryGetCredential(tx, ring, { purpose: "fiscal.aeat" }),
      ),
    ).toEqual(certificate);
  } finally {
    await sample.close();
  }
  await expect(readFile(join(stateDir, "fiscal-readiness.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
