import type { ResourceChange } from "@waitron/shared";
import { id, json, table } from "./columns.js";

/**
 * What changed, written by the change trigger and taken out again by the transaction that caused
 * it (`../change-log.ts`).
 *
 * Two columns and no more. Nothing reads a sequence, a written-at time or a copy of the resource
 * name: a row is inserted, delivered and deleted inside one transaction, and the dashboard's live
 * API collects a batch's identities into a Map keyed by the identity itself before flushing them
 * together (`apps/server/src/live-api.ts`, the `pending` map), so two changes arriving in either
 * order reach the client the same way.
 *
 * `local`: this node's own signal to its own dashboard, never venue data. It must not travel in a
 * backup or a replication stream, and a standby inheriting a half-drained log would deliver
 * changes for work it did not do.
 *
 * It is deliberately NOT one of its own change sources — see `CORE_CHANGE_SOURCES` in
 * `../classification.ts`, which filters it out, and the test that pins that.
 */
export const changeLog = table("change_log", {
  id: id("id").primaryKey().defaultRandom(),
  payload: json<ResourceChange>("payload").notNull(),
});
