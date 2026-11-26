import "@waitron/menu/src/errors.js";
import {
  readSetMenu,
  saveSetMenuLines,
  saveSetMenuDishCourse,
  saveSetMenuVariantChoices,
  addSetMenuDishes,
  copySetMenuDishes,
} from "@waitron/menu";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runBodySetMenu } from "./menu-api-errors.js";
import {
  refuseRetiredFields,
  isPlainObject,
  requireUuidParam,
  idList,
  nullOrUuid,
} from "./menu-request-fields.js";

const RETIRED_SET_MENU_FIELDS = ["setVatClass", "setTakeawayVatClass"] as const;
export function setMenuTerms(body: Record<string, unknown>) {
  const { setPrice } = body;
  if (setPrice !== undefined && setPrice !== null && typeof setPrice !== "string")
    throw new AppError("set_menu.invalid", { field: "setPrice" });
  refuseRetiredFields(body, RETIRED_SET_MENU_FIELDS);
  return { setPrice };
}
function setMenuRows(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isPlainObject))
    throw new AppError("management.request_invalid", { field });
  return value;
}
export function mountSetMenuRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  const draft = "/management-api/menus/:id/set-menu";
  const menu = (c: Context) => requireUuidParam(c.req.param("id")!, "MenuId");
  const item = (c: Context) => requireUuidParam(c.req.param("itemId")!, "MenuItemId");

  app.get(draft, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      return c.json(await gated(c, session, (tx) => readSetMenu(tx, menu(c))));
    }),
  );
  app.put(`${draft}/lines`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const { lines } = await readJsonBody<{ lines?: unknown }>(c);
      const input = setMenuRows(lines, "lines").map(({ count, courseIds }) => {
        if (typeof count !== "number") throw new AppError("set_menu.invalid", { field: "count" });
        return { count, courseIds: idList(courseIds, "courseIds", "CourseId") };
      });
      return c.json({
        lines: await gated(c, session, (tx) => saveSetMenuLines(tx, menu(c), input)),
      });
    }),
  );
  app.put(`${draft}/items/:itemId/course`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menuId = menu(c);
      const itemId = item(c);
      const { courseId } = await readJsonBody<{ courseId?: unknown }>(c);
      const course = nullOrUuid(courseId, "courseId");
      return c.json(
        await gated(c, session, async (tx) => {
          const lines = await saveSetMenuDishCourse(tx, menuId, itemId, course);
          return { details: await readSetMenu(tx, menuId), ...lines };
        }),
      );
    }),
  );
  app.put(`${draft}/items/:itemId/variants`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menuId = menu(c);
      const itemId = item(c);
      const { variants } = await readJsonBody<{ variants?: unknown }>(c);
      const input = setMenuRows(variants, "variants").map(({ variantId, included, surcharge }) => {
        if (typeof included !== "boolean")
          throw new AppError("set_menu.invalid", { field: "variants" });
        if (surcharge !== null && typeof surcharge !== "string")
          throw new AppError("set_menu.invalid", { field: "surcharge" });
        return {
          variantId: requireUuidParam(requireString(variantId, "variantId"), "VariantId"),
          included,
          surcharge,
        };
      });
      return c.json(
        await gated(c, session, async (tx) => {
          await saveSetMenuVariantChoices(tx, menuId, itemId, input);
          return readSetMenu(tx, menuId);
        }),
      );
    }),
  );
  app.post(`${draft}/dishes`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menuId = menu(c);
      const { dishes } = await readJsonBody<{ dishes?: unknown }>(c);
      const input = setMenuRows(dishes, "dishes").map(({ productId, excludedVariantIds }) => ({
        productId: requireUuidParam(requireString(productId, "productId"), "ProductId"),
        excludedVariantIds: idList(excludedVariantIds, "excludedVariantIds", "VariantId"),
      }));
      return c.json(
        await gated(c, session, async (tx) => {
          const addedLines = await addSetMenuDishes(tx, menuId, input);
          return { details: await readSetMenu(tx, menuId), addedLines };
        }),
      );
    }),
  );
  app.post(`${draft}/copy-dishes`, (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const menuId = menu(c);
      const { fromMenuId } = await readJsonBody<{ fromMenuId?: unknown }>(c);
      const source = requireUuidParam(requireString(fromMenuId, "fromMenuId"), "MenuId");
      try {
        return c.json(
          await gated(c, session, async (tx) => {
            const addedLines = await copySetMenuDishes(tx, menuId, source);
            return { details: await readSetMenu(tx, menuId), addedLines };
          }),
        );
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "set_menu.not_found" &&
          "menuId" in error.params &&
          error.params.menuId !== menuId
        )
          return runBodySetMenu(c, log, async () => {
            throw error;
          });
        throw error;
      }
    }),
  );
}
