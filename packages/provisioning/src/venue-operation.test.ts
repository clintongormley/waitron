import { describe, expect, it } from "vitest";
import { locations, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ProvisionedNode,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const request: VenueRequest = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Restaurant SL",
  location: {
    name: "Restaurant",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta",
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Owner",
    pinHash: "hash",
    passwordHash: "hash",
    email: "owner@example.test",
  },
};
const input = { allocation: { opaque: true }, operatorId: "submitted-other-person" };
const setup = { eventId: "setup-1", sourceId: "new-venue-1", input };

function regime(
  run: (node: ProvisionedNode, operation: ModuleOperationInput | undefined) => Promise<string>,
) {
  return fakeModule("test-regime", {
    provisioning: {
      seed: {
        summary: "set up the regime",
        run: async (_tx, node, operation) => run(node, operation),
      },
    },
  });
}

describe("fresh setup authority carried into a module seed", () => {
  it("uses the host's previously chosen target so outside consumption can name it before setup writes", async () => {
    const target = "c0000000-0000-4000-8000-000000000007";
    const module = regime(async (node, operation) => {
      expect(node.nodeId).toBe(target);
      expect(operation!.binding.targetNodeId).toBe(target);
      return "preselected target";
    });
    const result = await applyVenue(planVenue(request, [module]), {
      db: suite.db,
      modules: [module],
      initialNodeId: target,
      moduleInputs: new Map([[module.name, setup]]),
    });
    expect(result.nodeId).toBe(target);
    expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([target]);
  });
  it("uses the host's previously chosen new account for the outside operator attribution", async () => {
    const adminId = "c0000000-0000-4000-8000-000000000008";
    const module = regime(async (_node, operation) => {
      expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
        operatorId: adminId,
      });
      return "preselected operator";
    });
    await applyVenue(planVenue(request, [module]), {
      db: suite.db,
      modules: [module],
      initialAdministratorId: adminId,
      moduleInputs: new Map([[module.name, setup]]),
    });
    expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([adminId]);
  });
  it("binds the new account and generated node, carrying module input without interpreting it", async () => {
    let retained: ModuleOperationInput | undefined;
    const module = regime(async (node, operation) => {
      expect(operation).toBeDefined();
      retained = operation;
      expect(operation!.binding).toEqual({
        module: "test-regime",
        action: "setup",
        eventId: "setup-1",
        sourceId: "new-venue-1",
        targetNodeId: node.nodeId,
      });
      expect(operation!.input).toBe(input);
      const [admin] = await suite.db.select().from(persons);
      expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
        operatorId: admin!.id,
      });
      expect(admin!.id).not.toBe(input.operatorId);
      return "module established";
    });
    const result = await applyVenue(planVenue(request, [module]), {
      db: suite.db,
      modules: [module],
      moduleInputs: new Map([[module.name, setup]]),
    });
    expect(result.seeded).toEqual([{ module: module.name, report: "module established" }]);
    expect(readOperationAuthority(retained!.authority, retained!.binding)).toBeUndefined();
    expect((await suite.db.select().from(nodes)).map((row) => row.id)).toEqual([result.nodeId]);
  });

  it("refuses to attribute setup to an administrator retained in a restored database", async () => {
    await suite.db
      .insert(persons)
      .values({ displayName: "Archived owner", role: "admin", passwordHash: "hash" });
    let entered = false;
    const module = regime(async () => {
      entered = true;
      return "unexpected";
    });
    await expect(
      applyVenue(planVenue(request, [module]), {
        db: suite.db,
        modules: [module],
        moduleInputs: new Map([[module.name, setup]]),
      }),
    ).rejects.toMatchObject({ code: "provisioning.initial_operator_required" });
    expect(entered).toBe(false);
    expect(await suite.db.select().from(tenants)).toEqual([]);
    expect(await suite.db.select().from(nodes)).toEqual([]);
    expect((await suite.db.select().from(persons)).map((row) => row.displayName)).toEqual([
      "Archived owner",
    ]);
  });

  it("revokes authority and rolls back the venue when its seed refuses", async () => {
    let retained: ModuleOperationInput | undefined;
    const module = regime(async (_node, operation) => {
      retained = operation;
      throw new Error("module refused");
    });
    await expect(
      applyVenue(planVenue(request, [module]), {
        db: suite.db,
        modules: [module],
        moduleInputs: new Map([[module.name, setup]]),
      }),
    ).rejects.toThrow("module refused");
    expect(retained).toBeDefined();
    expect(readOperationAuthority(retained!.authority, retained!.binding)).toBeUndefined();
    for (const table of [persons, tenants, locations, nodes])
      expect(await suite.db.select().from(table)).toEqual([]);
  });

  it("does not fabricate input for a module the host did not supply", async () => {
    const module = regime(async (_node, operation) => {
      expect(operation).toBeUndefined();
      return "no input";
    });
    const result = await applyVenue(planVenue(request, [module]), {
      db: suite.db,
      modules: [module],
      moduleInputs: new Map([["other-regime", setup]]),
    });
    expect(result.seeded).toEqual([{ module: module.name, report: "no input" }]);
  });

  it("does not grant fresh authority on an idempotent setup retry", async () => {
    let count = 0;
    const module = regime(async (_node, operation) => {
      expect(operation).toBeDefined();
      count++;
      return "established";
    });
    const deps = { db: suite.db, modules: [module], moduleInputs: new Map([[module.name, setup]]) };
    const first = await applyVenue(planVenue(request, [module]), deps);
    const second = await applyVenue(planVenue(request, [module]), deps);
    expect(second.nodeId).toBe(first.nodeId);
    expect(count).toBe(1);
    expect(second.seeded).toEqual([]);
  });

  it.each([{ role: "staff" as const }, { status: "suspended" as const }])(
    "rechecks the newly created account before a later module receives authority %#",
    async (change) => {
      const first = regime(async () => {
        await suite.db.update(persons).set(change);
        return "first";
      });
      const second = fakeModule("second-regime", {
        provisioning: {
          seed: {
            summary: "second",
            run: async () => {
              throw new Error("must not run");
            },
          },
        },
      });
      const modules = [first, second];
      await expect(
        applyVenue(planVenue(request, modules), {
          db: suite.db,
          modules,
          moduleInputs: new Map([[second.name, setup]]),
        }),
      ).rejects.toMatchObject({ code: "provisioning.initial_operator_required" });
      expect(await suite.db.select().from(persons)).toEqual([]);
    },
  );

  it.each(["initialNodeId", "initialAdministratorId"] as const)(
    "refuses a malformed %s before creating any account or node",
    async (key) => {
      const module = regime(async () => "must not run");
      await expect(
        applyVenue(planVenue(request, [module]), {
          db: suite.db,
          modules: [module],
          [key]: "not-an-id",
        }),
      ).rejects.toMatchObject({ code: "shared.invalid_id" });
      expect(await suite.db.select().from(persons)).toEqual([]);
      expect(await suite.db.select().from(nodes)).toEqual([]);
    },
  );

  it("snapshots setup event and source before awaiting another module", async () => {
    const supplied = { ...setup };
    const inputs = new Map([["second-regime", supplied]]);
    const first = regime(async () => {
      supplied.eventId = "caller-changed";
      inputs.delete("second-regime");
      return "first";
    });
    const second = fakeModule("second-regime", {
      provisioning: {
        seed: {
          summary: "second",
          run: async (_tx, _node, operation) => {
            expect(operation!.binding.eventId).toBe("setup-1");
            expect(operation!.binding.sourceId).toBe("new-venue-1");
            return "second";
          },
        },
      },
    });
    const modules = [first, second];
    expect(
      (
        await applyVenue(planVenue(request, modules), {
          db: suite.db,
          modules,
          moduleInputs: inputs,
        })
      ).seeded,
    ).toEqual([
      { module: first.name, report: "first" },
      { module: second.name, report: "second" },
    ]);
  });
});
