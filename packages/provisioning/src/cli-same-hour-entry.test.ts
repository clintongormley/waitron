import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { invoiceSeries, openVenueDatabase, readDeploymentEnvironment } from "@waitron/db";
import { readTenantIdentities } from "./tenant-guard.js";
import { childEnvironment } from "../test/child-environment.js";

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

/** Copies the migrated test databases into a venue folder of its own and builds a runner for the
 * built command against it. */
async function builtCommand(name: string) {
  const target = join(directory!, name, "venue");
  const stateDir = join(directory!, name, "state");
  const pdfPath = join(directory!, name, "kept.pdf");
  await mkdir(target, { recursive: true });
  const databases = await venue.db.execute<{ name: string; file: string }>("pragma database_list");
  const source = databases.rows.find((row) => row.name === "main")!.file;
  for (const name of ["venue.db", "venue.db-wal", "node.db", "node.db-wal"])
    await copyFile(join(dirname(source), name), join(target, name));
  /** A preload that starts the child's clock at `instant`, with the internet's clock agreeing, and
   * lets a wait pass by moving that clock forward instead of sleeping. */
  async function clockAt(instant: string) {
    const preload = join(directory!, name, `clock-${instant.replaceAll(":", "")}.mjs`);
    await writeFile(
      preload,
      `import https from "node:https";
import timers from "node:timers/promises";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
let passed = 0;
timers.setTimeout = async (ms, value) => {
  passed += ms;
  return value;
};
const RealDate = Date;
https.request = (_url, _options, respond) => {
  const request = new EventEmitter();
  const date = new Date().toUTCString();
  request.end = () => queueMicrotask(() => respond({ statusCode: 200, headers: { date }, destroy() {} }));
  return request;
};
syncBuiltinESMExports();
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [RealDate.parse(${JSON.stringify(instant)}) + passed])); }
  static now() { return RealDate.parse(${JSON.stringify(instant)}) + passed; }
};
Object.defineProperty(performance, "now", { value: () => passed });
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
    "venue-name": "Olivo",
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
          ...childEnvironment(),
          WAITRON_STATE_DIR: stateDir,
          WAITRON_ENV: "preproduction",
          WAITRON_ADMIN_PIN: "4826",
          WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
          WAITRON_INITIAL_VENUE_INPUT: "",
          WAITRON_MANAGEMENT_ORIGIN: origin,
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
      ["Have you kept this recovery pack? [y/N]: ", "yes"],
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
  return { target, stateDir, pdfPath, clockAt, run };
}

it("the built command waits and takes its name in the same run, and completes the setup", async () => {
  const { target, stateDir, pdfPath, clockAt, run } = await builtCommand("complete");
  const result = await run(
    "https://olivo.example.test:3443",
    await clockAt("2026-10-18T11:38:00Z"),
  );
  expect(
    { code: result.code, errors: result.errors, childError: result.childError },
    result.output,
  ).toEqual({ code: 0, errors: "", childError: undefined });
  expect(result.output).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.\nWaiting until 2026-10-18T11:40:00.000Z; it carries on by itself, so keep the command running.\n",
  );
  expect(result.output).not.toContain("SYNTHETIC-owner-password");
  const after = JSON.parse(
    await readFile(join(stateDir, "flows/setup/record.json"), "utf8"),
  ).attempt;
  expect(after.status).toBe("complete");
  expect(after.ownerGeneration).toBe(1);
  await expect(readFile(pdfPath)).resolves.toBeInstanceOf(Buffer);
  const journal = JSON.parse(
    await readFile(join(stateDir, "module-preparation-state.json"), "utf8"),
  );
  expect(journal.revisions.at(-1).value.entries).toMatchObject([
    { kind: "wait", targetMs: Date.parse("2026-10-18T11:40:00Z") },
    { kind: "intent", identity: "0CRFW" },
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

it("the built command waits and takes its name in the same run, and a run after a refusal before activation is refused with nothing changed", async () => {
  const { target, stateDir, pdfPath, clockAt, run } = await builtCommand("refused");
  const first = await run("", await clockAt("2026-10-18T11:38:00Z"));
  expect(
    { code: first.code, errors: first.errors, childError: first.childError },
    first.output,
  ).toEqual({ code: 1, errors: "setup.not_ready {}\n", childError: undefined });
  expect(first.output).toContain(
    "Waiting to confirm the time, so no invoice series is ever repeated.\nWaiting until 2026-10-18T11:40:00.000Z; it carries on by itself, so keep the command running.\n",
  );
  expect(first.output).not.toContain("[no/yes/unknown]");
  // The time check takes its one password before the wait and asks nothing after it; the two
  // later confirmations are the recovery pack's own (staging it, then kept).
  const waitAt = first.output.indexOf("Waiting until");
  const confirmations = (text: string) => text.split("Confirm setup password: ").length - 1;
  expect(confirmations(first.output.slice(0, waitAt))).toBe(1);
  expect(first.output.slice(waitAt)).toContain("box: 2026-10-18T11:40:01.000Z");
  expect(confirmations(first.output.slice(waitAt))).toBe(2);
  const before = JSON.parse(
    await readFile(join(stateDir, "flows/setup/record.json"), "utf8"),
  ).attempt;
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
    await clockAt("2026-10-18T11:40:01Z"),
  );
  expect(
    { code: second.code, errors: second.errors, childError: second.childError },
    second.output,
  ).toEqual({
    code: 1,
    errors:
      "This setup stopped part way, so the command will not carry on with it. Nothing was changed.\nOpen the box's setup page in a browser and choose Start again. It deletes what this setup entered; if the setup already recorded something that must be kept, such as an invoice, or the box cannot confirm that deleting it is safe, it deletes nothing and the page says why. Then run the command again.\nsetup.attempt_conflict {}\n",
    childError: undefined,
  });
  expect(second.output).not.toContain("Confirm setup password: ");
  expect(
    JSON.parse(await readFile(join(stateDir, "flows/setup/record.json"), "utf8")).attempt,
  ).toEqual(before);
  expect(await readFile(pdfPath)).toEqual(pdf);
  const stored = await openVenueDatabase(target);
  try {
    expect(await readTenantIdentities(stored.venue)).toEqual([]);
    expect(await readDeploymentEnvironment(stored.venue)).toBeNull();
    expect(await stored.venue.select().from(invoiceSeries)).toEqual([]);
  } finally {
    await stored.close();
  }
});
