import { withTransaction } from "@waitron/db";
import { type PinThrottle, canUseDeviceProfile } from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { isUuid, AppError } from "@waitron/shared";
import type { Hono } from "hono";
import { invalid } from "./bill-allocation.js";
import { parseBillEditExpected, parseBillEditExpecteds } from "./bill-editing.js";
import { asObject } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { listPrintProblems } from "./kitchen-ticket-problems.js";
import { parseLateSend, withLateSendCheck } from "./late-send.js";
import { sendingCfg } from "./made-here.js";
import {
  reorderHeldGroups,
  splitHeldLineIntoUnits,
  moveLinesToGroup,
} from "./order-group-edits.js";
import { bumpGroupReady } from "./order-group-readiness.js";
import { listOrderGroups, readCurrentOrders } from "./order-group-reads.js";
import { fireGroup, fireHeldLine } from "./order-group-release.js";
import { snoozeReminder, unsnoozeReminder } from "./order-group-reminders.js";
import { type SubmitGroupsInput, submitGroups } from "./order-group-submission.js";
import { passReleaseRefusal } from "./pass-release.js";
import { requestCfg } from "./request-config.js";
import { groupCommand, allergyCommand, recheckFireSession } from "./till-order-commands.js";
import {
  requirePartyParam,
  parseSubmittedGroups,
  joinGroupOf,
  billOf,
  parseLineQuantities,
  parseMoveTarget,
} from "./till-request-fields.js";
import { run, runSubmitGroups, runBodyGroup } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { requireSession, assertStillSignedIn } from "./till-session.js";
import { markServed, unmarkServed, markGroupServed } from "./working-order-serving.js";
import { checkZones } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillGroupRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  app.get("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groups = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return {
          ...(await listOrderGroups(tx, partyId)),
          printProblems: await listPrintProblems(tx, partyId),
        };
      });
      return c.json(groups);
    }),
  );

  app.get("/api/parties/:id/current-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const current = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return readCurrentOrders(tx, partyId);
      });
      return c.json(current);
    }),
  );

  app.post("/api/parties/:id/groups", (c) =>
    runSubmitGroups(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitGroupsInput = {
        ...groupCommand(personId, body),
        ...allergyCommand(body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
        groups: parseSubmittedGroups(body.groups),
        ...joinGroupOf(body),
        ...billOf(body),
      };
      const lateSend = parseLateSend(body.lateSend);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return submitGroups(
            tx,
            sendCfg,
            partyId,
            { ...input, lateSend: late },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(submitted);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/fire", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lateSend = parseLateSend(body.lateSend);
      const command = { ...groupCommand(personId, body), ...allergyCommand(body) };
      const fired = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withTransaction(deps.db, async (tx) => {
          const current = await recheckFireSession(tx, session);
          await checkZones(tx, current, [{ partyId }]);
          return fireGroup(
            tx,
            requestCfg(deps.cfg, current),
            partyId,
            groupId,
            { ...command, lateSend: late },
            undefined,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(fired);
    }),
  );

  for (const [step, command, action] of [["ready", bumpGroupReady, "prepare-orders"]] as const) {
    app.post(`/api/parties/:id/groups/:gid/${step}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action });
        const refused = passReleaseRefusal(session.device);
        if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
        const { personId } = session;
        const partyId = requirePartyParam(c.req.param("id"));
        const groupId = c.req.param("gid");
        if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
        const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return command(
            tx,
            partyId,
            groupId,
            args,
            { personId },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        });
        return c.json(answer);
      }),
    );
  }

  // Serving is an operational fact: nothing here reaches a filed sale.
  for (const [path, command] of [
    ["served", markServed],
    ["unserved", unmarkServed],
  ] as const) {
    app.post(`/api/parties/:id/${path}`, (c) =>
      runBodyGroup(c, log, async () => {
        const session = await requireSession(deps, c, { action: "hand-over-orders" });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id"));
        const body = asObject(await readRawJsonBody<unknown>(c));
        const args = groupCommand(personId, body);
        const items = parseLineQuantities(body.items, "items");
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return command(
            tx,
            cfg,
            partyId,
            items,
            args,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        });
        return c.json(answer);
      }),
    );
  }

  app.post("/api/parties/:id/groups/:gid/served", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "hand-over-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return markGroupServed(
          tx,
          cfg,
          partyId,
          groupId,
          args,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/snooze", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      if (typeof body.minutes !== "number") throw invalid("minutes");
      const minutes = body.minutes;
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return snoozeReminder(tx, cfg, partyId, groupId, minutes, args);
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/unsnooze", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return unsnoozeReminder(tx, cfg, partyId, groupId, args);
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/groups/order", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const { heldGroupIds } = body;
      if (!Array.isArray(heldGroupIds) || !heldGroupIds.every((id) => typeof id === "string")) {
        throw invalid("heldGroupIds");
      }
      const reordered = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return reorderHeldGroups(
          tx,
          partyId,
          heldGroupIds as string[],
          command,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(reordered);
    }),
  );

  app.post("/api/parties/:id/groups/fire-line", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lateSend = parseLateSend(body.lateSend);
      const command = { ...groupCommand(session.personId, body), ...allergyCommand(body) };
      if (typeof body.lineId !== "string" || !isUuid(body.lineId)) throw invalid("lineId");
      const lineId = body.lineId.toLowerCase();
      const answer = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
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
          const cfg = requestCfg(deps.cfg, current);
          await checkZones(tx, current, [{ partyId }]);
          return fireHeldLine(
            tx,
            cfg,
            partyId,
            lineId,
            { ...command, lateSend: late },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/split-line", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(session.personId, body);
      if (typeof body.lineId !== "string" || !isUuid(body.lineId)) throw invalid("lineId");
      const lineId = body.lineId.toLowerCase();
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return splitHeldLineIntoUnits(
          tx,
          cfg,
          partyId,
          lineId,
          { ...command, expectedEdit: parseBillEditExpected(body.expectedEdit) },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/move", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const moves = parseLineQuantities(body.moves, "moves");
      const target = parseMoveTarget(body.target);
      const moved = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return moveLinesToGroup(
          tx,
          cfg,
          partyId,
          moves,
          target,
          { ...command, expectedEdits: parseBillEditExpecteds(body.expectedEdits) },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(moved);
    }),
  );
}
