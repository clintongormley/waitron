import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { invoiceSeries, openVenueDatabase, readDeploymentEnvironment } from "@waitron/db";
import { readTenantIdentities } from "./tenant-guard.js";

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });
const execute = promisify(execFile);
let directory: string | undefined;
let binary: string;
beforeAll(async () => {
  const scratch = resolve("../../.superpowers");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "cli-same-hour-"));
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

it("the built command waits, then takes its name in another process and resumes its kept name and PDF after a preactivation refusal", async () => {
  const target = join(directory!, "venue");
  const stateDir = join(directory!, "state");
  const pdfPath = join(directory!, "kept.pdf");
  await mkdir(target);
  const databases = await venue.db.execute<{ name: string; file: string }>("pragma database_list");
  const source = databases.rows.find((row) => row.name === "main")!.file;
  for (const name of ["venue.db", "venue.db-wal"])
    await copyFile(join(dirname(source), name), join(target, name));
  async function clockAt(instant: string) {
    const preload = join(directory!, `clock-${instant.replaceAll(":", "")}.mjs`);
    await writeFile(
      preload,
      `import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
const RealDate = Date;
const date = new RealDate(${JSON.stringify(instant)}).toUTCString();
https.request = (_url, _options, respond) => {
  const request = new EventEmitter();
  request.end = () => queueMicrotask(() => respond({ statusCode: 200, headers: { date }, destroy() {} }));
  return request;
};
syncBuiltinESMExports();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${JSON.stringify(instant)}])); }
  static now() { return RealDate.parse(${JSON.stringify(instant)}); }
};
Object.defineProperty(performance, "now", { value: () => 0 });
`,
    );
    return preload;
  }
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
    "recovery-pdf": pdfPath,
  };
  async function run(origin: string, preload: string) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        preload,
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
          WAITRON_ADVERTISED_ORIGIN: origin,
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 73).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
        },
        signal: AbortSignal.timeout(45_000),
      },
    );
    let output = "",
      errors = "";
    const answers = [
      ["Confirm setup password: ", "SYNTHETIC-owner-password"],
      ["Have you kept this recovery PDF? [y/N]: ", "yes"],
    ];
    const answered = new Map<string, number>();
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      for (const [question, answer] of answers) {
        const count = output.split(question!).length - 1;
        for (let n = answered.get(question!) ?? 0; n < count; n++) child.stdin.write(`${answer}\n`);
        answered.set(question!, count);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    let childError: string | undefined;
    const code = await new Promise<number | null>((done) => {
      child.once("error", (error) => {
        childError = error.name;
      });
      child.once("close", done);
    });
    return { code, errors, childError, output };
  }
  const waited = await run("", await clockAt("2026-10-18T11:38:00Z"));
  expect(
    { code: waited.code, errors: waited.errors, childError: waited.childError },
    waited.output,
  ).toEqual({ code: 1, errors: "", childError: undefined });
  expect(waited.output).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.\nContinues at 2026-10-18T11:40:00.000Z; run the command again within a minute after that time (later, it waits again).\n",
  );
  expect(waited.output).not.toContain("[no/yes/unknown]");
  expect(JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8")).status).toBe(
    "claimed",
  );
  const first = await run("", await clockAt("2026-10-18T11:40:00Z"));
  expect(
    { code: first.code, errors: first.errors, childError: first.childError },
    first.output,
  ).toEqual({ code: 1, errors: "setup.not_ready {}\n", childError: undefined });
  expect(first.errors).toBe("setup.not_ready {}\n");
  const before = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(before.status).toBe("consumption-intent");
  const pdf = await readFile(pdfPath);
  const empty = await openVenueDatabase(target);
  try {
    expect(await readTenantIdentities(empty.venue)).toEqual([]);
    expect(await readDeploymentEnvironment(empty.venue)).toBeNull();
    expect(await empty.venue.select().from(invoiceSeries)).toEqual([]);
  } finally {
    await empty.close();
  }
  const second = await run(
    "https://olivo.example.test:3443",
    await clockAt("2026-10-18T11:40:00Z"),
  );
  expect(
    { code: second.code, errors: second.errors, childError: second.childError },
    second.output,
  ).toEqual({ code: 0, errors: "", childError: undefined });
  expect(second.output).not.toContain("SYNTHETIC-owner-password");
  const after = JSON.parse(await readFile(join(stateDir, "first-setup.json"), "utf8"));
  expect(after.status).toBe("complete");
  expect(after.frozen).toEqual(before.frozen);
  expect(after.inputs["fiscal-verifactu"]).toEqual(before.inputs["fiscal-verifactu"]);
  expect(after.ownerGeneration).toBe(before.ownerGeneration + 1);
  expect(await readFile(pdfPath)).toEqual(pdf);
  const journal = JSON.parse(
    await readFile(join(stateDir, "module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries).toMatchObject([
    { kind: "wait", targetMs: Date.parse("2026-10-18T11:40:00Z") },
    { kind: "intent", identity: "0CRFW" },
    { kind: "resume", identity: "0CRFW" },
  ]);
  const stored = await openVenueDatabase(target);
  try {
    expect(await readDeploymentEnvironment(stored.venue)).toBe("preproduction");
    const series = await stored.venue.select().from(invoiceSeries);
    expect(series.map((row) => row.code).sort()).toEqual(["A-0CRFW", "FF-0CRFW", "R-0CRFW"]);
    expect(series.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
  } finally {
    await stored.close();
  }
});
