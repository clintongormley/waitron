import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { readOperationAuthority } from "@waitron/module";
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

const input = {
  nodeId: NODE,
  administratorId: ADMIN,
  inputs: [
    {
      module: "test-regime",
      eventId: "initial-42",
      sourceId: "paper-42",
      input: { approvedLocationName: "From supplied file" },
    },
  ],
};
function deps(lines: string[], path: string | undefined): CliDeps {
  const module = fakeModule("test-regime", {
    provisioning: {
      seed: {
        summary: "consume supplied setup",
        run: async (tx, _node, operation) => {
          if (operation === undefined)
            throw new AppError("provisioning.initial_operator_required", {});
          expect(readOperationAuthority(operation.authority, operation.binding)).toEqual({
            operatorId: ADMIN,
          });
          expect(operation.binding).toEqual({
            module: "test-regime",
            action: "setup",
            eventId: "initial-42",
            sourceId: "paper-42",
            targetNodeId: NODE,
          });
          await tx.update(locations).set({
            name: (operation.input as { approvedLocationName: string }).approvedLocationName,
          });
          return "file-setup-complete";
        },
      },
    },
  });
  return {
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
    env: {
      WAITRON_ADMIN_PIN: "4321",
      WAITRON_ADMIN_PASSWORD: "dashPass123",
      WAITRON_INITIAL_VENUE_INPUT: path,
    },
    modules: [module],
    applyVenue,
    openVenue: async () =>
      ({ venue: suite.db, node: suite.db, close: async () => {} }) as VenueDatabase,
    readEnvironment: readDeploymentEnvironment,
    readDeploymentTable: deploymentTableExists,
    stampEnvironment: stampDeployment,
    readTenants: readTenantIdentities,
  };
}
async function withFile(content: string, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "waitron-cli-initial-input-"));
  try {
    const path = join(dir, "input.json");
    await writeFile(path, content);
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
it("applies the same planned identities and opaque input read from the configured CLI file", async () => {
  await withFile(JSON.stringify(input), async (path) => {
    const lines: string[] = [];
    expect(await runCli(args, deps(lines, path)), lines.join("\n")).toBe(0);
    expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([NODE]);
    expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([ADMIN]);
    expect((await suite.db.select().from(locations)).map((row) => row.name)).toEqual([
      "From supplied file",
    ]);
    expect(lines.join("\n")).toContain("file-setup-complete");
    expect(lines.join("\n")).not.toContain("dashPass123");
  });
});
it.each([
  "malformed-input-secret",
  JSON.stringify({ ...input, administratorId: "bad" }),
  JSON.stringify({ ...input, inputs: [input.inputs[0], input.inputs[0]] }),
  JSON.stringify(input) + " ".repeat(131073 - JSON.stringify(input).length),
])(
  "refuses malformed or oversized CLI input before the permanent environment stamp %#",
  async (content) => {
    await withFile(content, async (path) => {
      const lines: string[] = [];
      expect(await runCli(args, deps(lines, path))).toBe(1);
      expect(lines.join("\n")).toContain("provisioning.initial_input_invalid");
      expect(lines.join("\n")).not.toContain(content);
      expect(await readDeploymentEnvironment(suite.db)).toBeNull();
      expect(await suite.db.select().from(nodes)).toEqual([]);
      expect(await suite.db.select().from(persons)).toEqual([]);
    });
  },
);
it("refuses a missing configured CLI input before the permanent environment stamp", async () => {
  await withFile(JSON.stringify(input), async (path) => {
    await rm(path);
    const lines: string[] = [];
    expect(await runCli(args, deps(lines, path))).toBe(1);
    expect(lines.join("\n")).toContain("provisioning.initial_input_invalid");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
    expect(await suite.db.select().from(nodes)).toEqual([]);
  });
});

it("accepts a valid input at the whole-file byte bound", async () => {
  await withFile(
    JSON.stringify(input) + " ".repeat(131072 - JSON.stringify(input).length),
    async (path) => {
      const lines: string[] = [];
      expect(await runCli(args, deps(lines, path)), lines.join("\n")).toBe(0);
      expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([NODE]);
    },
  );
});
it.each([undefined, "", "  "])(
  "treats empty input-file configuration as absent %#",
  async (path) => {
    const lines: string[] = [];
    expect(await runCli(args, deps(lines, path))).toBe(1);
    expect(lines.join("\n")).toContain("provisioning.initial_operator_required");
    expect(lines.join("\n")).not.toContain("provisioning.initial_input_invalid");
    expect(await suite.db.select().from(nodes)).toEqual([]);
  },
);
it("rejects input for an unselected module before stamping the target", async () => {
  await withFile(
    JSON.stringify({ ...input, inputs: [{ ...input.inputs[0], module: "unselected-regime" }] }),
    async (path) => {
      const lines: string[] = [];
      expect(await runCli(args, deps(lines, path))).toBe(1);
      expect(lines.join("\n")).toContain("provisioning.initial_input_invalid");
      expect(await readDeploymentEnvironment(suite.db)).toBeNull();
      expect(await suite.db.select().from(nodes)).toEqual([]);
    },
  );
});
