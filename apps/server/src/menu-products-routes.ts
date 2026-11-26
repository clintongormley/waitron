import type { Transaction } from "@waitron/db";
import {
  isModifierListKind,
  validateOptionalTranslations,
  listProducts,
  setProductAvailability,
  saveProductEditor,
  readProductEditor,
  extraOfferUsageForUnitChange,
  listProductVariants,
  readProductDeclarationValues,
  waitingDeclarationMenus,
  createProduct,
  writeProductModifiers,
  readProductModifiers,
} from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import {
  AppError,
  type ProductModifierRef,
  isUuid,
  type ProductRouting,
  type ProductEditorValue,
  FALLBACK_LOCALE,
  isProductOrdering,
  type ProductAllergens,
  type DietOverride,
} from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import type { MenuApiDeps } from "./menu-api-deps.js";
import { run, runBodyProduct, runBodyCategory, runCreateProduct } from "./menu-api-errors.js";
import {
  isPlainObject,
  idList,
  requireUuidParam,
  refuseInvalidPrice,
  refuseRetiredFields,
} from "./menu-request-fields.js";

function screenDietOverride(value: unknown): void {
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "dietOverride" });
  }
}
/**
 * The ordered attach list, in the order a diner is offered them; absent leaves the product's
 * attachments untouched. A SHAPE screen only: duplicates and whether each id names a real list are
 * `writeProductModifiers`' checks, so a repeat is refused rather than quietly collapsed.
 */
function parseProductModifiers(value: unknown): ProductModifierRef[] | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new AppError("management.request_invalid", { field: "modifiers" });
  if (!Array.isArray(value)) throw invalid();
  return value.map((entry): ProductModifierRef => {
    if (!isPlainObject(entry)) throw invalid();
    const { kind, id } = entry as { kind?: unknown; id?: unknown };
    if (!isModifierListKind(kind)) throw invalid();
    if (typeof id !== "string") throw invalid();
    if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind: "ModifierListId", value: id });
    return { kind, id };
  });
}
function screenCustomerName(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new AppError("management.request_invalid", { field: "customerName" });
  }
  const entries = Object.entries(value);
  if (entries.some(([, text]) => typeof text !== "string")) {
    throw new AppError("management.request_invalid", { field: "customerName" });
  }
  const names = validateOptionalTranslations(value);
  return Object.keys(names).length === 0 ? null : names;
}

export function mountMenuProductAvailabilityRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  app.get("/management-api/products", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(c, session, (tx) => listProducts(tx)));
    }),
  );
  app.put("/management-api/products/availability", (c) =>
    runBodyProduct(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const ids = idList(
        isPlainObject(body) ? body.productIds : undefined,
        "productIds",
        "ProductId",
      );
      if (ids.length === 0 || new Set(ids).size !== ids.length)
        throw new AppError("management.request_invalid", { field: "productIds" });
      const available = isPlainObject(body) ? body.available : undefined;
      if (typeof available !== "boolean")
        throw new AppError("management.request_invalid", { field: "available" });
      await gated(c, session, (tx) => setProductAvailability(tx, ids, available));
      return c.body(null, 204);
    }),
  );
}

