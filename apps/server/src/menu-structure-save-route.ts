import type { Hono } from "hono";
import { saveMenuStructure } from "@waitron/menu";
import {
  normaliseUuid,
  type IncludeFolder,
  type MenuStructureMemberInput,
  type MenuStructureSaveInput,
} from "@waitron/shared";
import {
  readJsonBody,
  requireManagementSession,
  requireNullableString,
  requireString,
  type createErrorBoundary,
} from "@waitron/server-kit";
import type { GatedWork } from "./content-translations-api.js";
import type { Logger } from "./logger.js";
import { invalid, object, rows, bodyId, refOf } from "./menu-request-fields.js";
import "./errors.js";

function folderOf(value: unknown, path: string): IncludeFolder {
  const { showAsFolder, overrides } = object(value, path);
  if (typeof showAsFolder !== "boolean") invalid(path + ".showAsFolder");
  // The menu writer validates the override fields against the media library and language settings.
  return { showAsFolder, overrides: object(overrides, path + ".overrides") };
}

function memberOf(value: unknown, path: string): MenuStructureMemberInput {
  const { id, ref, folder } = object(value, path);
  return {
    id: bodyId(id, path + ".id"),
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
        id: bodyId(id, path + ".id"),
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
        productId: bodyId(productId, path + ".productId"),
        ...(variantId === undefined ? {} : { variantId: bodyId(variantId, path + ".variantId") }),
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
      const menuId = normaliseUuid(c.req.param("id"), "MenuId");
      const body = bodyOf(await readJsonBody<unknown>(c));
      return c.json(
        await gated(c, sessionId, (tx) => saveMenuStructure(tx, menuId, body, venueLocale)),
      );
    }),
  );
}
