// A join approved and collected whose new box stopped before its copy store answered, then was
// reset: the main box's chart still lists that box, and its start-up peer check counts a listed box
// only once it holds a `nodes` row for it (`boot-peer-check.ts`, `deps.joined`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodes, openVenueDatabase, readNodeMembership } from "@waitron/db";
import { readPairLink } from "@waitron/node-db";
import { withCapturedStdout } from "./testing/boot-harness.js";
import {
  BOOT_MS,
  boundedStart,
  firstRowIn,
  logLines,
  readOutside,
} from "./testing/spare-join-scenario.js";
import { JoinPairs } from "./testing/spare-join-pair.js";

const UNTIMED_MS = 60_000;
// S starts for setup, after its join stopped, after the reset was asked for and after it ran; M
// starts once and twice more.
const RESET_SPARE_TIMEOUT_MS = 7 * BOOT_MS + UNTIMED_MS;

describe("a reset spare and the main box's start", () => {
  const pairs = new JoinPairs();

  beforeAll(() => pairs.open("waitron-join-reset-"));

  afterAll(async () => {
    const failures = await pairs.close();
    if (failures.length > 0) throw new AggregateError(failures, "reset spare teardown failed");
  });

  it(
    "a box whose join stopped before its copy store answered, then was reset, does not hold up the main box's start; with a nodes row for it the start waits",
    () =>
      withCapturedStdout(async (log) => {
        const pair = await pairs.start("reset", "preproduction", undefined);
        // The join's last write fails after M approved it and S collected the bundle, before
        // S's restart opens its copy store.
        const stopped = await pair.stopJoin();
        expect(stopped.status, JSON.stringify(stopped.body)).toBe(500);
        expect(stopped.body).toEqual({ error: { code: "server.internal" } });
        await boundedStart(pair.boxS.start(), "S's start after its join stopped");
        const viaS = await pairs.viaNow(pair.dirsS);
        const status = await fetch(`${pair.urlS}/setup-api/status`, viaS);
        expect(await status.json()).toMatchObject({
          operation: { kind: "adopt", phase: "venue_committed" },
        });
        await pair.resetStoppedJoin(viaS);

        // M's chart lists S, and M holds no `nodes` row for it.
        const link = await readOutside(pair.dirsM.venue, (store) =>
          readPairLink(store.node, pair.m.nodeId),
        );
        expect(link).not.toBeNull();
        const nodeIdS = link!.peerNodeId;
        const chart = await readOutside(pair.dirsM.venue, (store) =>
          readNodeMembership(store.venue),
        );
        expect(chart!.body.nodes.map((n) => n.nodeId)).toContain(nodeIdS);
        expect(firstRowIn(pair.dirsM.venue, "select id from nodes where id = ?", nodeIdS)).toBe(
          undefined,
        );

        const startChecksOf = (from: number) =>
          logLines(log.slice(from))
            .filter((line) => line.event === "handover.start_check")
            .map(({ result, peers }) => ({ result, peers }));
        const atRestart = log.length;
        await pair.boxM.restartNow();
        expect(startChecksOf(atRestart)).toEqual([{ result: "proceed", peers: [] }]);
        const node = await fetch(`${pair.urlM}/api/node`, pair.viaM);
        expect(await node.json()).toMatchObject({ acceptingSales: true });

        // Control: the same start with a `nodes` row for S counts S, which answers as a reset box
        // does, and waits.
        await pair.boxM.stopForRestart();
        const store = await openVenueDatabase(pair.dirsM.venue);
        try {
          await store.venue
            .insert(nodes)
            .values({ id: nodeIdS, name: "Spare", publicKey: link!.peerPublicKey });
        } finally {
          await store.close();
        }
        const atControl = log.length;
        await boundedStart(pair.boxM.start(), "M's start with a nodes row for S");
        const control = startChecksOf(atControl);
        expect(control).toMatchObject([
          { result: "wait", peers: [{ nodeId: nodeIdS, answer: "S", counted: true }] },
        ]);
      }),
    RESET_SPARE_TIMEOUT_MS,
  );
});
