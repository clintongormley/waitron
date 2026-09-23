import { createCloudConnection } from "../src/cloud-client.js";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, hashPassword } from "@waitron/identity";
import { provisionVenue, venueModuleConfig } from "../src/provision.js";
import { startServer } from "../src/boot.js";

// The caller owns this disposable directory; this fixture never selects a developer database.
const root = resolve(process.env.CLOUD_TEST_ROOT ?? "");
if (
  !root.startsWith(resolve(tmpdir()) + sep) ||
  !root.includes("cloud-integration-") ||
  !process.env.CLOUD_TEST_ORIGIN
)
  throw new Error("Disposable Cloud fixture configuration required");
await mkdir(root, { recursive: true, mode: 0o700 });
const envPath = join(root, "fixture-env.json");
let env: NodeJS.ProcessEnv;
const savedEnv = await readFile(envPath, "utf8").catch((error: unknown) => {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  return undefined;
});
if (savedEnv !== undefined) {
  env = JSON.parse(savedEnv) as NodeJS.ProcessEnv;
} else {
  const venueDir = join(root, "venue"),
    migrationsRoot = join(root, "migrations");
  const sets = manifestSets(),
    source = migrationOptionsFor(sets, null);
  await applyMigrations(venueDir, source);
  for (const [index, set] of sets.entries())
    await cp(source[index]!.migrationsFolder, join(migrationsRoot, set.name), { recursive: true });
  const store = await openVenueDatabase(venueDir);
  let result;
  try {
    result = await provisionVenue(
      {
        ownerDb: store.venue,
        moduleConfig: venueModuleConfig({ overrides: new Map() }, "ES-common"),
        database: "cloud-integration",
        stateDir: root,
      },
      {
        environment: "preproduction",
        venue: {
          country: "ES",
          taxId: "73000001K",
          legalName: "Cloud Test SL",
          location: {
            name: "Cloud Test Venue",
            fiscalTerritory: "ES-common",
            invoiceLocales: ["es-ES"],
            operationDescription: "Venta de prueba",
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          tillName: "Test till",
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Cloud test manager",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword("Local integration password"),
            email: "owner@example.test",
            locale: "en-GB",
          },
        },
      },
    );
  } finally {
    await store.close();
  }
  const reserve = createServer();
  await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
  const address = reserve.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((r) => reserve.close(() => r()));
  env = {
    WAITRON_ENV: "dev",
    WAITRON_ONBOARDING_INTENT: "demo",
    WAITRON_STATE_DIR: root,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(address.port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_MANAGEMENT_RP_ID: "127.0.0.1",
    WAITRON_MANAGEMENT_ORIGIN: `http://127.0.0.1:${address.port}`,
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_TILL_LOCATION_ID: result.locationId,
    WAITRON_TILL_NODE_ID: result.nodeId,
    WAITRON_TILL_TILL_ID: result.tillId,
    WAITRON_TILL_SERIES_ID: result.seriesIds[0],
    WAITRON_CLOUD_ORIGIN: process.env.CLOUD_TEST_ORIGIN,
    WAITRON_DASHBOARD_APP_DIR: resolve(import.meta.dirname, "../../dashboard/dist"),
  };
  await writeFile(envPath, JSON.stringify(env), { mode: 0o600 });
}
const server = await startServer(env);
await writeFile(
  join(root, "ready.json"),
  JSON.stringify({
    origin: env.WAITRON_MANAGEMENT_ORIGIN,
    localVenueId: env.WAITRON_TILL_LOCATION_ID,
  }),
  { mode: 0o600 },
);
// Only the parent integration process can submit synthetic adapter observations over IPC.
const cloud = createCloudConnection({
  stateDir: root,
  origin: env.WAITRON_CLOUD_ORIGIN!,
  localVenueId: env.WAITRON_TILL_LOCATION_ID!,
  environment: "test",
});
process.on("message", (message: unknown) => {
  if (
    !message ||
    typeof message !== "object" ||
    !("report" in message) ||
    !Array.isArray(message.report)
  )
    return;
  void cloud.report(message.report).then(
    (status) => process.send?.({ status }),
    () => process.send?.({ error: "report_failed" }),
  );
});
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (!closing) {
      closing = true;
      void server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    }
  });
