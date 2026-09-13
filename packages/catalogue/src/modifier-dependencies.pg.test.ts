import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  asAppUser,
  optionGroupItems,
  productOptionGroups,
  withTenant,
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
const yesNoDefinition: ModifierInput = {
  type: "yes-no",
  name: { en: "Ice" },
  available: true,
  yesLabel: { en: "With ice" },
  noLabel: { en: "Without ice" },
  defaultValue: false,
};

function app<T>(
  db: Database,
  tenantId: TenantId,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    return action(tx);
  });
}

async function fixture() {
  const venue = await seedVenue(suite.admin);
  await seedLegacySellingUnits(suite.admin, venue.tenantId);
  return app(suite.admin, venue.tenantId, async (tx) => {
    const menu = await createCatalogue(tx, venue.tenantId, { name: "Menu" });
    const section = await createMenuSection(tx, venue.tenantId, {
      menuId: menu.id,
      name: { en: "Drinks" },
    });
    const product = await createProduct(tx, venue.tenantId, {
      catalogueId: menu.id,
      categoryId: null,
      descriptions: { en: "Coffee" },
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const item = await createMenuItem(tx, venue.tenantId, {
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
    (tx) => updateModifier(tx, tenantId, modifier.id, yesNoDefinition, "en"),
  );
  expect(result).toMatchObject({
    status: "rejected",
    reason: { code: "modifier.in_use", params: { dependency: "product" } },
  });
  expect(await app(suite.admin, tenantId, (tx) => getModifier(tx, tenantId, modifier.id))).toEqual(
    modifier,
  );
});

it("an attachment waits for a type change and publishes the newly committed type", async () => {
  const { tenantId, product, modifier, item, menu } = await fixture();
  const result = await orderedRace(
    tenantId,
    (tx) => updateModifier(tx, tenantId, modifier.id, yesNoDefinition, "en"),
    (tx) => setProductOptionGroups(tx, tenantId, product.id, [modifier.id]),
  );
  expect(result.status).toBe("fulfilled");
  await app(suite.admin, tenantId, async (tx) => {
    await setMenuItemOptionGroups(tx, tenantId, item.id, [{ groupId: modifier.id, options: [] }]);
    expect((await listMenuOffers(tx, tenantId, [menu.id]))[0]!.modifiers).toEqual([
      { id: modifier.id, ...yesNoDefinition },
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
      (tx) =>
        setMenuItemOptionGroups(tx, tenantId, item.id, [{ groupId: modifier.id, options: [] }]),
      (tx) =>
        operation === "deletion"
          ? deleteModifier(tx, tenantId, modifier.id)
          : updateModifier(tx, tenantId, modifier.id, yesNoDefinition, "en"),
    );
    expect(result).toMatchObject({ status: "rejected", reason: { code: "modifier.in_use" } });
    expect(
      (await app(suite.admin, tenantId, (tx) => listMenuOffers(tx, tenantId, [menu.id])))[0]!
        .modifiers,
    ).toEqual([modifier]);
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
      await deleteModifier(tx, tenantId, modifier.id);
    },
    (tx) => setMenuItemOptionGroups(tx, tenantId, item.id, [{ groupId: modifier.id, options: [] }]),
  );
  expect(result).toMatchObject({
    status: "rejected",
    reason: { code: "options.group_invalid", params: { reason: "not_attached" } },
  });
  expect(
    (await app(suite.admin, tenantId, (tx) => listMenuOffers(tx, tenantId, [menu.id])))[0]!
      .modifiers,
  ).toEqual([]);
});

it("refuses deletion solely because an actual order retains a saved modifier snapshot", async () => {
  const { tenantId, product, modifier, item, tillId, nodeId } = await fixture();
  const snapshots = [
    { modifierId: modifier.id, name: modifier.name, type: "text" as const, text: "Happy birthday" },
  ];
  await app(suite.admin, tenantId, async (tx) => {
    await setProductOptionGroups(tx, tenantId, product.id, [modifier.id]);
    await setMenuItemOptionGroups(tx, tenantId, item.id, [{ groupId: modifier.id, options: [] }]);
    const [order] = await tx
      .insert(workingOrders)
      .values({ tenantId, tillId, nodeId, orderNumber: 1 })
      .returning();
    await tx.insert(workingOrderLines).values({
      tenantId,
      workingOrderId: order!.id,
      productId: product.id,
      lineNo: 1,
      descriptions: { "en-GB": "Coffee" },
      modifierSnapshots: snapshots,
      quantity: "1",
      unitPrice: "1.82",
      unitPriceGross: "2.00",
      vatRate: "10.00",
      lineTotal: "2.00",
    });
    await setMenuItemOptionGroups(tx, tenantId, item.id, []);
    await setProductOptionGroups(tx, tenantId, product.id, []);
  });
  await expect(
    app(suite.admin, tenantId, (tx) => deleteModifier(tx, tenantId, modifier.id)),
  ).rejects.toMatchObject({ code: "modifier.in_use", params: { dependency: "order" } });
  const saved = await app(suite.admin, tenantId, (tx) =>
    tx
      .select({ snapshots: workingOrderLines.modifierSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.tenantId, tenantId)),
  );
  expect(saved).toEqual([{ snapshots }]);
  expect(await app(suite.admin, tenantId, (tx) => getModifier(tx, tenantId, modifier.id))).toEqual(
    modifier,
  );
});

it("rejects another tenant's definition and choice ids without deleting either tenant's choices", async () => {
  const owner = await fixture();
  const other = await fixture();
  const foreignChoice = { id: randomUUID(), name: { en: "Oat" }, available: true };
  const ownChoice = { id: randomUUID(), name: { en: "Milk" }, available: true };
  const foreign = await app(suite.admin, owner.tenantId, (tx) =>
    createModifier(
      tx,
      owner.tenantId,
      {
        type: "options",
        name: { en: "Milk" },
        choices: [foreignChoice],
        defaultChoiceId: foreignChoice.id,
      },
      "en",
    ),
  );
  const own = await app(suite.admin, other.tenantId, (tx) =>
    createModifier(
      tx,
      other.tenantId,
      {
        type: "options",
        name: { en: "Milk" },
        choices: [ownChoice],
        defaultChoiceId: ownChoice.id,
      },
      "en",
    ),
  );
  await expect(
    app(suite.admin, other.tenantId, (tx) => deleteModifier(tx, other.tenantId, foreign.id)),
  ).rejects.toMatchObject({ code: "modifier.not_found" });
  await expect(
    app(suite.admin, other.tenantId, (tx) =>
      updateModifier(tx, other.tenantId, foreign.id, textDefinition, "en"),
    ),
  ).rejects.toMatchObject({ code: "modifier.not_found" });
  await expect(
    app(suite.admin, other.tenantId, (tx) =>
      updateModifier(
        tx,
        other.tenantId,
        own.id,
        {
          type: "options",
          name: own.name,
          choices: [foreignChoice],
          defaultChoiceId: foreignChoice.id,
        },
        "en",
      ),
    ),
  ).rejects.toMatchObject({ code: "modifier.invalid" });
  expect(
    await app(suite.admin, owner.tenantId, (tx) => getModifier(tx, owner.tenantId, foreign.id)),
  ).toEqual(foreign);
  expect(
    await app(suite.admin, other.tenantId, (tx) => getModifier(tx, other.tenantId, own.id)),
  ).toEqual(own);
  expect(
    await app(suite.admin, other.tenantId, (tx) =>
      tx
        .select({ id: optionGroupItems.id })
        .from(optionGroupItems)
        .where(
          and(eq(optionGroupItems.tenantId, other.tenantId), eq(optionGroupItems.groupId, own.id)),
        ),
    ),
  ).toEqual([{ id: ownChoice.id }]);
  expect(
    await app(suite.admin, other.tenantId, (tx) =>
      tx.select().from(productOptionGroups).where(eq(productOptionGroups.tenantId, other.tenantId)),
    ),
  ).toEqual([]);
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
      await lockModifierDefinitions(tx, tenantId, "read");
      firstReady = true;
      await gate;
    });
    await expect.poll(() => firstReady).toBe(true);
    second = app(secondDb, tenantId, async (tx) => {
      await lockModifierDefinitions(tx, tenantId, "read");
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
    (tx) => lockModifierDefinitions(tx, tenantId, "read"),
    (tx) => updateModifier(tx, tenantId, modifier.id, yesNoDefinition, "en"),
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
      (tx) => lockModifierDefinitions(tx, tenantId, "read"),
      async (tx) => {
        switch (operation) {
          case "create group":
            return createOptionGroup(tx, tenantId, { name: { en: "New" } });
          case "update group":
            return updateOptionGroup(tx, tenantId, group.id, { active: false });
          case "create choice":
            return createOptionGroupItem(tx, tenantId, group.id, { name: { en: "New" } });
          case "update choice":
            return updateOptionGroupItem(tx, tenantId, item.id, { active: false });
        }
      },
    );
    expect(result.status).toBe("fulfilled");
  },
);
