import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parseModuleConfig } from "@waitron/module";
import type { InitialVenueInput, VenueRequest } from "@waitron/provisioning";
import { ALL_MODULES } from "../../src/modules.js";
import { provisionVenue, venueModuleConfig } from "../../src/provision.js";
import { runDevCustodian } from "./cli.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "waitron-dev-custodian-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[], env: NodeJS.ProcessEnv, input = "") {
  let stdout = "";
  let stderr = "";
  const code = await runDevCustodian(argv, {
    env,
    stdin: Readable.from([input]),
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
  });
  return { code, stdout, stderr };
}

const dev = { WAITRON_ENV: "dev" };

async function snapshot(path: string) {
  return { bytes: await readFile(path), mtimeMs: (await stat(path)).mtimeMs };
}

describe("dev:custodian init", () => {
  it("init writes a private key, a public custodian file and three settings", async () => {
    const result = await run(["init", "--dir", dir], dev);
    expect(result.code).toBe(0);
    expect((await stat(join(dir, "key.pem"))).mode & 0o777).toBe(0o600);
    const custodian = JSON.parse(await readFile(join(dir, "custodian.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(custodian).sort()).toEqual(["custodianId", "fingerprint", "publicKey"]);
    expect(result.stdout).toBe(
      [
        `WAITRON_FISCAL_CUSTODIAN_FILE=${join(dir, "custodian.json")}`,
        `WAITRON_FISCAL_CONFIRMATION_FILE=${join(dir, "confirmation.json")}`,
        `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT=${String(custodian.fingerprint)}`,
        "",
      ].join("\n"),
    );
  });

  it("init reuses an existing key", async () => {
    const first = await run(["init", "--dir", dir], dev);
    const key = await readFile(join(dir, "key.pem"));
    const second = await run(["init", "--dir", dir], dev);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(await readFile(join(dir, "key.pem"))).toEqual(key);
  });

  it("init refuses production and writes nothing", async () => {
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("deployment.development_custodian_refused");
    expect(await readdir(dir)).toEqual([]);
  });

  it("init refuses production when a key already exists, and changes nothing", async () => {
    await run(["init", "--dir", dir], dev);
    const key = await snapshot(join(dir, "key.pem"));
    const custodian = await snapshot(join(dir, "custodian.json"));
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("deployment.development_custodian_refused");
    expect(result.stdout).toBe("");
    expect(await snapshot(join(dir, "key.pem"))).toEqual(key);
    expect(await snapshot(join(dir, "custodian.json"))).toEqual(custodian);
  });

  it("init accepts an empty WAITRON_ENV", async () => {
    const result = await run(["init", "--dir", dir], { WAITRON_ENV: "" });
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(3);
  });

  it("unknown subcommand prints usage", async () => {
    const result = await run(["frobnicate"], dev);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("usage: dev:custodian");
  });
});

const location = {
  name: "Casa Real",
  fiscalTerritory: "ES-common",
  invoiceLocales: ["es-ES"],
  operationDescription: "Venta en establecimiento",
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
};

function wizardBody(venue: Record<string, unknown> = {}) {
  return {
    mode: "prepare",
    venue: {
      country: "ES",
      taxId: "b12345674",
      legalName: "Real Restaurant S.L.",
      location,
      seriesCode: "A",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Admin",
        pin: "1234",
        password: "correct horse battery",
        email: "admin@example.test",
      },
      ...venue,
    },
  };
}

function hostVenue(): VenueRequest {
  return {
    country: "ES",
    taxId: "B12345674",
    legalName: "Real Restaurant S.L.",
    taxpayerDomicile: null,
    location,
    seriesCode: "A",
    fullSeriesCode: "FF",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      pinHash: "pin-hash",
      passwordHash: "password-hash",
      email: "admin@example.test",
    },
  };
}

interface Signed {
  readonly initialOperations: InitialVenueInput & {
    readonly inputs: readonly {
      readonly input: { readonly allocation: { readonly series: unknown } };
    }[];
  };
  readonly [key: string]: unknown;
}

async function initAndStub() {
  const init = await run(["init", "--dir", dir], dev);
  for (const line of init.stdout.trimEnd().split("\n")) {
    const [name, value] = line.split("=") as [string, string];
    vi.stubEnv(name, value);
  }
}

async function sign(body: unknown, env: NodeJS.ProcessEnv = dev) {
  return run(["sign", "--dir", dir], env, JSON.stringify(body));
}

function provision(initialOperations: InitialVenueInput) {
  return provisionVenue(
    {
      ownerDb: suite.db,
      moduleConfig: venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common"),
      database: dir,
      stateDir: dir,
    },
    { environment: "preproduction", venue: hostVenue(), initialOperations },
  );
}

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("dev:custodian sign", () => {
  it("sign makes a setup request the real host path accepts", async () => {
    await initAndStub();
    const result = await sign(wizardBody());
    expect(result.code).toBe(0);
    const signed = JSON.parse(result.stdout) as Signed;
    const venue = await provision(signed.initialOperations);
    expect(suite.db.all(sql`select numero_instalacion, node_id from registro_sif`)).toEqual([
      { numero_instalacion: "S000001", node_id: venue.nodeId },
    ]);
    expect(suite.db.all(sql`select taxpayer_nif, environment from fiscal_allocations`)).toEqual([
      { taxpayer_nif: "B12345674", environment: "preproduction" },
    ]);
    expect(suite.db.all(sql`select code, purpose from invoice_series order by code`)).toEqual([
      { code: "A-S000001", purpose: "standard" },
      { code: "FF-S000001", purpose: "full" },
      { code: "R-S000001", purpose: "rectificative" },
    ]);
  });

  it("the real host path refuses a request the confirmation file was not written for", async () => {
    await initAndStub();
    const signed = JSON.parse((await sign(wizardBody())).stdout) as Signed;
    const path = join(dir, "confirmation.json");
    const confirmation = JSON.parse(await readFile(path, "utf8")) as {
      binding: { eventId: string };
    };
    confirmation.binding.eventId = "another-event";
    await writeFile(path, JSON.stringify(confirmation));
    await expect(provision(signed.initialOperations)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(suite.db.all(sql`select * from registro_sif`)).toEqual([]);
  });

  it("the output keeps the rest of the body byte-for-byte", async () => {
    await initAndStub();
    const body = wizardBody();
    const { initialOperations, ...rest } = JSON.parse((await sign(body)).stdout) as Signed;
    expect(initialOperations).toBeDefined();
    expect(rest).toEqual(body);
  });

  // The setup route itself refuses a body without fullSeriesCode (setup-api.ts parseVenue), so
  // this serves callers that build the provision request themselves, not the wizard.
  it("a missing full-series code signs FF", async () => {
    await initAndStub();
    const body = wizardBody();
    delete (body.venue as { fullSeriesCode?: string }).fullSeriesCode;
    const signed = JSON.parse((await sign(body)).stdout) as Signed;
    expect(signed.initialOperations.inputs[0]!.input.allocation.series).toContainEqual({
      code: "FF-S000001",
      purpose: "full",
    });
  });

  it("refuses a body that already carries initialOperations", async () => {
    await initAndStub();
    const result = await sign({ ...wizardBody(), initialOperations: {} });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("already carries initialOperations");
    expect(result.stdout).toBe("");
    expect(await exists(join(dir, "confirmation.json"))).toBe(false);
  });

  it("refuses production", async () => {
    await initAndStub();
    const result = await sign(wizardBody(), { WAITRON_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("deployment.development_custodian_refused");
    expect(result.stdout).toBe("");
    expect(await exists(join(dir, "confirmation.json"))).toBe(false);
  });

  it("refuses a directory init never prepared", async () => {
    const result = await sign(wizardBody());
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("run dev:custodian init first");
    expect(await readdir(dir)).toEqual([]);
  });
});
