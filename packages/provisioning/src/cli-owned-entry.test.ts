import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { openVenueDatabase, readDeploymentEnvironment } from "@waitron/db";
import { readTenantIdentities } from "./tenant-guard.js";

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
  await execute(process.execPath, ["../../scripts/bundle-node.mjs", `src/bin.ts=${binary}`], {
    env,
    timeout: 120_000,
  });
});
afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

it("the built venue command reaches the owned terminal wait with no network or activation", async () => {
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
  const questions = [
    "The box's displayed date and time are correct? [y/N]: ",
    "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
    "Confirm setup password: ",
  ];
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
  expect(output).toContain("Wait until ");
  expect(answered.size).toBe(3);
  expect(output).not.toContain("SYNTHETIC-owner-password");
  const state = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(state).toMatchObject({ status: "claimed", consumptionIntent: false, inputs: {} });
  const journal = JSON.parse(
    await readFile(join(stateDir, "module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries).toMatchObject([{ kind: "wait", answer: "yes" }]);
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
    await writeFile(
      preload,
      `import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
https.request = () => { throw new Error("synthetic offline clock"); };
syncBuiltinESMExports();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-10-18T11:40:00Z"])); }
  static now() { return RealDate.parse("2026-10-18T11:40:00Z"); }
};
Object.defineProperty(performance, "now", { value: () => 0 });
`,
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
        ["The box's displayed date and time are correct? [y/N]: ", "yes"],
        [
          "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
          "no",
        ],
        ["Confirm setup password: ", "SYNTHETIC-owner-password"],
        ["Have you kept this recovery PDF? [y/N]: ", "yes"],
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
    let before: unknown;
    let countersBefore: unknown;
    if (interrupted) {
      await mkdir(stateDir);
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
    expect(answered.get("Have you kept this recovery PDF? [y/N]: ")).toBe(interrupted ? 0 : 1);
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
    expect(trading).toContain(`WAITRON_TILL_NODE_ID=${state.frozen.nodeId}\n`);
    expect(trading).toContain("WAITRON_ENV=preproduction\n");
    expect(trading).toContain("WAITRON_ONBOARDING_INTENT=live\n");
    const stored = await openVenueDatabase(target);
    try {
      expect(await readDeploymentEnvironment(stored.venue)).toBe("preproduction");
      const { invoiceSeries } = await import("@waitron/db");
      const series = await stored.venue.select().from(invoiceSeries);
      expect(series.map((row) => row.code).sort()).toEqual(["A-06SV", "FF-06SV", "R-06SV"]);
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
