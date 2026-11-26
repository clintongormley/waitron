import type { Transaction } from "@waitron/db";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import type { Hono } from "hono";
import type { GatedWork } from "./content-translations-api.js";
import { run } from "./menu-api-errors.js";
import { requireUuidParam } from "./menu-request-fields.js";

/** Everything that differs between one kind of modifier list and another. */
interface ListSurface<TList, TDependants> {
  /** The path segment under `/management-api/modifiers` that says which kind of list this is. */
  segment: string;
  /** What a refused `:id` is called in `shared.invalid_id`'s `kind` param. */
  idKind: string;
  /** The JSON key the collection read answers under. */
  collectionKey: string;
  /** The JSON key every single-list route answers under. */
  itemKey: string;
  list: (tx: Transaction) => Promise<TList[]>;
  read: (tx: Transaction, id: string) => Promise<TList>;
  create: (tx: Transaction, body: unknown) => Promise<TList>;
  update: (tx: Transaction, id: string, body: unknown) => Promise<TList>;
  remove: (tx: Transaction, id: string) => Promise<void>;
  dependants: (tx: Transaction, id: string) => Promise<TDependants>;
}
/**
 * Mount the six routes that serve one kind of modifier list. Both kinds sit UNDER
 * `/management-api/modifiers` because a dish's one attachment list holds either kind. A
 * `/management-api/modifiers/:id` route registered ahead of these would swallow both segments.
 */
export function mountListSurface<TList, TDependants>(
  app: Hono,
  gated: GatedWork,
  log: Logger,
  surface: ListSurface<TList, TDependants>,
): void {
  // `as const` keeps these as a template literal TYPE rather than `string`, and Hono reads the `:id`
  // out of that type.
  const collection = `/management-api/modifiers/${surface.segment}` as const;
  const one = `${collection}/:id` as const;
  app.get(collection, (c) =>
    run(c, log, async () => {
      const lists = await gated(c, requireManagementSession(c), (tx) => surface.list(tx));
      return c.json({ [surface.collectionKey]: lists });
    }),
  );
  app.post(collection, (c) =>
    run(c, log, async () => {
      // Session before body: an unauthenticated request is refused without its payload being read.
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const created = await gated(c, sessionId, (tx) => surface.create(tx, body));
      return c.json({ [surface.itemKey]: created }, 201);
    }),
  );
  app.get(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const list = await gated(c, requireManagementSession(c), (tx) => surface.read(tx, id));
      return c.json({ [surface.itemKey]: list });
    }),
  );
  app.patch(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody(c);
      const updated = await gated(c, sessionId, (tx) => surface.update(tx, id, body));
      return c.json({ [surface.itemKey]: updated });
    }),
  );
  app.delete(one, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      await gated(c, requireManagementSession(c), (tx) => surface.remove(tx, id));
      return c.json({ ok: true });
    }),
  );
  // What deleting this list would touch — read by the dashboard's Used by popup and its delete
  // confirmation.
  app.get(`${one}/dependants`, (c) =>
    run(c, log, async () => {
      const id = requireUuidParam(c.req.param("id"), surface.idKind);
      const dependants = await gated(c, requireManagementSession(c), (tx) =>
        surface.dependants(tx, id),
      );
      return c.json({ dependants });
    }),
  );
}
