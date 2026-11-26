import {
  type CategoryInput,
  type ProductSelection,
  type ShownFolderCounts,
  listCategories,
  createCategory,
  moveProductItems,
  type FolderContents,
  deleteProductItems,
  summariseFolders,
  readCategory,
  updateCategory,
} from "@waitron/menu";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run, runBodyCategory, runFolder } from "./menu-api-errors.js";
import { nullOrUuid, idList, isPlainObject, requireUuidParam } from "./menu-request-fields.js";

function categoryInput(body: Record<string, unknown>, creating: boolean): Partial<CategoryInput> {
  const result: Partial<CategoryInput> = {};
  if (creating || body.name !== undefined) {
    if (typeof body.name !== "string")
      throw new AppError("management.request_invalid", { field: "name" });
    result.name = body.name;
  }
  if (body.parentId !== undefined) result.parentId = nullOrUuid(body.parentId, "parentId");
  if (body.color !== undefined) {
    if (body.color !== null && typeof body.color !== "string")
      throw new AppError("management.request_invalid", { field: "color" });
    result.color = body.color;
  }
  return result;
}
function selectionBody(body: Record<string, unknown>): ProductSelection {
  const ids = (field: "productIds" | "categoryIds", kind: string): string[] => {
    const list = idList(body[field], field, kind);
    if (new Set(list).size !== list.length)
      throw new AppError("management.request_invalid", { field });
    return list;
  };
  return {
    productIds: ids("productIds", "ProductId"),
    categoryIds: ids("categoryIds", "CategoryId"),
  };
}
/** One entry per selected category, exactly; the counts themselves are compared by the delete. */
function shownBody(value: unknown, categoryIds: readonly string[]): ShownFolderCounts[] {
  const invalid = () => new AppError("management.request_invalid", { field: "shown" });
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!Array.isArray(value)) throw invalid();
  const shown = value.map((entry: unknown): ShownFolderCounts => {
    if (
      !isPlainObject(entry) ||
      typeof entry.id !== "string" ||
      !isUuid(entry.id) ||
      !count(entry.folders) ||
      !count(entry.products) ||
      !count(entry.activeProducts) ||
      !count(entry.routes) ||
      !count(entry.ownRoutes)
    )
      throw invalid();
    return {
      id: entry.id,
      folders: entry.folders,
      products: entry.products,
      activeProducts: entry.activeProducts,
      routes: entry.routes,
      ownRoutes: entry.ownRoutes,
    };
  });
  const ids = new Set(shown.map(({ id }) => id));
  if (
    ids.size !== shown.length ||
    ids.size !== categoryIds.length ||
    categoryIds.some((id) => !ids.has(id))
  )
    throw invalid();
  return shown;
}

export function mountMenuCategoryRoutes(app: Hono, gated: GatedWork, log: Logger): void {
  app.get("/management-api/categories", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(c, sessionId, (tx) => listCategories(tx));
      return c.json(rows);
    }),
  );

  app.post("/management-api/categories", (c) =>
    runBodyCategory(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = categoryInput(body, true) as CategoryInput;
      const created = await gated(c, sessionId, (tx) => createCategory(tx, input));
      return c.json(created, 201);
    }),
  );

  app.post("/management-api/folders/move", (c) =>
    runFolder(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const selection = selectionBody(body);
      const to = nullOrUuid(body.to, "to");
      await gated(c, session, (tx) => moveProductItems(tx, selection, to));
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/folders/delete", (c) =>
    runFolder(c, log, async () => {
      const session = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const selection = selectionBody(body);
      if (body.contents !== "move_up" && body.contents !== "delete")
        throw new AppError("management.request_invalid", { field: "contents" });
      const contents: FolderContents = body.contents;
      const shown = selection.categoryIds.length
        ? shownBody(body.shown, selection.categoryIds)
        : undefined;
      await gated(c, session, (tx, personId) =>
        deleteProductItems(tx, selection, contents, shown, personId),
      );
      return c.body(null, 204);
    }),
  );
  app.get("/management-api/folders/summary", (c) =>
    runBodyCategory(c, log, async () => {
      const session = requireManagementSession(c);
      const ids = (c.req.queries("id") ?? []).map((id) => requireUuidParam(id, "CategoryId"));
      return c.json(await gated(c, session, (tx) => summariseFolders(tx, ids)));
    }),
  );

  app.get("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      return c.json(await gated(c, session, (tx) => readCategory(tx, id)));
    }),
  );
  app.patch("/management-api/categories/:id", (c) =>
    run(c, log, async () => {
      const session = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "CategoryId");
      const input = categoryInput(await readJsonBody<Record<string, unknown>>(c), false);
      return c.json(await gated(c, session, (tx) => updateCategory(tx, id, input)));
    }),
  );
}
