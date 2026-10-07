import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  floorZones,
  locations,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  createDepartment,
  createServiceZone,
  getOrderServiceContext,
  recordOrderServiceContext,
} from "./operations.js";
import { setProfileServiceScope } from "./profile-access.js";
import * as service from "./index.js";
import { departments, orderServiceContexts } from "./schema/service.js";
import { departmentTransferRequests } from "./schema/department-transfers.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

async function venue() {
  return withTransaction(suite.db, async (tx) => {
    const [place] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const cfg = { locationId: locationId(place!.id) };
    const a = await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "table_tab" });
    const b = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    const az = await createServiceZone(tx, cfg, { name: "Deli counter", departmentId: a.id });
    const bz = await createServiceZone(tx, cfg, { name: "Restaurant counter", departmentId: b.id });
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: randomUUID(), formFactor: "till", capabilities: ["take-orders"] })
      .returning();
    await setProfileServiceScope(tx, cfg, profile!.id, {
      departmentId: b.id,
      allowedZoneIds: null,
      startingZoneId: bz.id,
    });
    const [tab] = await tx
      .insert(workingOrders)
      .values({ source: "operator_script", locationId: cfg.locationId, orderNumber: 1 })
      .returning();
    await recordOrderServiceContext(tx, cfg, tab!.id, az.id);
    return { cfg, a: a.id, b: b.id, az: az.id, bz: bz.id, profile: profile!.id, tab: tab!.id };
  });
}

