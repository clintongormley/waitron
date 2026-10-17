import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

const execute = promisify(execFile);
let directory: string | undefined;
let binary: string;
beforeAll(async () => {
  const scratch = resolve("../../.superpowers");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "cli-entry-"));
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

it("the installed command refuses a missing host-state directory before creating a venue", async () => {
  const target = join(directory!, "unopened-venue");
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
  const env = {
    ...process.env,
    WAITRON_STATE_DIR: "",
    WAITRON_ENV: "preproduction",
    WAITRON_ADMIN_PIN: "4826",
    WAITRON_ADMIN_PASSWORD: "SYNTHETIC-owner-password",
  };
  const result = await execute(
    process.execPath,
    [
      binary,
      "venue",
      ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]),
      "--yes",
    ],
    { env, timeout: 30_000 },
  ).then(
    (value) => ({ ...value, code: 0 }),
    (error: { stdout: string; stderr: string; code: number }) => error,
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("setup.not_ready {}");
  await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
  expect(result.stdout + result.stderr).not.toContain("SYNTHETIC-owner-password");
});
