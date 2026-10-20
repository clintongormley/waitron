import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { diningTables, partyTables, withTransaction } from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import type { AllergyCommand, AllergyPatch, AllergySendTarget } from "@waitron/module";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import type { Logger } from "./logger.js";
import { checkAndBumpParty, runServiceCommand } from "./parties.js";
import {
  allergyTargets,
  applyPartyAllergyPatch,
  normaliseAllergyPatch,
  readAllergySendView,
  readPartyAllergyView,
  survivingParty,
} from "./party-allergy.js";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import { requestCfg } from "./request-config.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}
function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(field);
  return value.toLowerCase();
}
function sendTarget(input: unknown): AllergySendTarget {
  const body = asObject(input);
  switch (body.kind) {
    case "draft": {
      if (!Array.isArray(body.lineIds)) invalid("lineIds");
      return {
        kind: "draft",
        draftId: id(body.draftId, "draftId"),
        lineIds: body.lineIds.map((value: unknown) => id(value, "lineIds")),
      };
    }
    case "lines": {
      if (
        !Array.isArray(body.lineNos) ||
        !body.lineNos.every(
          (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0,
        )
      )
        invalid("lineNos");
      return {
        kind: "lines",
        orderId: id(body.orderId, "orderId"),
        lineNos: body.lineNos as number[],
      };
    }
    case "group":
      return { kind: "group", groupId: id(body.groupId, "groupId") };
    case "held-line":
      return { kind: "held-line", lineId: id(body.lineId, "lineId") };
    case "course":
      return {
        kind: "course",
        orderId: id(body.orderId, "orderId"),
        courseId: id(body.courseId, "courseId"),
      };
    default:
      return invalid("kind");
  }
}
function command(input: unknown): AllergyCommand {
  const body = asObject(input);
  const submissionId = id(body.submissionId, "submissionId");
  if (
    typeof body.expectedPartyRevision !== "number" ||
    !Number.isSafeInteger(body.expectedPartyRevision) ||
    body.expectedPartyRevision < 0
  )
    invalid("expectedPartyRevision");
  return {
    submissionId,
    expectedPartyRevision: body.expectedPartyRevision,
    ...(body.allergy === undefined
      ? {}
      : { allergy: normaliseAllergyPatch(body.allergy as AllergyPatch) }),
  };
}

export function mountPartyAllergyApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  for (const method of ["get", "put", "post"] as const) {
    const path = `/api/parties/:id/allergy${method === "post" ? "/send-preview" : ""}`;
    app[method](path, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, {
          action: "take-orders",
          passive: method === "get",
        });
        const requestedId = id(c.req.param("id"), "partyId");
        const body = method === "get" ? undefined : await readRawJsonBody<unknown>(c);
        return c.json(
          await withTransaction(deps.db, async (tx) => {
            await assertStillSignedIn(tx, session);
            const device = await assertDeviceStillProven(tx, {
              device: session.device,
              tokenHash: null,
            });
            if (device.locationId !== deps.cfg.locationId)
              throw new AppError("device.unauthorized", {});
            assertProfileAction(device, "take-orders");
            if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
              throw new AppError("device_profile.not_admitted", {});
            const partyId = await survivingParty(tx, requestedId);
            const [table] = await tx
              .select({ id: diningTables.id })
              .from(partyTables)
              .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
              .where(
                and(
                  eq(partyTables.partyId, partyId),
                  eq(diningTables.locationId, deps.cfg.locationId),
                ),
              )
              .limit(1);
            if (table === undefined)
              throw new AppError("party.not_found", { partyId: requestedId });
            await checkZones(tx, deps.cfg, { device }, [{ partyId }]);
            const cfg = requestCfg(deps.cfg, session);
            if (method === "get") return readPartyAllergyView(tx, cfg, partyId);
            if (method === "post") return readAllergySendView(tx, cfg, partyId, sendTarget(body));
            const parsed = command(body);
            return runServiceCommand(
              tx,
              { kind: "party", partyId },
              parsed.submissionId,
              "party.allergy",
              {
                partyId,
                operatorId: session.personId,
                ...parsed,
              },
              async () => {
                await checkAndBumpParty(tx, partyId, parsed.expectedPartyRevision, "open");
                const view = await readPartyAllergyView(tx, cfg, partyId);
                if (parsed.allergy !== undefined) {
                  const changes = await applyPartyAllergyPatch(
                    tx,
                    partyId,
                    parsed.allergy,
                    session.personId,
                    allergyTargets(view),
                  );
                  await enqueueKitchenAllergyChanges(tx, cfg, changes);
                }
                return readPartyAllergyView(tx, cfg, partyId);
              },
            );
          }),
        );
      }),
    );
  }
}
