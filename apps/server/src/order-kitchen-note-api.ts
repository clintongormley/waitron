import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { devices, deviceProfiles, withTransaction } from "@waitron/db";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
} from "./device-session.js";
import type { Logger } from "./logger.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import {
  readOrderKitchenNotes,
  readPartyKitchenNote,
  requireKitchenNoteOrder,
  setOrderKitchenNote,
} from "./order-kitchen-note.js";
import "./errors.js";

function revision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new AppError("management.request_invalid", { field });
  return value;
}

export function mountOrderKitchenNoteApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
): void {
  for (const party of [false, true]) {
    const path = party ? "/api/parties/:id/kitchen-note" : "/api/working-orders/:id/kitchen-note";
    for (const method of ["get", "put"] as const)
      app[method](path, (c) =>
        run(c, log, async () => {
          const session = await requireSession(deps, c, {
            action: "take-orders",
            passive: method === "get",
          });
          const id = c.req.param("id").toLowerCase();
          if (!isUuid(id)) {
            if (party) throw new AppError("party.not_found", { partyId: id });
            throw new AppError("working_order.not_found", { workingOrderId: id });
          }
          const body = method === "get" ? undefined : asObject(await readRawJsonBody<unknown>(c));
          return c.json(
            await withTransaction(deps.db, async (tx) => {
              await assertStillSignedIn(tx, session);
              const [row] = await tx
                .select(deviceBindingColumns)
                .from(devices)
                .innerJoin(deviceProfiles, deviceProfileJoin)
                .where(eq(devices.id, session.deviceId));
              const device = toDeviceBinding(session.deviceId, row!);
              if (device.locationId !== deps.cfg.locationId)
                throw new AppError("device.unauthorized", {});
              assertProfileAction(device, "take-orders");
              if (!party) await requireKitchenNoteOrder(tx, deps.cfg, id);
              const snapshot = party
                ? await readPartyKitchenNote(tx, deps.cfg, id)
                : (await readOrderKitchenNotes(tx, [id])).get(id)!;
              await checkZones(tx, deps.cfg, { device }, [
                "partyId" in snapshot.scope ? { partyId: snapshot.scope.partyId } : { orderId: id },
              ]);
              if (body === undefined) return snapshot;
              if (typeof body.submissionId !== "string" || !isUuid(body.submissionId))
                throw new AppError("management.request_invalid", { field: "submissionId" });
              if (!party && body.partyId !== null)
                throw new AppError("management.request_invalid", { field: "partyId" });
              if (body.note !== null && typeof body.note !== "string")
                throw new AppError("kitchen_note.invalid", { field: "note" });
              return setOrderKitchenNote(
                tx,
                deps.db,
                deps.cfg,
                party ? { partyId: id } : { workingOrderId: id },
                {
                  submissionId: body.submissionId.toLowerCase(),
                  expectedNoteRevision: revision(body.expectedNoteRevision, "expectedNoteRevision"),
                  expectedOwnerRevision: revision(
                    party ? body.expectedPartyRevision : body.expectedOrderRevision,
                    party ? "expectedPartyRevision" : "expectedOrderRevision",
                  ),
                  note: body.note,
                  operatorId: session.personId,
                  deviceId: session.deviceId,
                },
              );
            }),
          );
        }),
      );
  }
}
