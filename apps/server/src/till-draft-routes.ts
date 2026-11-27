import { withIssuanceTransaction } from "@waitron/core";
import { workingOrders, parties, withTransaction, workingOrderLines } from "@waitron/db";
import type { PinThrottle } from "@waitron/identity";
import { readRawJsonBody, readJsonBody, requireUuidParam } from "@waitron/server-kit";
import { AppError, thousandthsToDecimal } from "@waitron/shared";
import { inArray, asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { invalid } from "./bill-allocation.js";
import { readBillEditState, parseBillEditExpected } from "./bill-editing.js";
import { asObject, submissionIdOf } from "./bill-payments-api.js";
import { readBillBalance, issueIfFullyPaid } from "./bill-payments.js";
import { findDeadEnds, availableStations } from "./dead-ends.js";
import { parseLateSend, withLateSendCheck } from "./late-send.js";
import { sendingCfg } from "./made-here.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveWouldSend } from "./move-bill.js";
import { requireDining } from "./order-dining.js";
import {
  draftPricingLine,
  readDrafts,
  type BillEditState,
  saveDraft,
  splitDraft,
  takeOverDraft,
  type SubmitDraftInput,
  submitDraft,
} from "./order-drafts.js";
import { partyFamily, readBillsOfParties, partyZone } from "./parties.js";
import { requestCfg } from "./request-config.js";
import { readBillLines } from "./stored-order-lines.js";
import { groupCommand, allergyCommand } from "./till-order-commands.js";
import { named } from "./till-order-zones.js";
import {
  requireDraftPartyParam,
  requirePartyParam,
  requireDraftId,
  requireRevision,
  requireDraftParam,
  parseDraftGroups,
  parseClosedZoneConfirmation,
  joinGroupOf,
} from "./till-request-fields.js";
import {
  run,
  runSaveDraft,
  runDeadEndsDraft,
  runBodyGroup,
  runDeadEndsOrder,
} from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession } from "./till-session.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { paysAfterSending } from "./working-order-context.js";
import { unsentDishLines } from "./working-order-kitchen-fire.js";
import { priceOrderLines } from "./working-order-pricing.js";
import { checkZones } from "./zone-access.js";
import type { TillSaleDeps } from "./working-order-context.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillDraftRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
  fiscal: TillSaleDeps,
): void {
  app.get("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        const drafts = await readDrafts(tx, partyId);
        const family = await partyFamily(tx, partyId);
        const bills = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(inArray(workingOrders.partyId, family))
          .orderBy(
            asc(workingOrders.openedAt),
            asc(workingOrders.orderNumber),
            asc(workingOrders.id),
          );
        const billEdits: BillEditState[] = [];
        for (const bill of bills) billEdits.push(await readBillEditState(tx, bill.id));
        return { drafts, billEdits };
      });
      return c.json(answer);
    }),
  );

  app.get("/api/parties/:id/split-sources", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        const family = (await readBillsOfParties(tx, [partyId], log)).get(partyId)!;
        const bills = [];
        for (const bill of family) {
          if (bill.partyId !== partyId) continue;
          if (bill.status !== "open" && bill.status !== "placed") continue;
          bills.push({
            billId: bill.workingOrderId,
            lines: await readBillLines(tx, bill.workingOrderId),
            balance: await readBillBalance(tx, bill.workingOrderId),
          });
        }
        const [party] = await tx
          .select({ revision: parties.revision })
          .from(parties)
          .where(eq(parties.id, partyId));
        // A press sends this revision with these rows, so it is read in their transaction. An id
        // naming no party has no rows, and a split sent for it is refused whatever its revision.
        return { partyRevision: party?.revision ?? 0, bills };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/drafts", (c) =>
    runSaveDraft(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const draftId = requireDraftId(body.draftId);
      const revision = requireRevision(body.revision);
      const draft = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [{ partyId }]);
          const result = await saveDraft(
            tx,
            partyId,
            personId,
            {
              billId: body.billId,
              draftId,
              revision,
              lines: body.lines,
              expectedEdit: parseBillEditExpected(body.expectedEdit),
            },
            deps.attendance,
          );
          const invoice = await issueIfFullyPaid(
            tx,
            fiscal,
            sendingCfg(cfg, c, session.device),
            result.edit.billId,
            personId,
          );
          return { ...result, ...(invoice === null ? {} : { invoice }) };
        },
        log,
      );
      return c.json(draft);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/split", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(session.personId, body);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [{ partyId }]);
          const split = await splitDraft(
            tx,
            cfg,
            partyId,
            draftId,
            {
              ...command,
              expectedEdit: parseBillEditExpected(body.expectedEdit),
              lineIds: body.lineIds,
            },
            deps.attendance,
          );
          await issueIfFullyPaid(
            tx,
            fiscal,
            sendingCfg(cfg, c, session.device),
            split.source.edit.billId,
            session.personId,
          );
          return split;
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/take-over", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return takeOverDraft(
          tx,
          partyId,
          draftId,
          personId,
          {
            revision,
            expectedEdit: parseBillEditExpected(body.expectedEdit),
            submissionId: submissionIdOf(body),
          },
          deps.attendance,
        );
      });
      return c.json(draft);
    }),
  );

  app.post("/api/dead-ends/draft", (c) =>
    runDeadEndsDraft(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{ partyId: string; draftId: string; lineIds: string[] }>(c);
      const partyId = requireDraftPartyParam(body.partyId);
      const draftId = requireDraftParam(body.draftId);
      if (!Array.isArray(body.lineIds)) throw invalid("lineIds");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        const at = new Date();
        const draft = (await readDrafts(tx, partyId)).find((entry) => entry.id === draftId);
        if (draft === undefined) throw new AppError("draft.not_found", { draftId });
        const ids = new Set(body.lineIds);
        const selected = draft.lines.filter((line) => ids.has(line.id));
        if (selected.length !== ids.size || selected.some((line) => line.sourceLineId !== null))
          throw invalid("lineIds");
        const lines = selected.filter((line) => line.sourceLineId === null);
        const zoneId = await partyZone(tx, partyId);
        const priced = await priceOrderLines(
          tx,
          cfg,
          draft.billId,
          lines.map((line) => draftPricingLine(line, draft.lines.indexOf(line))),
          zoneId ?? undefined,
          undefined,
          "ignore",
          "none",
        );
        const parents = priced.lineRows.filter((line) => line.parentLineId === null);
        return {
          sends: true,
          deadEnds: await findDeadEnds(
            tx,
            zoneId,
            lines.map((line, index) => ({
              key: line.id,
              productId: parents[index]!.productId!,
              quantity: line.quantity,
              makeAt: line.makeAt ?? null,
            })),
            at,
          ),
          stations: await availableStations(tx, at),
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/submit", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitDraftInput = {
        ...groupCommand(personId, body),
        ...allergyCommand(body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
        draftRevision: requireRevision(body.draftRevision, "draftRevision"),
        groups: parseDraftGroups(body.groups),
        zoneConfirmation: parseClosedZoneConfirmation(body.closedZoneId, personId),
        ...joinGroupOf(body),
        dining: requireDining(body.dining),
      };
      const lateSend = parseLateSend(body.lateSend);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            await requireEconomicWrite(tx, deps.cfg, deps.admission);
            await checkZones(tx, session, [{ partyId }]);
            const result = await submitDraft(
              tx,
              sendCfg,
              partyId,
              draftId,
              { ...input, lateSend: late },
              deps.attendance,
              (billId) => issueIfFullyPaid(tx, fiscal, sendCfg, billId, personId),
            );
            return result;
          },
          log,
        ),
      );
      return c.json(submitted);
    }),
  );

  // A tab does not re-price: the stored locked gross rides back verbatim. The revision is read in
  // the same transaction, so it is the one these lines are at.
  app.post("/api/dead-ends/order", (c) =>
    runDeadEndsOrder(c, log, async () => {
      const session = await requireSession(deps, c);
      const body = await readJsonBody<{ workingOrderId: string; toZoneId?: string }>(c);
      const id = requireUuidParam(body.workingOrderId, "WorkingOrderId");
      if (body.toZoneId !== undefined) requireUuidParam(body.toZoneId, "ServiceZoneId");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(
          tx,
          session,
          named({ orderId: id }, body.toZoneId !== undefined && { zoneId: body.toZoneId }),
        );
        const at = new Date();
        const [order] = await tx
          .select({
            status: workingOrders.status,
            partyId: workingOrders.partyId,
            revision: workingOrders.revision,
          })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (order === undefined || (order.status !== "open" && order.status !== "placed"))
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const context = await VENUE_SERVICE.findOrderContext(tx, id);
        const zoneId = body.toZoneId ?? context?.zoneId ?? null;
        const unsent = await unsentDishLines(tx, id);
        const sends =
          unsent.length > 0 &&
          (body.toZoneId === undefined
            ? (context?.serviceMode ?? "prepay") === "prepay" ||
              (order.partyId === null && paysAfterSending(context?.serviceMode))
            : await moveWouldSend(tx, id, body.toZoneId));
        const chosen =
          unsent.length === 0
            ? []
            : await tx
                .select({ id: workingOrderLines.id, makeAt: workingOrderLines.makeAtStationId })
                .from(workingOrderLines)
                .where(
                  inArray(
                    workingOrderLines.id,
                    unsent.map((line) => line.id),
                  ),
                );
        const makeAtById = new Map(chosen.map((line) => [line.id, line.makeAt]));
        return {
          sends,
          deadEnds: sends
            ? await findDeadEnds(
                tx,
                zoneId,
                unsent
                  .filter((line) => line.productId !== null)
                  .map((line) => ({
                    key: line.id,
                    productId: line.productId!,
                    quantity: thousandthsToDecimal(line.quantity),
                    makeAt: makeAtById.get(line.id) ?? null,
                  })),
                at,
              )
            : [],
          stations: await availableStations(tx, at),
          revision: order.revision,
        };
      });
      return c.json(answer);
    }),
  );
}