describe("departmental tab transfers", () => {
  it("keeps responsibility at the source while a durable directional request is pending", async () => {
    const v = await venue();
    await withTransaction(suite.db, (tx) =>
      service.setDepartmentTransferSettings(tx, v.cfg, v.b, {
        receivingProfileId: v.profile,
        destinationDepartmentIds: [],
      }),
    );
    await withTransaction(suite.db, (tx) =>
      service.setDepartmentTransferSettings(tx, v.cfg, v.a, {
        receivingProfileId: null,
        destinationDepartmentIds: [v.b],
      }),
    );
    const request = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    expect(request).toMatchObject({
      tabId: v.tab,
      sourceDepartmentId: v.a,
      destinationDepartmentId: v.b,
      senderId: "sender",
      status: "pending",
      revision: 0,
    });
    await withTransaction(suite.db, async (tx) => {
      expect(await getOrderServiceContext(tx, v.cfg, v.tab)).toEqual({
        zoneId: v.az,
        departmentId: v.a,
        serviceMode: "table_tab",
      });
      const [tab] = await tx.select().from(workingOrders).where(eq(workingOrders.id, v.tab));
      expect(tab).toMatchObject({ status: "open", revision: 0 });
      expect(await service.readDepartmentTransferSettings(tx, v.cfg, v.a)).toEqual({
        departmentId: v.a,
        receivingProfileId: null,
        destinationDepartmentIds: [v.b],
      });
      expect(await service.listDepartmentTransfers(tx, v.cfg, v.b)).toEqual([request]);
    });
  });
  async function ready() {
    const v = await venue();
    await withTransaction(suite.db, async (tx) => {
      await service.setDepartmentTransferSettings(tx, v.cfg, v.b, {
        receivingProfileId: v.profile,
        destinationDepartmentIds: [],
      });
      await service.setDepartmentTransferSettings(tx, v.cfg, v.a, {
        receivingProfileId: null,
        destinationDepartmentIds: [v.b],
      });
    });
    return v;
  }

  it("refuses the opposite direction even when both departments have receiving desks", async () => {
    const v = await ready();
    await withTransaction(suite.db, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till" })
        .returning();
      await setProfileServiceScope(tx, v.cfg, profile!.id, {
        departmentId: v.a,
        allowedZoneIds: null,
        startingZoneId: v.az,
      });
      await service.setDepartmentTransferSettings(tx, v.cfg, v.a, {
        receivingProfileId: profile!.id,
        destinationDepartmentIds: [v.b],
      });
    });
    await withTransaction(suite.db, (tx) =>
      tx
        .update(orderServiceContexts)
        .set({ zoneId: v.bz, departmentId: v.b })
        .where(eq(orderServiceContexts.workingOrderId, v.tab)),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.a, {
          departmentId: v.b,
          personId: "sender",
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.not_allowed" });
    expect(
      await suite.db
        .select()
        .from(departmentTransferRequests)
        .where(eq(departmentTransferRequests.tabId, v.tab)),
    ).toEqual([]);
  });

  it.each(["sender", "missing", "inactive", "desk", "retired", "scope", "closed"] as const)(
    "refuses a request with %s no longer valid",
    async (kind) => {
      const v = await ready();
      await withTransaction(suite.db, async (tx) => {
        if (kind === "inactive")
          await tx.update(departments).set({ active: false }).where(eq(departments.id, v.b));
        if (kind === "desk")
          await service.setDepartmentTransferSettings(tx, v.cfg, v.b, {
            receivingProfileId: null,
            destinationDepartmentIds: [],
          });
        if (kind === "retired")
          await tx
            .update(deviceProfiles)
            .set({ retiredAt: new Date().toISOString() })
            .where(eq(deviceProfiles.id, v.profile));
        if (kind === "scope")
          await setProfileServiceScope(tx, v.cfg, v.profile, {
            departmentId: v.a,
            allowedZoneIds: null,
            startingZoneId: v.az,
          });
        if (kind === "closed")
          await tx
            .update(workingOrders)
            .set({ status: "abandoned" })
            .where(eq(workingOrders.id, v.tab));
      });
      const destination = kind === "missing" ? randomUUID() : v.b;
      const sender = kind === "sender" ? v.b : v.a;
      const code =
        kind === "closed"
          ? "department_transfer.tab_unavailable"
          : kind === "sender"
            ? "department_transfer.not_allowed"
            : kind === "missing" || kind === "inactive"
              ? "department.not_found"
              : "department_transfer.desk_unavailable";
      await expect(
        withTransaction(suite.db, (tx) =>
          service.requestDepartmentTransfer(tx, v.cfg, v.tab, destination, {
            departmentId: sender,
            personId: "sender",
          }),
        ),
      ).rejects.toMatchObject({ code });
      expect(
        await suite.db
          .select()
          .from(departmentTransferRequests)
          .where(eq(departmentTransferRequests.tabId, v.tab)),
      ).toEqual([]);
    },
  );

  it("refuses a second pending destination and allows another request after withdrawal", async () => {
    const v = await ready();
    const request = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
          departmentId: v.a,
          personId: "sender",
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.pending" });
    expect(service).toHaveProperty("withdrawDepartmentTransfer", expect.any(Function));
    await expect(
      withTransaction(suite.db, (tx) =>
        service.withdrawDepartmentTransfer(tx, v.cfg, request.id, {
          departmentId: v.b,
          personId: "other",
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.not_allowed" });
    const withdrawn = await withTransaction(suite.db, (tx) =>
      service.withdrawDepartmentTransfer(tx, v.cfg, request.id, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    expect(withdrawn).toMatchObject({ status: "withdrawn", resolvedBy: "sender", revision: 1 });
    expect(withdrawn.resolvedAt).toEqual(expect.any(String));
    await expect(
      withTransaction(suite.db, (tx) =>
        service.withdrawDepartmentTransfer(tx, v.cfg, request.id, {
          departmentId: v.a,
          personId: "sender",
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.not_pending" });
    const next = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    expect(next.id).not.toBe(request.id);
    expect(
      await withTransaction(suite.db, (tx) => service.listDepartmentTransfers(tx, v.cfg, v.b)),
    ).toEqual([next]);
  });

  it.each([
    "wrong_department",
    "retired",
    "shared",
    "self",
    "missing",
    "inactive",
    "foreign",
  ] as const)("refuses %s settings and retains the previous configuration", async (kind) => {
    const v = await ready();
    const before = await withTransaction(suite.db, (tx) =>
      service.readDepartmentTransferSettings(tx, v.cfg, v.b),
    );
    let target = v.a;
    await withTransaction(suite.db, async (tx) => {
      if (kind === "retired")
        await tx
          .update(deviceProfiles)
          .set({ retiredAt: new Date().toISOString() })
          .where(eq(deviceProfiles.id, v.profile));
      if (kind === "shared")
        await tx
          .update(deviceProfiles)
          .set({ formFactor: "kds" })
          .where(eq(deviceProfiles.id, v.profile));
      if (kind === "inactive")
        await tx.update(departments).set({ active: false }).where(eq(departments.id, v.a));
      if (kind === "foreign") {
        const [other] = await tx
          .insert(locations)
          .values({
            name: randomUUID(),
            invoiceLocales: ["en-GB"],
            operationDescription: "Hospitality",
          })
          .returning();
        const foreign = await createDepartment(
          tx,
          { locationId: locationId(other!.id) },
          { name: "Other venue", defaultServiceMode: "table_tab" },
        );
        target = foreign.id;
      }
    });
    const profileId =
      kind === "wrong_department"
        ? await withTransaction(suite.db, async (tx) => {
            const [p] = await tx
              .insert(deviceProfiles)
              .values({ name: randomUUID(), formFactor: "till" })
              .returning();
            await setProfileServiceScope(tx, v.cfg, p!.id, {
              departmentId: v.a,
              allowedZoneIds: null,
              startingZoneId: v.az,
            });
            return p!.id;
          })
        : v.profile;
    if (kind === "self") target = v.b;
    if (kind === "missing") target = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        service.setDepartmentTransferSettings(tx, v.cfg, v.b, {
          receivingProfileId: profileId,
          destinationDepartmentIds: [target],
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.settings_invalid" });
    expect(
      await withTransaction(suite.db, (tx) =>
        service.readDepartmentTransferSettings(tx, v.cfg, v.b),
      ),
    ).toEqual(before);
  });

  it("refuses a desk whose permitted zones have all been deactivated", async () => {
    const v = await ready();
    await withTransaction(suite.db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, v.bz)),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
          departmentId: v.a,
          personId: "sender",
        }),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.desk_unavailable" });
  });
  it("allows deleting an unused receiving profile and keeps the pending request", async () => {
    const v = await ready();
    const request = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.delete(deviceProfiles).where(eq(deviceProfiles.id, v.profile)),
      ),
    ).resolves.toBeDefined();
    expect(
      await withTransaction(suite.db, (tx) =>
        service.readDepartmentTransferSettings(tx, v.cfg, v.b),
      ),
    ).toEqual({ departmentId: v.b, receivingProfileId: null, destinationDepartmentIds: [] });
    expect(
      await withTransaction(suite.db, (tx) => service.listDepartmentTransfers(tx, v.cfg, v.b)),
    ).toEqual([request]);
  });
});
