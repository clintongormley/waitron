import type { Hono } from "hono";
import { saveMenuStructure } from "@waitron/menu";
import {
  AppError,
  type IncludeFolder,
  type MemberRef,
  type MenuStructureMemberInput,
  type MenuStructureSaveInput,
} from "@waitron/shared";
import {
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireNullableString,
  requireString,
  requireUuidParam,
  type createErrorBoundary,
} from "@waitron/server-kit";
import type { GatedWork } from "./content-translations-api.js";
import type { Logger } from "./logger.js";
import "./errors.js";

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}

function rows<T>(value: unknown, field: string, read: (row: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) invalid(field);
  return value.map((row, index) => read(row, field + "." + index));
}

function refOf(value: unknown, path: string): MemberRef {
  const ref = object(value, path);
  switch (ref.kind) {
    case "product":
      return { kind: ref.kind, productId: requireBodyUuid(ref.productId, path + ".productId") };
    case "section":
      return { kind: ref.kind, sectionId: requireBodyUuid(ref.sectionId, path + ".sectionId") };
    case "set_menu":
      return { kind: ref.kind, menuId: requireBodyUuid(ref.menuId, path + ".menuId") };
    default:
      return invalid(path + ".kind");
  }
}

function folderOf(value: unknown, path: string): IncludeFolder {
  const { showAsFolder, overrides } = object(value, path);
  if (typeof showAsFolder !== "boolean") invalid(path + ".showAsFolder");
  // The menu writer validates the override fields against the media library and language settings.
  return { showAsFolder, overrides: object(overrides, path + ".overrides") };
}

function memberOf(value: unknown, path: string): MenuStructureMemberInput {
  const { id, ref, folder } = object(value, path);
  return {
    id: requireBodyUuid(id, path + ".id"),
    ref: refOf(ref, path + ".ref"),
    ...(folder === undefined ? {} : { folder: folderOf(folder, path + ".folder") }),
  };
}

function bodyOf(value: unknown): MenuStructureSaveInput {
  const { rootMembers, sections, prices } = object(value, "body");
  return {
    rootMembers: rows(rootMembers, "rootMembers", memberOf),
    sections: rows(sections, "sections", (value, path) => {
      const { id, internalName, names, image, color, members } = object(value, path);
      return {
        id: requireBodyUuid(id, path + ".id"),
        internalName: requireString(internalName, path + ".internalName"),
        names: Object.fromEntries(
          Object.entries(object(names, path + ".names")).map(([language, text]) => [
            language,
            requireString(text, path + ".names"),
          ]),
        ),
        image: requireNullableString(image, path + ".image"),
        color: requireNullableString(color, path + ".color"),
        members: rows(members, path + ".members", memberOf),
      };
    }),
    prices: rows(prices, "prices", (value, path) => {
      const { productId, variantId, price } = object(value, path);
      return {
        productId: requireBodyUuid(productId, path + ".productId"),
        ...(variantId === undefined
          ? {}
          : { variantId: requireBodyUuid(variantId, path + ".variantId") }),
        price: requireString(price, path + ".price"),
      };
    }),
  };
}

export function mountMenuStructureSaveRoute(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  venueLocale: string,
  run: ReturnType<typeof createErrorBoundary>,
): void {
  app.put("/management-api/menus/:id/structure", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = bodyOf(await readJsonBody<unknown>(c));
      return c.json(
        await gated(c, sessionId, (tx) => saveMenuStructure(tx, menuId, body, venueLocale)),
      );
    }),
  );
}
