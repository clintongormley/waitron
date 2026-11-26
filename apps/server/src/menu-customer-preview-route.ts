import {
  EACH_UNIT_ID,
  assertMenuWritable,
  readContentLanguages,
  readLiveDocuments,
  refuseSetMenu,
} from "@waitron/menu";
import { type Logger, requireManagementSession } from "@waitron/server-kit";
import { type CustomerMenuPreview, publicGuestMenu } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { requireUuidParam } from "./menu-request-fields.js";

export function mountMenuCustomerPreviewRoute(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  venueLocale: string,
): void {
  app.get("/management-api/menus/:id/customer-preview", (c) =>
    run(c, log, async () => {
      c.header("cache-control", "no-store");
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const requested = c.req.query("language");
      const answer = await gated(c, sessionId, async (tx): Promise<CustomerMenuPreview> => {
        await assertMenuWritable(tx, menuId);
        await refuseSetMenu(tx, menuId);
        const live = (await readLiveDocuments(tx, [menuId])).get(menuId);
        if (!live) return { state: "unpublished" };
        const languages = await readContentLanguages(tx, venueLocale);
        return {
          state: "published",
          menu: publicGuestMenu(live.document, languages, requested ?? [], EACH_UNIT_ID),
        };
      });
      return c.json(answer);
    }),
  );
}
