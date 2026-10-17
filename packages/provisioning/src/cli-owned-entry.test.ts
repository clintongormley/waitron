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
