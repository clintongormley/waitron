import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  asAppUser,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { ModifierInput, TenantId } from "@waitron/shared";
import { lockModifierDefinitions } from "./modifier-lock.js";
import { seedLegacySellingUnits, seedVenue } from "../test/fixtures.js";
import { createModifier, deleteModifier, getModifier, updateModifier } from "./modifiers.js";
import {
  createCatalogue,
  createOptionGroup,
  createOptionGroupItem,
  updateOptionGroup,
  updateOptionGroupItem,
  createMenuItem,
  createMenuSection,
  createProduct,
  listMenuOffers,
  setMenuItemOptionGroups,
  setProductOptionGroups,
} from "./operations.js";

// Independent PostgreSQL backends enforce advisory-lock contention and app_user grants.
const suite = useTemplateDb({ template: "core" });
const textDefinition: ModifierInput = { type: "text", name: { en: "Message" }, available: true };
const extrasDefinition: ModifierInput = {
  type: "extras",
  name: { en: "Ice" },
  available: true,
  required: false,
  maxTotalQuantity: null,
  choices: [],
};

function app<T>(
  db: Database,
  tenantId: TenantId,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  void tenantId;
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}

async function fixture() {
  const venue = await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin);
  return app(suite.admin, venue.tenantId, async (tx) => {
    const menu = await createCatalogue(tx, venue.tenantId, { name: "Menu" });
    const section = await createMenuSection(tx, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const product = await createProduct(tx, venue.tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const item = await createMenuItem(tx, {
      menuId: menu.id,
      sectionId: section.id,
      productId: product.id,
      grossPrice: "2.00",
    });
    const modifier = await createModifier(tx, venue.tenantId, textDefinition, "en");
    return { ...venue, menu, product, item, modifier };
  });
}

/** The second transaction must visibly wait on the first backend before the first commits. */
async function orderedRace(
  tenantId: TenantId,
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>> {
  const firstDb = await suite.pg.connect();
  let secondDb: Awaited<ReturnType<typeof suite.pg.connect>> | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let firstWork: Promise<void> | undefined;
  let secondWork: Promise<unknown> | undefined;
  try {
    secondDb = await suite.pg.connect();
    const firstPid = (await firstDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    const secondPid = (await secondDb.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
      .rows[0]!.pid;
    expect(firstPid).not.toBe(secondPid);
    firstWork = app(firstDb, tenantId, async (tx) => {
      const role = await tx.execute<{ role: string; superuser: boolean }>(
        sql`select current_user as role, rolsuper as superuser from pg_roles where rolname = current_user`,
      );
      expect(role.rows).toEqual([{ role: "app_user", superuser: false }]);
      await first(tx);
      ready();
      await gate;
    });
    // A failed first operation must surface instead of leaving the test waiting on its signal.
    await Promise.race([prepared, firstWork]);
    secondWork = app(secondDb, tenantId, second);
    const settled = Promise.allSettled([firstWork, secondWork]);
    try {
      await expect
        .poll(
          async () => {
            const rows = await suite.admin.execute<{ blocked: boolean; advisory: boolean }>(sql`
          select ${firstPid} = any(pg_blocking_pids(${secondPid})) as blocked,
            exists(select 1 from pg_locks where pid = ${secondPid} and locktype = 'advisory' and not granted) as advisory
        `);
            return rows.rows[0];
          },
          { timeout: 5000 },
        )
        .toEqual({ blocked: true, advisory: true });
    } finally {
      release();
    }
    const [firstResult, secondResult] = await settled;
    expect(firstResult.status).toBe("fulfilled");
    return secondResult;
  } finally {
    release();
    await Promise.allSettled([firstWork, secondWork]);
    await firstDb.close();
    await secondDb?.close();
  }
}

it("a type change waits for an attachment and refuses the committed product dependency", async () => {
  const { tenantId, product, modifier } = await fixture();
  const result = await orderedRace(
    tenantId,
    (tx) => setProductOptionGroups(tx, tenantId, product.id, [modifier.id]),
    (tx) => updateModifier(tx, tenantId, modifier.id, extrasDefinition, "en"),
  );
  expect(result).toMatchObject({
    status: "rejected",
    reason: { code: "modifier.in_use", params: { dependency: "product" } },
  });
  expect(await app(suite.admin, tenantId, (tx) => getModifier(tx, modifier.id))).toEqual(modifier);
});

it("an attachment waits for a type change and publishes the newly committed type", async () => {
  const { tenantId, product, modifier, item, menu } = await fixture();
  const result = await orderedRace(
    tenantId,
    (tx) => updateModifier(tx, tenantId, modifier.id, extrasDefinition, "en"),
    (tx) => setProductOptionGroups(tx, tenantId, product.id, [modifier.id]),
  );
  expect(result.status).toBe("fulfilled");
  await app(suite.admin, tenantId, async (tx) => {
    await setMenuItemOptionGroups(tx, item.id, [{ groupId: modifier.id, options: [] }]);
    expect((await listMenuOffers(tx, [menu.id]))[0]!.modifiers).toEqual([
      { id: modifier.id, ...extrasDefinition },
    ]);
  });
});

it.each(["type change", "deletion"] as const)(
  "menu publication holds the lock against concurrent %s",
  async (operation) => {
    const { tenantId, product, modifier, item, menu } = await fixture();
    await app(suite.admin, tenantId, (tx) =>
      setProductOptionGroups(tx, tenantId, product.id, [modifier.id]),
    );
    const result = await orderedRace(
      tenantId,
      (tx) => setMenuItemOptionGroups(tx, item.id, [{ groupId: modifier.id, options: [] }]),
      (tx) =>
        operation === "deletion"
          ? deleteModifier(tx, modifier.id)
          : updateModifier(tx, tenantId, modifier.id, extrasDefinition, "en"),
    );
    // orderedRace has already proven the second operation waited on the publication's advisory lock.
    // A type change still refuses the committed attachment; a delete now cascades it and succeeds,
    // because no open order references the modifier.
    const offers = async () =>
      (await app(suite.admin, tenantId, (tx) => listMenuOffers(tx, [menu.id])))[0]!.modifiers;
    if (operation === "type change") {
      expect(result).toMatchObject({ status: "rejected", reason: { code: "modifier.in_use" } });
      expect(await offers()).toEqual([modifier]);
    } else {
      expect(result.status).toBe("fulfilled");
      expect(await offers()).toEqual([]);
      await expect(
        app(suite.admin, tenantId, (tx) => getModifier(tx, modifier.id)),
      ).rejects.toMatchObject({ code: "modifier.not_found" });
    }
  },
);

it("menu publication waits for deletion and rejects the removed attachment", async () => {
  const { tenantId, product, modifier, item, menu } = await fixture();
  await app(suite.admin, tenantId, (tx) =>
    setProductOptionGroups(tx, tenantId, product.id, [modifier.id]),
  );
  const result = await orderedRace(
    tenantId,
    async (tx) => {
      await setProductOptionGroups(tx, tenantId, product.id, []);
      await deleteModifier(tx, modifier.id);
    },
    (tx) => setMenuItemOptionGroups(tx, item.id, [{ groupId: modifier.id, options: [] }]),
  );
  expect(result).toMatchObject({
    status: "rejected",
    reason: { code: "options.group_invalid", params: { reason: "not_attached" } },
  });
  expect(
    (await app(suite.admin, tenantId, (tx) => listMenuOffers(tx, [menu.id])))[0]!.modifiers,
  ).toEqual([]);
});

it("refuses deletion solely because an actual order retains a saved modifier snapshot", async () => {
  const { tenantId, product, modifier, item, tillId, nodeId } = await fixture();
  const snapshots = [
    { modifierId: modifier.id, name: modifier.name, type: "text" as const, text: "Happy birthday" },
  ];
  await app(suite.admin, tenantId, async (tx) => {
    await setProductOptionGroups(tx, tenantId, product.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, item.id, [{ groupId: modifier.id, options: [] }]);
    const [order] = await tx
      .insert(workingOrders)
      .values({ tillId, nodeId, orderNumber: 1 })
      .returning();
    await tx.insert(workingOrderLines).values({
      workingOrderId: order!.id,
      productId: product.id,
      lineNo: 1,
      name: "Coffee",
      descriptions: { "en-GB": "Coffee" },
      modifierSnapshots: snapshots,
      quantity: "1",
      unitPrice: "1.82",
      unitPriceGross: "2.00",
      vatRate: "10.00",
      lineTotal: "2.00",
    });
    await setMenuItemOptionGroups(tx, item.id, []);
    await setProductOptionGroups(tx, tenantId, product.id, []);
  });
  await expect(
    app(suite.admin, tenantId, (tx) => deleteModifier(tx, modifier.id)),
  ).rejects.toMatchObject({ code: "modifier.in_use", params: { dependency: "order" } });
  const saved = await app(suite.admin, tenantId, (tx) =>
    tx.select({ snapshots: workingOrderLines.modifierSnapshots }).from(workingOrderLines),
  );
  expect(saved).toEqual([{ snapshots }]);
  expect(await app(suite.admin, tenantId, (tx) => getModifier(tx, modifier.id))).toEqual(modifier);
});

it("allows simultaneous selection readers while excluding definition writes", async () => {
  const { tenantId, modifier } = await fixture();
  const firstDb = await suite.pg.connect();
  let secondDb: Awaited<ReturnType<typeof suite.pg.connect>> | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstReady = false;
  let secondReady = false;
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  try {
    secondDb = await suite.pg.connect();
    first = app(firstDb, tenantId, async (tx) => {
      await lockModifierDefinitions(tx, "read");
      firstReady = true;
      await gate;
    });
    await expect.poll(() => firstReady).toBe(true);
    second = app(secondDb, tenantId, async (tx) => {
      await lockModifierDefinitions(tx, "read");
      secondReady = true;
      await gate;
    });
    await expect.poll(() => secondReady).toBe(true);
  } finally {
    release();
    await Promise.allSettled([first, second]);
    await firstDb.close();
    await secondDb?.close();
  }
  const result = await orderedRace(
    tenantId,
    (tx) => lockModifierDefinitions(tx, "read"),
    (tx) => updateModifier(tx, tenantId, modifier.id, extrasDefinition, "en"),
  );
  expect(result.status).toBe("fulfilled");
});

it.each(["create group", "update group", "create choice", "update choice"] as const)(
  "legacy %s waits for an active selection reader",
  async (operation) => {
    const { tenantId } = await fixture();
    const { group, item } = await app(suite.admin, tenantId, async (tx) => {
      const group = await createOptionGroup(tx, tenantId, { name: { en: "Extras" } });
      const item = await createOptionGroupItem(tx, tenantId, group.id, { name: { en: "Egg" } });
      return { group, item };
    });
    const result = await orderedRace(
      tenantId,
      (tx) => lockModifierDefinitions(tx, "read"),
      async (tx) => {
        switch (operation) {
          case "create group":
            return createOptionGroup(tx, tenantId, { name: { en: "New" } });
          case "update group":
            return updateOptionGroup(tx, group.id, { active: false });
          case "create choice":
            return createOptionGroupItem(tx, tenantId, group.id, { name: { en: "New" } });
          case "update choice":
            return updateOptionGroupItem(tx, item.id, { active: false });
        }
      },
    );
    expect(result.status).toBe("fulfilled");
  },
);