export function mountMenuProductEditorRoutes(
  app: Hono,
  deps: MenuApiDeps,
  gated: GatedWork,
  log: Logger,
  screenRouting: (body: Record<string, unknown>) => ProductRouting,
  applyRouting: (
    tx: Transaction,
    saved: ProductEditorValue,
    routing: ProductRouting,
  ) => Promise<ProductEditorValue>,
): void {
  app.post("/management-api/products/editor", (c) =>
    runBodyCategory(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      const saved = await gated(c, sessionId, async (tx, personId) => {
        const product = await saveProductEditor(
          tx,
          null,
          body,
          deps.venueLocale ?? FALLBACK_LOCALE,
          personId,
        );
        return applyRouting(tx, product, routing);
      });
      return c.json(saved, 201);
    }),
  );

  app.get("/management-api/products/:id/editor", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(await gated(c, sessionId, (tx) => readProductEditor(tx, productId)));
    }),
  );

  app.get("/management-api/products/:id/extra-usage", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      return c.json(
        await gated(c, sessionId, async (tx) => {
          await readProductEditor(tx, productId);
          return extraOfferUsageForUnitChange(tx, productId);
        }),
      );
    }),
  );

  app.put("/management-api/products/:id/editor", (c) =>
    runBodyCategory(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const routing = screenRouting(body);
      return c.json(
        await gated(c, sessionId, async (tx, personId) => {
          const family = [
            productId,
            ...(await listProductVariants(tx, productId)).map((v) => v.id),
          ];
          const before = await readProductDeclarationValues(tx, family);
          const product = await saveProductEditor(
            tx,
            productId,
            body,
            deps.venueLocale ?? FALLBACK_LOCALE,
            personId,
          );
          const routed = product.active ? await applyRouting(tx, product, routing) : product;
          return { ...routed, declarationMenus: await waitingDeclarationMenus(tx, family, before) };
        }),
      );
    }),
  );

  app.post("/management-api/products", (c) =>
    runCreateProduct(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // `allergens` is left to `createProduct`, which throws the authoritative `allergen.*` codes.
      const body = await readJsonBody<{
        categoryId?: unknown;
        name?: unknown;
        customerName?: unknown;
        unitId?: unknown;
        pricingUnit?: unknown;
        unitPrice?: unknown;
        takeawayVatRate?: unknown;
        allergens?: unknown;
        dietOverride?: unknown;
        image?: unknown;
        active?: unknown;
        available?: unknown;
        ordering?: unknown;
        modifiers?: unknown;
        soldAlone?: unknown;
        modifierIds?: unknown;
        optionGroupIds?: unknown;
      }>(c);
      if (typeof body.categoryId !== "string" && body.categoryId !== null) {
        throw new AppError("management.request_invalid", { field: "categoryId" });
      }
      if (typeof body.name !== "string" || !body.name.trim()) {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      const customerName = screenCustomerName(body.customerName);
      if (body.unitId !== undefined && (typeof body.unitId !== "string" || !isUuid(body.unitId))) {
        throw new AppError("management.request_invalid", { field: "unitId" });
      }
      if (body.unitId === undefined && body.pricingUnit === undefined) {
        throw new AppError("management.request_invalid", { field: "unitId" });
      }
      if (body.pricingUnit !== undefined && typeof body.pricingUnit !== "string") {
        throw new AppError("management.request_invalid", { field: "pricingUnit" });
      }
      if (typeof body.unitPrice !== "string") {
        throw new AppError("management.request_invalid", { field: "unitPrice" });
      }
      refuseInvalidPrice(body.unitPrice, "unitPrice");
      if (body.image !== undefined && typeof body.image !== "string") {
        throw new AppError("management.request_invalid", { field: "image" });
      }
      if (body.active !== undefined && typeof body.active !== "boolean") {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      if (body.available !== undefined && typeof body.available !== "boolean") {
        throw new AppError("management.request_invalid", { field: "available" });
      }
      if (body.ordering !== undefined && !isProductOrdering(body.ordering)) {
        throw new AppError("management.request_invalid", { field: "ordering" });
      }
      screenDietOverride(body.dietOverride);
      // Applied in the SAME transaction as the create, so a product and its lists land atomically.
      refuseRetiredFields(body, [
        "modifierIds",
        "optionGroupIds",
        "soldAlone",
        "menuId",
        "vatClass",
        "takeawayVatClass",
      ]);
      const modifiers = parseProductModifiers(body.modifiers);
      const input = {
        categoryId: body.categoryId,
        name: body.name.trim(),
        customerName,
        ...(body.unitId === undefined
          ? { pricingUnit: body.pricingUnit as never }
          : { unitId: body.unitId as string }),
        unitPrice: body.unitPrice,
        // `createProduct` refuses a rate the area does not offer; omitted takes the venue's default.
        ...(body.takeawayVatRate === undefined
          ? {}
          : { takeawayVatRate: body.takeawayVatRate as string }),
        ...(body.allergens === undefined ? {} : { allergens: body.allergens as ProductAllergens }),
        ...(body.dietOverride === undefined
          ? {}
          : { dietOverride: body.dietOverride as DietOverride | null }),
        ...(body.image === undefined ? {} : { image: body.image }),
        ...(body.active === undefined ? {} : { active: body.active }),
        ...(body.available === undefined ? {} : { available: body.available }),
        ...(body.ordering === undefined ? {} : { ordering: body.ordering }),
      };
      const created = await gated(c, sessionId, async (tx) => {
        const product = await createProduct(tx, input);
        if (modifiers === undefined) return { ...product, modifiers: [] };
        await writeProductModifiers(tx, product.id, modifiers);
        // The 201 reports the STORED list, never the array the caller sent: `writeProductModifiers`
        // lower-cases every list id.
        const stored = await readProductModifiers(tx, [product.id]);
        return { ...product, modifiers: stored.get(product.id) ?? [] };
      });
      return c.json(created, 201);
    }),
  );
}
