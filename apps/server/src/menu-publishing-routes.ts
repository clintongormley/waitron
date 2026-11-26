import "@waitron/menu/src/errors.js";
import { now, type Transaction, readVenueClock } from "@waitron/db";
import {
  publishMenu,
  type PatchDraftAnswer,
  readPatchDraft,
  assertPatchReviewed,
  patchLiveMenu,
  replacedLiveDeclarations,
  correctMenuDeclarations,
  queueMenuPublication,
  menuExists,
  listMenuPublications,
  rescheduleMenuPublication,
  cancelMenuPublication,
} from "@waitron/menu";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
} from "@waitron/server-kit";
import { AppError, FALLBACK_LOCALE, type MenuPublicationsAnswer } from "@waitron/shared";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { refreshCorrectedKitchenLines } from "./declaration-correction-kitchen.js";
import type { MenuApiDeps } from "./menu-api-deps.js";
import { run } from "./menu-api-errors.js";
import { checkedTimeZone, localTimeOf, activationInstant } from "./menu-publication-time.js";
import { requireUuidParam, idList } from "./menu-request-fields.js";
import type { TradingContext } from "./trading-context.js";

function requireVenueCfg(deps: MenuApiDeps): TradingContext {
  if (deps.venueCfg === undefined)
    throw new Error("mountMenuApi: venueCfg is required to correct a live menu's allergens");
  return deps.venueCfg;
}

export function mountMenuPublishingRoutes(
  app: Hono,
  deps: MenuApiDeps,
  gated: GatedWork,
  log: Logger,
): void {
  app.post("/management-api/menus/:id/publish", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{ expectedHash?: unknown }>(c);
      const expectedHash = requireString(body.expectedHash, "expectedHash");
      return c.json(
        await gated(c, sessionId, (tx, personId) =>
          publishMenu(tx, menuId, expectedHash, personId),
        ),
      );
    }),
  );

  app.get("/management-api/menus/:id/live", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const answer = await gated(c, sessionId, async (tx): Promise<PatchDraftAnswer | null> => {
        const draft = await readPatchDraft(tx, menuId);
        if (draft === null) return null;
        if (draft.queued.length === 0) return { ...draft, queued: [] };
        const timeZone = checkedTimeZone(await venueTimeZone(tx));
        return {
          ...draft,
          queued: draft.queued.map((edition) => ({
            ...edition,
            local: localTimeOf(new Date(edition.activatesAt), timeZone),
          })),
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/management-api/menus/:id/patch", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{
        baseVersionId?: unknown;
        changes?: unknown;
        queued?: unknown;
        reviewed?: unknown;
      }>(c);
      const baseVersionId = requireUuidParam(
        requireString(body.baseVersionId, "baseVersionId"),
        "MenuVersionId",
      );
      const changes = body.changes;
      if (!Array.isArray(changes))
        throw new AppError("management.request_invalid", { field: "changes" });
      const queued =
        body.queued === undefined ? [] : idList(body.queued, "queued", "MenuVersionId");
      const reviewed = changes.some(
        (change: { field?: unknown } | null) => change?.field === "declarations",
      )
        ? requireString(body.reviewed, "reviewed")
        : undefined;
      const cfg = reviewed === undefined ? undefined : requireVenueCfg(deps);
      return c.json(
        await gated(c, sessionId, async (tx, personId) => {
          const at = now();
          if (reviewed !== undefined)
            await assertPatchReviewed(tx, menuId, baseVersionId, reviewed, at);
          const result = await patchLiveMenu(tx, menuId, baseVersionId, changes, personId, {
            at,
            fallbackLanguage: deps.venueLocale ?? FALLBACK_LOCALE,
            queued,
          });
          if (cfg !== undefined)
            await refreshCorrectedKitchenLines(
              tx,
              cfg,
              await replacedLiveDeclarations(tx, menuId, baseVersionId, result.versionId),
            );
          return result;
        }),
      );
    }),
  );

  app.post("/management-api/products/:id/live-declarations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const productId = requireUuidParam(c.req.param("id"), "ProductId");
      const body = await readJsonBody<{ queued?: unknown }>(c);
      const queued =
        body.queued === undefined ? [] : idList(body.queued, "queued", "MenuVersionId");
      const cfg = requireVenueCfg(deps);
      return c.json(
        await gated(c, sessionId, async (tx, personId) => {
          const { menus, liveChanges } = await correctMenuDeclarations(tx, productId, personId, {
            fallbackLanguage: deps.venueLocale ?? FALLBACK_LOCALE,
            queued,
          });
          await refreshCorrectedKitchenLines(tx, cfg, liveChanges);
          return { menus };
        }),
      );
    }),
  );

  const venueTimeZone = async (tx: Transaction): Promise<string> =>
    (await readVenueClock(tx)).timeZone;

  app.post("/management-api/menus/:id/publications", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const body = await readJsonBody<{ expectedHash?: unknown; activatesAt?: unknown }>(c);
      const expectedHash = requireString(body.expectedHash, "expectedHash");
      const queued = await gated(c, sessionId, async (tx, personId) => {
        const activatesAt = activationInstant(body.activatesAt, await venueTimeZone(tx));
        return queueMenuPublication(tx, menuId, expectedHash, activatesAt, personId);
      });
      return c.json(queued, 201);
    }),
  );

  app.get("/management-api/menus/:id/publications", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const answer = await gated(c, sessionId, async (tx): Promise<MenuPublicationsAnswer> => {
        if (!(await menuExists(tx, menuId)))
          throw new AppError("menu.not_found", { menuId: menuId });
        const timeZone = checkedTimeZone(await venueTimeZone(tx));
        const { live, editions } = await listMenuPublications(tx, menuId);
        return {
          timeZone,
          live:
            live === null ? null : { ...live, local: localTimeOf(new Date(live.since), timeZone) },
          editions: editions.map((edition) => ({
            ...edition,
            local: localTimeOf(new Date(edition.activatesAt), timeZone),
          })),
        };
      });
      return c.json(answer);
    }),
  );

  app.patch("/management-api/menus/:id/publications/:versionId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const versionId = requireUuidParam(c.req.param("versionId"), "MenuVersionId");
      const body = await readJsonBody<{ activatesAt?: unknown }>(c);
      const moved = await gated(c, sessionId, async (tx, authorizedBy) => {
        const activatesAt = activationInstant(body.activatesAt, await venueTimeZone(tx));
        return rescheduleMenuPublication(tx, menuId, versionId, activatesAt, authorizedBy);
      });
      return c.json(moved);
    }),
  );

  app.post("/management-api/menus/:id/publications/:versionId/cancel", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const menuId = requireUuidParam(c.req.param("id"), "MenuId");
      const versionId = requireUuidParam(c.req.param("versionId"), "MenuVersionId");
      await gated(c, sessionId, (tx, personId) =>
        cancelMenuPublication(tx, menuId, versionId, personId),
      );
      return c.body(null, 204);
    }),
  );
}
