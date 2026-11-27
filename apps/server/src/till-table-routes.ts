import { withIssuanceTransaction } from "@waitron/core";
import { type Transaction, withTransaction } from "@waitron/db";
import { type PinThrottle, canUseDeviceProfile, authorize } from "@waitron/identity";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { type JoinSide, JOIN_SIDES, isUuid, AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { captureKitchenActivity } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { parseBillEditExpecteds } from "./bill-editing.js";
import { asObject } from "./bill-payments-api.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import { requestBill } from "./bill-request.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { parseFinishCancellations } from "./finish-party-input.js";
import { finishPartyService } from "./finish-party-service.js";
import { zoneLayouts, layoutOffer } from "./floor-layout-due.js";
import {
  zonesOf,
  roomRevisions,
  refuseStale,
  roomPrints,
  moveChangedRooms,
  sentRevision,
  requiredRevision,
} from "./floor-revision.js";
import { requireTargetTable, whole } from "./floor-today-api.js";
import { joinMergeMembers, writeMerge } from "./floor-today-merges.js";
import { ensureToday, todayReconciliationDue } from "./floor-today-store.js";
import { zoneOfTable, refuseTakenOff } from "./floor-today-table.js";
import { sendingCfg } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import { type SlipsLater, withMovedSlips } from "./moved-slips.js";
import type { BillEditExpected } from "./order-drafts.js";
import {
  seatTable,
  holderOf,
  partyRevision,
  markTableCleared,
  setPartyName,
  setPartyGuestCount,
  memberTables,
  createPartyBill,
  readPartyBills,
} from "./parties.js";
import {
  overrideToCheck,
  withPinCheckAhead,
  withCheck,
  withCheckUnder,
} from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { markServiceStepDone } from "./service-step-done.js";
import { joinTables, moveGuests, splitTable } from "./table-actions.js";
import { listZones } from "./tables.js";
import { groupCommand } from "./till-order-commands.js";
import {
  requireGuestCount,
  parseClosedZoneConfirmation,
  requirePartyParam,
  requireRevision,
  parseDrawerOverride,
  overridePinAttempts,
  requireStepParam,
  requireShownDueAt,
  requireGuestCountOrNull,
  tableActionCommand,
  requireSplitSelection,
  requireSplitGuestCounts,
} from "./till-request-fields.js";
import { run, runBodyLines } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession, assertStillSignedIn, assertRequestDevice } from "./till-session.js";
import { listTablesWithState } from "./working-order-table-state.js";
import { readZoneScope, inScope, checkZones } from "./zone-access.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { Logger } from "./logger.js";
import "./errors.js";

/** The other tables a seat names, absent for none; none may be the path table. */
function requireOtherTables(value: unknown, pathId: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid("withTableIds");
  const ids = value.map((item: unknown) => requireTargetTable(item, "withTableIds"));
  if (ids.includes(pathId.toLowerCase())) throw invalid("withTableIds");
  return [...new Set(ids)];
}
interface JoinMerge {
  moving: string;
  target: string;
  side: JoinSide;
  seats: number | null;
}
function requireMerge(value: unknown, tableId: string): JoinMerge | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("merge");
  const { moving, target, side, seats } = value as Record<string, unknown>;
  const movingId = requireTargetTable(moving, "merge.moving");
  const targetId = requireTargetTable(target, "merge.target");
  if (!JOIN_SIDES.includes(side as JoinSide)) throw invalid("merge.side");
  const merge = {
    moving: movingId,
    target: targetId,
    side: side as JoinSide,
    seats: seats === undefined ? null : whole(seats, "merge.seats", 1, 999),
  };
  if ((merge.moving === tableId) === (merge.target === tableId)) throw invalid("merge");
  return merge;
}
/**
 * `write`, moving by one each room of `tableIds` it changed; refused before it when `check` names a
 * table whose room is no longer at the revision sent.
 */
