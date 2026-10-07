import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  addProductToMenu,
  createCatalogue,
  createProduct,
  units,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  billPayments,
  billPaymentRefunds,
  diningTables,
  parties,
  kitchenStations,
  workingOrderLines,
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
import { departments, orderServiceContexts, workingLineContexts } from "./schema/service.js";
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
  it("offers only active usable receiving profiles in this department", async () => {
    const v = await venue();
    await withTransaction(suite.db, async (tx) => {
      for (const [name, formFactor, departmentId, retired] of [
        ["Foreign desk", "till", v.a, false],
        ["Retired desk", "till", v.b, true],
        ["Kitchen display", "kds", v.b, false],
      ] as const) {
        const [profile] = await tx
          .insert(deviceProfiles)
          .values({
            name: `${name}-${v.tab}`,
            formFactor,
          })
          .returning();
        if (formFactor !== "kds")
          await setProfileServiceScope(tx, v.cfg, profile!.id, {
            departmentId,
            allowedZoneIds: null,
            startingZoneId: departmentId === v.a ? v.az : v.bz,
          });
        if (retired)
          await tx
            .update(deviceProfiles)
            .set({ retiredAt: "2026-10-07T08:00:00.000Z" })
            .where(eq(deviceProfiles.id, profile!.id));
      }
      const [profile] = await tx
        .select()
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, v.profile));
      expect(await service.listDepartmentTransferProfiles(tx, v.cfg, v.b)).toEqual([
        { id: v.profile, name: profile!.name },
      ]);
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, v.bz));
      expect(await service.listDepartmentTransferProfiles(tx, v.cfg, v.b)).toEqual([]);
    });
  });

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

  async function pending() {
    const v = await ready();
    const request = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    return { ...v, request };
  }
  const receiver = (v: Awaited<ReturnType<typeof pending>>) => ({
    departmentId: v.b,
    personId: "receiver",
    profileId: v.profile,
  });
  const accept = (
    v: Awaited<ReturnType<typeof pending>>,
    revision = 0,
    zoneId = v.bz,
    tableId: string | null = null,
  ) =>
    withTransaction(suite.db, (tx) =>
      service.acceptDepartmentTransfer(tx, v.cfg, v.request.id, receiver(v), {
        tabRevision: revision,
        zoneId,
        tableId,
      }),
    );

  it("accepts once against the latest revision while retaining ordered line values and source kitchen instructions", async () => {
    const v = await pending();
    const before = await withTransaction(suite.db, async (tx) => {
      const [station] = await tx
        .insert(kitchenStations)
        .values({ locationId: v.cfg.locationId, name: "Source kitchen" })
        .returning();
      const [unit] = await tx
        .insert(units)
        .values({ name: { en: "each" }, abbreviation: { en: "ea" }, precision: 0, seedKey: "each" })
        .returning();
      const menu = await createCatalogue(tx, { name: "Source menu" });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "Soup",
        pricingUnit: "each",
        unitPrice: "2.35",
        vatClass: "general",
      });
      const offer = await addProductToMenu(tx, { menuId: menu.id, productId: product.id });
      const [line] = await tx
        .insert(workingOrderLines)
        .values({
          workingOrderId: v.tab,
          lineNo: 1,
          name: "Staff soup",
          kitchenName: "Kitchen broth",
          descriptions: { "en-GB": "Customer soup" },
          quantity: 1000,
          unitPriceGross: 235,
          vatClass: "general",
          lineTotal: 235,
          makeAtStationId: station!.id,
          note: "Pickup at deli",
          sentAt: "2026-10-07T08:00:00.000Z",
        })
        .returning();
      await tx.update(workingOrders).set({ revision: 3 }).where(eq(workingOrders.id, v.tab));
      const [lineContext] = await tx
        .insert(workingLineContexts)
        .values({
          workingOrderLineId: line!.id,
          menuItemId: offer.id,
          menuId: menu.id,
          menuName: "Source menu",
          departmentId: v.a,
          departmentName: "Deli",
          categoryName: "Soup course",
          unitId: unit!.id,
          unitName: { en: "ea" },
          unitPrecision: 0,
          soldInEach: true,
          vatClass: "general",
        })
        .returning();
      return { line: line!, context: lineContext! };
    });
    expect(service).toHaveProperty("acceptDepartmentTransfer", expect.any(Function));
    await expect(accept(v, 0)).rejects.toMatchObject({
      code: "working_order.out_of_date",
      params: { workingOrderId: v.tab, revision: 3 },
    });
    const result = await accept(v, 3);
    expect(result).toMatchObject({
      status: "accepted",
      resolvedBy: "receiver",
      destinationZoneId: v.bz,
      revision: 1,
    });
    expect(result.resolvedAt).toEqual(expect.any(String));
    expect(
      await withTransaction(suite.db, (tx) => getOrderServiceContext(tx, v.cfg, v.tab)),
    ).toEqual({ zoneId: v.bz, departmentId: v.b, serviceMode: "table_tab" });
    const [tab] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, v.tab));
    expect(tab).toMatchObject({
      status: "open",
      revision: 4,
      partyId: null,
      deliveryTableId: null,
    });
    expect(
      await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, v.tab)),
    ).toEqual([before.line]);
    expect(
      await suite.db
        .select()
        .from(workingLineContexts)
        .where(eq(workingLineContexts.workingOrderLineId, before.line.id)),
    ).toEqual([before.context]);
    await expect(accept(v, 4)).rejects.toMatchObject({ code: "department_transfer.not_pending" });
    expect(
      await withTransaction(suite.db, (tx) => service.listDepartmentTransfers(tx, v.cfg, v.b)),
    ).toEqual([]);
  });

  it("admits a placed outstanding tab without reopening it", async () => {
    const v = await ready();
    await withTransaction(suite.db, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, v.tab)),
    );
    const request = await withTransaction(suite.db, (tx) =>
      service.requestDepartmentTransfer(tx, v.cfg, v.tab, v.b, {
        departmentId: v.a,
        personId: "sender",
      }),
    );
    await accept({ ...v, request });
    const [tab] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, v.tab));
    expect(tab).toMatchObject({ status: "placed", revision: 1 });
  });

  it.each([
    "payment_mark",
    "partial_card",
    "closed",
    "sender_changed",
    "wrong_zone",
    "disabled_zone",
    "wrong_profile",
    "retired_profile",
    "desk_changed",
    "party",
  ] as const)(
    "refuses acceptance after %s without changing responsibility or request",
    async (kind) => {
      const v = await pending();
      let zoneId = v.bz;
      let actor = receiver(v);
      await withTransaction(suite.db, async (tx) => {
        if (kind === "payment_mark")
          await tx
            .update(workingOrders)
            .set({ paymentAttemptAt: new Date().toISOString() })
            .where(eq(workingOrders.id, v.tab));
        if (kind === "partial_card")
          await tx.insert(billPayments).values({
            workingOrderId: v.tab,
            submissionId: randomUUID(),
            fingerprint: "test",
            kind: "contribution",
            method: "card",
            applied: 100,
            state: "pending",
            requestedBy: "sender",
            source: "operator_script",
          });
        if (kind === "closed")
          await tx
            .update(workingOrders)
            .set({ status: "abandoned" })
            .where(eq(workingOrders.id, v.tab));
        if (kind === "sender_changed")
          await tx
            .update(orderServiceContexts)
            .set({ departmentId: v.b, zoneId: v.bz })
            .where(eq(orderServiceContexts.workingOrderId, v.tab));
        if (kind === "disabled_zone") {
          await createServiceZone(tx, v.cfg, {
            name: "Other active receiving zone",
            departmentId: v.b,
          });
          await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, v.bz));
        }
        if (kind === "retired_profile")
          await tx
            .update(deviceProfiles)
            .set({ retiredAt: new Date().toISOString() })
            .where(eq(deviceProfiles.id, v.profile));
        if (kind === "desk_changed")
          await service.setDepartmentTransferSettings(tx, v.cfg, v.b, {
            receivingProfileId: null,
            destinationDepartmentIds: [],
          });
        if (kind === "party") {
          const [party] = await tx.insert(parties).values({ openedBy: "sender" }).returning();
          await tx
            .update(workingOrders)
            .set({ partyId: party!.id })
            .where(eq(workingOrders.id, v.tab));
        }
      });
      if (kind === "wrong_zone") zoneId = v.az;
      if (kind === "wrong_profile") actor = { ...actor, profileId: randomUUID() };
      const [before] = await suite.db
        .select()
        .from(orderServiceContexts)
        .where(eq(orderServiceContexts.workingOrderId, v.tab));
      const code =
        kind === "payment_mark" || kind === "partial_card"
          ? "order.payment_in_flight"
          : kind === "closed"
            ? "department_transfer.tab_unavailable"
            : kind === "party"
              ? "department_transfer.structure_unsupported"
              : kind === "sender_changed" ||
                  kind === "wrong_profile" ||
                  kind === "retired_profile" ||
                  kind === "desk_changed"
                ? "department_transfer.not_allowed"
                : "department_transfer.destination_invalid";
      await expect(
        withTransaction(suite.db, (tx) =>
          service.acceptDepartmentTransfer(tx, v.cfg, v.request.id, actor, {
            tabRevision: 0,
            zoneId,
            tableId: null,
          }),
        ),
      ).rejects.toMatchObject({ code });
      expect(
        await suite.db
          .select()
          .from(orderServiceContexts)
          .where(eq(orderServiceContexts.workingOrderId, v.tab)),
      ).toEqual([before]);
      expect(
        await suite.db
          .select()
          .from(departmentTransferRequests)
          .where(eq(departmentTransferRequests.id, v.request.id)),
      ).toEqual([v.request]);
    },
  );

  it("assigns an explicitly chosen active destination table without moving a party", async () => {
    const v = await pending();
    const [table] = await withTransaction(suite.db, (tx) =>
      tx
        .insert(diningTables)
        .values({ locationId: v.cfg.locationId, zoneId: v.bz, label: randomUUID() })
        .returning(),
    );
    await accept(v, 0, v.bz, table!.id);
    const [tab] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, v.tab));
    expect(tab).toMatchObject({ deliveryTableId: table!.id, partyId: null, revision: 1 });
  });
  it("refuses a table in another zone", async () => {
    const v = await pending();
    const [table] = await withTransaction(suite.db, (tx) =>
      tx
        .insert(diningTables)
        .values({ locationId: v.cfg.locationId, zoneId: v.az, label: randomUUID() })
        .returning(),
    );
    await expect(accept(v, 0, v.bz, table!.id)).rejects.toMatchObject({
      code: "department_transfer.destination_invalid",
      params: { field: "tableId" },
    });
  });

  it("serializes two receivers so exactly one accepts", async () => {
    const v = await pending();
    const results = await Promise.allSettled([accept(v), accept(v)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: "department_transfer.not_pending" });
    const [tab] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, v.tab));
    expect(tab!.revision).toBe(1);
  });
  it("serializes withdrawal with acceptance without two resolutions", async () => {
    const v = await pending();
    const results = await Promise.allSettled([
      withTransaction(suite.db, (tx) =>
        service.withdrawDepartmentTransfer(tx, v.cfg, v.request.id, {
          departmentId: v.a,
          personId: "sender",
        }),
      ),
      accept(v),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({ code: "department_transfer.not_pending" });
    const [request] = await suite.db
      .select()
      .from(departmentTransferRequests)
      .where(eq(departmentTransferRequests.id, v.request.id));
    expect(request!.status).toBe("withdrawn");
    expect(
      await withTransaction(suite.db, (tx) => getOrderServiceContext(tx, v.cfg, v.tab)),
    ).toMatchObject({ departmentId: v.a, zoneId: v.az });
  });
  it("requires a decline reason and records the receiving person without moving the tab", async () => {
    const v = await pending();
    expect(service).toHaveProperty("declineDepartmentTransfer", expect.any(Function));
    await expect(
      withTransaction(suite.db, (tx) =>
        service.declineDepartmentTransfer(tx, v.cfg, v.request.id, receiver(v), "  "),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.reason_required" });
    const result = await withTransaction(suite.db, (tx) =>
      service.declineDepartmentTransfer(tx, v.cfg, v.request.id, receiver(v), "  Closing soon  "),
    );
    expect(result).toMatchObject({
      status: "declined",
      reason: "Closing soon",
      resolvedBy: "receiver",
      revision: 1,
    });
    expect(
      await withTransaction(suite.db, (tx) => getOrderServiceContext(tx, v.cfg, v.tab)),
    ).toMatchObject({ departmentId: v.a });
    await expect(accept(v)).rejects.toMatchObject({ code: "department_transfer.not_pending" });
  });

  it("refuses acceptance while a received card payment has a pending refund", async () => {
    const v = await pending();
    await withTransaction(suite.db, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: v.tab,
          submissionId: randomUUID(),
          fingerprint: "test",
          kind: "contribution",
          method: "card",
          applied: 100,
          state: "received",
          receivedAt: "2026-10-07T08:00:00.000Z",
          requestedBy: "sender",
          source: "operator_script",
        })
        .returning();
      await tx.insert(billPaymentRefunds).values({
        billPaymentId: payment!.id,
        submissionId: randomUUID(),
        fingerprint: "test",
        appliedAmount: 100,
        reason: "Return",
        authorizedBy: "manager",
        requestedBy: "sender",
        source: "operator_script",
        state: "pending",
      });
    });
    await expect(accept(v)).rejects.toMatchObject({
      code: "bill.refund_in_progress",
      params: { workingOrderId: v.tab },
    });
    expect(
      await withTransaction(suite.db, (tx) => getOrderServiceContext(tx, v.cfg, v.tab)),
    ).toMatchObject({ departmentId: v.a, zoneId: v.az });
    expect(
      await suite.db
        .select()
        .from(departmentTransferRequests)
        .where(eq(departmentTransferRequests.id, v.request.id)),
    ).toEqual([v.request]);
  });

  it("refuses a receiver from another department and an unknown request", async () => {
    const v = await pending();
    await expect(
      withTransaction(suite.db, (tx) =>
        service.acceptDepartmentTransfer(
          tx,
          v.cfg,
          v.request.id,
          { ...receiver(v), departmentId: v.a },
          { tabRevision: 0, zoneId: v.bz, tableId: null },
        ),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.not_allowed" });
    await expect(
      withTransaction(suite.db, (tx) =>
        service.declineDepartmentTransfer(tx, v.cfg, randomUUID(), receiver(v), "Closing soon"),
      ),
    ).rejects.toMatchObject({ code: "department_transfer.not_found" });
  });

  it.each(["missing", "disabled"])(
    "refuses a %s destination table without accepting",
    async (kind) => {
      const v = await pending();
      let tableId: string = randomUUID();
      if (kind === "disabled") {
        const [table] = await withTransaction(suite.db, (tx) =>
          tx
            .insert(diningTables)
            .values({
              locationId: v.cfg.locationId,
              zoneId: v.bz,
              label: randomUUID(),
              active: false,
            })
            .returning(),
        );
        tableId = table!.id;
      }
      await expect(accept(v, 0, v.bz, tableId)).rejects.toMatchObject({
        code: "department_transfer.destination_invalid",
        params: { field: "tableId" },
      });
      expect(
        await suite.db
          .select()
          .from(departmentTransferRequests)
          .where(eq(departmentTransferRequests.id, v.request.id)),
      ).toEqual([v.request]);
    },
  );

  it("allows acceptance after a card payment has been received", async () => {
    const v = await pending();
    await withTransaction(suite.db, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: v.tab,
        submissionId: randomUUID(),
        fingerprint: "test",
        kind: "contribution",
        method: "card",
        applied: 100,
        state: "received",
        receivedAt: "2026-10-07T08:00:00.000Z",
        requestedBy: "sender",
        source: "operator_script",
      }),
    );
    const result = await accept(v);
    expect(result).toMatchObject({ status: "accepted", resolvedBy: "receiver" });
    const [payment] = await suite.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, v.tab));
    expect(payment).toMatchObject({
      applied: 100,
      state: "received",
      receivedAt: "2026-10-07T08:00:00.000Z",
    });
  });
});
