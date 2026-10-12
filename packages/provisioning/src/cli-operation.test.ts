import { expect, it } from "vitest";
import {
  deploymentTableExists,
  locations,
  nodes,
  readDeploymentEnvironment,
  stampDeployment,
  type VenueDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { AppError } from "@waitron/shared";
import { runCli, type CliDeps } from "./cli.js";
import { applyVenue } from "./venue-apply.js";
import { readTenantIdentities } from "./tenant-guard.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const NODE = "d1000000-0000-4000-8000-000000000001";
const ADMIN = "d1000000-0000-4000-8000-000000000002";
const args = [
  "venue",
  "--venue-dir",
  "/unused",
  "--country",
  "ES",
  "--tax-id",
  "B12345678",
  "--legal-name",
  "Restaurant SL",
  "--taxpayer-domicile",
  "Calle Mayor 1, Madrid",
  "--location-name",
  "Restaurant",
  "--territory",
  "ES-common",
  "--locale",
  "es-ES",
  "--operation-description",
  "Venta",
  "--address-line1",
  "Calle Mayor 1",
  "--postal-code",
  "28013",
  "--city",
  "Madrid",
  "--province",
  "Madrid",
  "--time-zone",
  "Europe/Madrid",
  "--day-cutover",
  "06:00",
  "--series-code",
  "A",
  "--rectificative-code",
  "R",
  "--admin-name",
  "Owner",
  "--admin-email",
  "owner@example.test",
  "--yes",
];

it("carries host-selected identities and opaque input into the real initial CLI venue transaction", async () => {
  let held: ModuleOperationInput | undefined;
  const module = fakeModule("test-regime", {
    provisioning: {
      seed: {
        summary: "apply supplied module input",
        run: async (tx, node, operation) => {
          held = operation;
          expect(node.nodeId).toBe(NODE);
          expect(operation).toBeDefined();
          expect(operation!.binding).toEqual({
            module: "test-regime",
            action: "setup",
            eventId: "initial-42",
            sourceId: "paper-42",
            targetNodeId: NODE,
          });
          expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
            operatorId: ADMIN,
          });
          expect(operation!.input).toEqual({ approvedLocationName: "From supplied allocation" });
          await tx.update(locations).set({
            name: (operation!.input as { approvedLocationName: string }).approvedLocationName,
          });
          return "initial-42";
        },
      },
    },
  });
  const lines: string[] = [];
  const deps: CliDeps = {
    io: {
      stdout: (line) => {
        lines.push(line);
      },
      stderr: (line) => {
        lines.push(line);
      },
      prompt: async () => "",
      promptSecret: async () => "",
      clearScreen: () => {},
    },
    env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
    modules: [module],
    applyVenue,
    openVenue: async () =>
      ({ venue: suite.db, node: suite.db, close: async () => {} }) as VenueDatabase,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
    initialVenue: {
      initialNodeId: NODE,
      initialAdministratorId: ADMIN,
      moduleInputs: new Map([
        [
          module.name,
          {
            eventId: "initial-42",
            sourceId: "paper-42",
            input: { approvedLocationName: "From supplied allocation" },
          },
        ],
      ]),
    },
  };
  expect(await runCli(args, deps), lines.join("\n")).toBe(0);
  expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([NODE]);
  expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([ADMIN]);
  expect((await suite.db.select().from(locations)).map((row) => row.name)).toEqual([
    "From supplied allocation",
  ]);
  expect(readOperationAuthority(held!.authority, held!.binding)).toBeUndefined();
  expect(lines.join("\n")).not.toContain("dashPass123");
});

it("keeps the host's target database and selected modules when it supplies initial inputs", async () => {
  const lines: string[] = [];
  const module = fakeModule("test-regime", {
    provisioning: {
      seed: {
        summary: "refuse deliberately",
        run: async () => {
          throw new AppError("provisioning.venue_conflict", { database: "/unused" });
        },
      },
    },
  });
  const deps: CliDeps = {
    io: {
      stdout: (line) => {
        lines.push(line);
      },
      stderr: (line) => {
        lines.push(line);
      },
      prompt: async () => "",
      promptSecret: async () => "",
      clearScreen: () => {},
    },
    env: { WAITRON_ADMIN_PIN: "4321", WAITRON_ADMIN_PASSWORD: "dashPass123" },
    modules: [module],
    applyVenue,
    openVenue: async () =>
      ({ venue: suite.db, node: suite.db, close: async () => {} }) as VenueDatabase,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
    initialVenue: Object.assign(
      { initialNodeId: NODE, initialAdministratorId: ADMIN, moduleInputs: new Map() },
      { db: null, modules: [] },
    ),
  };
  await expect(runCli(args, deps)).resolves.toBe(1);
  expect(lines).toEqual(
    expect.arrayContaining([expect.stringContaining("provisioning.venue_conflict")]),
  );
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(persons)).toEqual([]);
});