async function movingRooms<T extends object>(
  tx: Transaction,
  tableIds: readonly string[],
  check: { tableId: string; sent: number } | undefined,
  write: () => Promise<T>,
): Promise<T | (T & { zoneRevisions: Record<string, number> })> {
  const rooms = await zonesOf(tx, tableIds);
  const revisions = await roomRevisions(tx, rooms);
  if (check !== undefined) {
    const zoneId = await zoneOfTable(tx, check.tableId);
    refuseStale(zoneId, check.sent, revisions.get(zoneId)!);
  }
  const before = await roomPrints(tx, rooms);
  const result = await write();
  const after = await roomPrints(tx, rooms);
  const moved = await moveChangedRooms(tx, revisions, before, after);
  return moved.size === 0 ? result : { ...result, zoneRevisions: Object.fromEntries(moved) };
}

export function mountTillTableRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
  catchUpFloor: (tx: Transaction) => ReturnType<typeof ensureToday>,
  fiscal: TillSaleDeps,
): void {
  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const read = async (tx: Transaction) => {
        const scope = await readZoneScope(tx, device.deviceProfileId);
        return (await listTablesWithState(tx, deps.floorAnnotators ?? [], undefined, log)).filter(
          (table) => inScope(scope, table.zoneId),
        );
      };
      const current = await deps.db.withWriteLock(async () => {
        if (await todayReconciliationDue(deps.db, deps.clock.now().instant)) return null;
        return read(deps.db);
      });
      const state =
        current === null
          ? await withTransaction(deps.db, async (tx) => {
              await catchUpFloor(tx);
              return read(tx);
            })
          : current;
      return c.json(state);
    }),
  );

  app.get("/api/zones", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const zones = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const scope = await readZoneScope(tx, device.deviceProfileId);
        const visible = (await listZones(tx)).filter((zone) => inScope(scope, zone.id));
        const ids = visible.map((zone) => zone.id);
        if (ids.length === 0) return [];
        const at = deps.clock.now().instant;
        const modes = new Map(
          (await VENUE_SERVICE.listServiceZones(tx)).map((zone) => [zone.id, zone.serviceMode]),
        );
        const day = await VENUE_SERVICE.readServiceDay(tx, at);
        const states = await VENUE_SERVICE.readZoneClosingStates(tx, ids, at, day);
        const layouts = await zoneLayouts(tx, ids, at, day);
        return visible.map((zone) => {
          const state = states.get(zone.id)!;
          const layout = layouts.get(zone.id)!;
          return {
            ...zone,
            closed: state.closed,
            closesAt: modes.has(zone.id) ? (state.keepOpen?.closesAt ?? null) : null,
            hasPlan: layout.planned,
            layoutSetName: layout.recordedSetName,
            layoutDue: layoutOffer(layout),
            serviceMode: modes.get(zone.id) ?? null,
          };
        });
      });
      return c.json(zones);
    }),
  );

  app.post("/api/tables/:id/seat", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{
        guestCount?: unknown;
        withTableIds?: unknown;
        kitchenNote?: unknown;
        closedZoneId?: unknown;
      }>(c);
      const guestCount = requireGuestCount(body.guestCount);
      const zoneConfirmation = parseClosedZoneConfirmation(body.closedZoneId, personId);
      const initialNote = body.kitchenNote;
      if (initialNote !== undefined && initialNote !== null && typeof initialNote !== "string")
        throw new AppError("kitchen_note.invalid", { field: "note" });
      const withTableIds = requireOtherTables(body.withTableIds, id);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const result = await withTransaction(deps.db, async (tx) => {
        await catchUpFloor(tx);
        await checkZones(tx, session, [
          { tableId: id },
          ...withTableIds.map((tableId) => ({ tableId })),
        ]);
        const seated = await seatTable(tx, cfg, {
          tableId: id,
          guestCount,
          operatorId: personId,
          zoneConfirmation,
        });
        const kitchenNote =
          initialNote === undefined
            ? undefined
            : await VENUE_SERVICE.writeKitchenNote(tx, { partyId: seated.partyId }, 0, initialNote);
        for (const otherId of withTableIds) {
          if ((await holderOf(tx, otherId)) === seated.partyId) continue;
          await joinTables(tx, sendCfg, seated.partyId, otherId, {
            expectedEdits: [
              { billId: seated.tabId, editorVersion: 0, draftId: null, draftRevision: null },
            ],
            expectedPartyRevision: await partyRevision(tx, seated.partyId),
            operatorId: personId,
            otherPartyId: null,
          });
          await joinMergeMembers(tx, sendCfg, seated.partyId, otherId, personId);
        }
        // After the writes, so a seat's and a join's own refusals answer first, as on the join route.
        await refuseTakenOff(tx, [id, ...withTableIds]);
        const revision =
          withTableIds.length === 0 ? seated.revision : await partyRevision(tx, seated.partyId);
        return {
          ...seated,
          revision,
          ...(kitchenNote === undefined
            ? {}
            : {
                kitchenNote: {
                  ...kitchenNote,
                  scope: { partyId: seated.partyId },
                  ownerRevision: revision,
                },
              }),
        };
      });
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/finish", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = await readJsonBody<{
        expectedPartyRevision?: unknown;
        expectedEdits?: unknown;
        submissionId?: unknown;
        cancellations?: unknown;
        collect?: unknown;
        approver?: { personId?: unknown; pin?: unknown };
      }>(c);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const resolution = parseFinishCancellations(body);
      const approver = parseDrawerOverride(body.approver);
      const refundHandoff =
        resolution.cancellations?.some((item) => item.refundHandoff === true) === true;
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = refundHandoff
        ? await overrideToCheck(
            deps.db,
            { sessionId: session.sessionId, permission: "sale.refund" },
            approver,
          )
        : undefined;
      const result = await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await assertStillSignedIn(tx, session);
          const device = await assertDeviceStillProven(tx, {
            device: session.device,
            tokenHash: null,
          });
          assertProfileAction(device, "take-orders");
          if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
            throw new AppError("device_profile.not_admitted", {});
          const current = { ...session, device };
          await catchUpFloor(tx);
          await checkZones(tx, current, [
            { partyId },
            ...(resolution.collect?.bills ?? []).map((bill) => ({ orderId: bill.billId })),
          ]);
          const refund = refundHandoff
            ? await authorize(
                tx,
                {
                  sessionId: session.sessionId,
                  permission: "sale.refund",
                  override: withCheck(approver, checked),
                },
                attempts,
              )
            : undefined;
          return finishPartyService(
            tx,
            sendingCfg(requestCfg(deps.cfg, current), c, device),
            {
              ...resolution,
              admission: deps.admission,
              approver: withCheckUnder(approver, checked, attempts),
              refundApprovedBy: refund?.viaOverride === true ? refund.authorizedBy : null,
              partyId,
              expectedPartyRevision,
              operatorId: personId,
              expectedEdits: body.expectedEdits as BillEditExpected[],
            },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(result);
    }),
  );

  app.post("/api/tables/:id/cleared", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ tableId: id }]);
        return markTableCleared(tx, id);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/parties/:id/bill-request", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      const { requested } = body;
      if (typeof requested !== "boolean") throw invalid("requested");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return requestBill(tx, partyId, requested, args);
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/service-steps/:stepId/done", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const stepId = requireStepParam(c.req.param("stepId"));
      const dueAt = requireShownDueAt(asObject(await readRawJsonBody<unknown>(c)).dueAt);
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return markServiceStepDone(tx, {
          deviceProfileId: session.device.deviceProfileId,
          partyId,
          stepId,
          dueAt,
          personId: session.personId,
          nowMs: Date.now(),
        });
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/name", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      // The wire always carries a name; null or "" clears it.
      if (body.name === undefined) throw invalid("name");
      const named = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return setPartyName(tx, { partyId, name: body.name, expectedPartyRevision });
      });
      return c.json(named);
    }),
  );

  app.put("/api/parties/:id/guests", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const guestCount = requireGuestCountOrNull(body.guestCount);
      const counted = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return setPartyGuestCount(tx, { partyId, guestCount, expectedPartyRevision });
      });
      return c.json(counted);
    }),
  );

  for (const [path, act, field] of [
    ["move", moveGuests, "toTableId"],
    ["join", joinTables, "tableId"],
  ] as const) {
    app.post(`/api/parties/:id/${path}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "take-orders" });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
        const body = asObject(await readRawJsonBody<unknown>(c));
        const tableId = requireTargetTable(body[field], field);
        const command = tableActionCommand(personId, body);
        if (path === "move")
          command.zoneConfirmation = parseClosedZoneConfirmation(body.closedZoneId, personId);
        const merge = path === "join" ? requireMerge(body.merge, tableId) : null;
        const sent =
          path === "join" ? (merge === null ? sentRevision : requiredRevision)(body) : undefined;
        const sendCfg = sendingCfg(cfg, c, session.device);
        const result = await withTransaction(deps.db, async (tx) => {
          await catchUpFloor(tx);
          await checkZones(tx, session, [{ partyId }, { tableId }]);
          const heldBefore = await memberTables(tx, partyId);
          const check = sent === undefined ? undefined : { tableId, sent };
          return movingRooms(tx, [...heldBefore, tableId], check, async () => {
            const actAndMerge = async (slipsLater?: SlipsLater) => {
              const acted = await act(tx, sendCfg, partyId, tableId, { ...command, slipsLater });
              await joinMergeMembers(tx, sendCfg, acted.partyId, tableId, personId, slipsLater);
              if (merge !== null) {
                const held = merge.moving === tableId ? merge.target : merge.moving;
                if (!heldBefore.includes(held)) throw invalid("merge");
                await writeMerge(tx, {
                  movingId: merge.moving,
                  targetId: merge.target,
                  side: merge.side,
                  seats: merge.seats,
                  free: false,
                });
              }
              return acted;
            };
            let acted: Awaited<ReturnType<typeof actAndMerge>>;
            if (merge === null) {
              acted = await actAndMerge();
            } else {
              // A merge can pass guests on after the join, so the kitchen is told once, at the end.
              acted = await withMovedSlips(
                tx,
                sendCfg,
                { tables: [merge.moving, merge.target], targetGroupOf: merge.target },
                actAndMerge,
              );
            }
            // Last, so the route's own refusals answer first.
            await refuseTakenOff(tx, [tableId]);
            return acted;
          });
        });
        return c.json(result);
      }),
    );
  }

  app.post("/api/parties/:id/split-table", (c) =>
    runBodyLines(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const { tableId } = body;
      if (tableId === undefined) throw invalid("tableId");
      // A malformed id names no table of the party.
      if (typeof tableId !== "string" || !isUuid(tableId)) {
        throw new AppError("table.not_joined", { tableId: String(tableId), partyId });
      }
      const selection = requireSplitSelection(body.selection);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const guestCounts = requireSplitGuestCounts(body.guestCounts);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const attendance =
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock };
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await catchUpFloor(tx);
          await checkZones(tx, session, [
            { partyId },
            ...selection.wholeBillIds.map((orderId) => ({ orderId })),
            ...selection.loose.map(({ billId: orderId }) => ({ orderId })),
          ]);
          const held = [...(await memberTables(tx, partyId)), tableId.toLowerCase()];
          return movingRooms(tx, held, undefined, async () => {
            const split = await splitTable(
              tx,
              sendCfg,
              partyId,
              tableId.toLowerCase(),
              selection,
              {
                expectedPartyRevision,
                operatorId: personId,
                guestCounts,
                expectedEdits: parseBillEditExpecteds(body.expectedEdits),
              },
              attendance,
            );
            for (const source of split.looseSourceIds)
              await issueIfFullyPaid(tx, fiscal, sendCfg, source, personId);
            if (split.looseSourceIds.length > 0)
              await captureKitchenActivity(tx, attendance, personId, [
                ...split.looseSourceIds,
                split.billIds.at(-1)!,
              ]);
            return { partyId: split.partyId, billIds: split.billIds };
          });
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const created = await withTransaction(deps.db, async (tx) => {
        await catchUpFloor(tx);
        await checkZones(tx, session, [{ partyId }]);
        return createPartyBill(tx, cfg, partyId, { expectedPartyRevision });
      });
      return c.json(created);
    }),
  );

  app.get("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const bills = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return readPartyBills(tx, partyId, log);
      });
      return c.json(bills);
    }),
  );
}
