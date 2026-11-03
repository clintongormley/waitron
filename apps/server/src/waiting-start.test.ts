import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SignedMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverRestriction } from "@waitron/node-db";
import { createHealthState } from "./health.js";
import type { StartPeerCheckOutcome } from "./start-peer-check.js";
import { startWaiting, type WaitingStartDeps } from "./waiting-start.js";

const NODE_ID = "00000000-0000-4000-8000-0000000000aa";
const SPARE_ID = "00000000-0000-4000-8000-0000000000cc";

const CHART = {
  body: {
    term: 3,
    nodes: [
      { nodeId: NODE_ID, contactUrl: "https://box.example", standing: "serving-primary" },
      { nodeId: SPARE_ID, contactUrl: "https://spare.example", standing: "serving-secondary" },
    ],
  },
  signerNodeId: NODE_ID,
  signature: "",
  endorsements: [],
} as unknown as SignedMembershipDocument;

const TERRACE_ID = "00000000-0000-4000-8000-0000000000dd";
const NAMES: Record<string, string> = { [SPARE_ID]: "Spare", [TERRACE_ID]: "Terrace" };

const WAIT: StartPeerCheckOutcome = {
  result: "wait",
  successorNodeId: null,
  waitingOn: [SPARE_ID],
};
const PROCEED: StartPeerCheckOutcome = { result: "proceed", successorNodeId: null };

const migrations = migrationOptionsFor(manifestSets(), null);

function harness(
  recheck: () => Promise<StartPeerCheckOutcome>,
  extra: Partial<WaitingStartDeps> = {},
) {
  let app: Hono | undefined;
  const closeListeners = vi.fn(() => Promise.resolve());
  const closeStore = vi.fn(() => Promise.resolve());
  const restart = vi.fn();
  const health = createHealthState(new Date());
  const waiting = startWaiting({
    health,
    now: () => new Date(),
    nodeId: NODE_ID,
    environment: "preproduction",
    readMembership: () => Promise.resolve(CHART),
    waitingOn: [SPARE_ID],
    namesOf: (ids) => Promise.resolve(ids.map((id) => NAMES[id] ?? null)),
    routes: [],
    node: undefined as never,
    recheck,
    intervalMs: 5,
    listen: (bound) => {
      app = bound;
      return { close: closeListeners };
    },
    closeStore,
    restart,
    log: () => {},
    ...extra,
  });
  return { waiting, app: () => app!, health, closeListeners, closeStore, restart };
}

describe("the waiting start", () => {
  it("waits, answering `acceptingSales: false` with its term", async () => {
    const recheck = vi.fn(() => Promise.resolve(WAIT));
    const h = harness(recheck);
    const node = await h.app().request("/api/node");
    expect(await node.json()).toEqual({
      nodeId: NODE_ID,
      term: 3,
      standing: "serving-primary",
      acceptingSales: false,
      environment: "preproduction",
    });
    const health = await h.app().request("/health");
    expect({ status: health.status, body: await health.json() }).toEqual({
      status: 200,
      body: { ok: true, tradingAvailable: false },
    });
    const page = await h.app().request("/", { headers: { "accept-language": "en-GB" } });
    const html = await page.text();
    expect(html).toContain("<h1>This box is waiting for Spare</h1>");
    expect(html).toContain(
      "It will not take sales or send anything to the tax agency until it knows whether <strong>Spare</strong> has taken over. It checks again every 15 seconds.",
    );
    await h.waiting.server.close();
    expect(await h.waiting.ended).toEqual({ kind: "stopped" });
    expect(h.closeStore).toHaveBeenCalledTimes(1);
    const asked = recheck.mock.calls.length;
    await new Promise((done) => setTimeout(done, 50));
    expect(recheck).toHaveBeenCalledTimes(asked);
  });

  it("a close during a re-ask closes the store only once the re-ask has settled", async () => {
    const log = vi.fn();
    let answer: (outcome: StartPeerCheckOutcome) => void = () => {};
    const recheck = vi.fn(() => new Promise<StartPeerCheckOutcome>((done) => (answer = done)));
    const h = harness(recheck, { log });
    await vi.waitFor(() => expect(recheck).toHaveBeenCalledTimes(1));
    const closed = h.waiting.server.close();
    await new Promise((done) => setTimeout(done, 20));
    expect(h.closeStore).not.toHaveBeenCalled();
    answer(WAIT);
    await closed;
    expect(h.closeStore).toHaveBeenCalledTimes(1);
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("a re-ask that waits on other boxes names them on the page", async () => {
    const h = harness(() => Promise.resolve({ ...WAIT, waitingOn: [TERRACE_ID] }));
    await vi.waitFor(async () => {
      const page = await h.app().request("/", { headers: { "accept-language": "en-GB" } });
      expect(await page.text()).toContain("<h1>This box is waiting for Terrace</h1>");
    });
    await h.waiting.server.close();
  });

  it("restarts when a peer answers: the start goes on, with its listeners and timer gone", async () => {
    const recheck = vi
      .fn<() => Promise<StartPeerCheckOutcome>>()
      .mockResolvedValueOnce(WAIT)
      .mockResolvedValue(PROCEED);
    const h = harness(recheck);
    expect(await h.waiting.ended).toEqual({ kind: "checked", outcome: PROCEED });
    expect(h.closeListeners).toHaveBeenCalledTimes(1);
    expect(h.closeStore).not.toHaveBeenCalled();
    expect(h.health.takesNoSales).toBe(false);
    await new Promise((done) => setTimeout(done, 50));
    expect(recheck).toHaveBeenCalledTimes(2);
  });

  it("a re-ask that answers superseded ends the wait with that answer", async () => {
    const superseded: StartPeerCheckOutcome = { result: "superseded", successorNodeId: SPARE_ID };
    const h = harness(() => Promise.resolve(superseded));
    expect(await h.waiting.ended).toEqual({ kind: "checked", outcome: superseded });
  });

  it("a re-ask that fails is logged and asked again", async () => {
    const log = vi.fn();
    const recheck = vi
      .fn<() => Promise<StartPeerCheckOutcome>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(PROCEED);
    const h = harness(recheck, { log });
    expect(await h.waiting.ended).toEqual({ kind: "checked", outcome: PROCEED });
    expect(log).toHaveBeenCalledWith("warn", "waiting_start.recheck_failed", expect.any(Object));
  });

  it("carrying on ends the wait the way a peer's answer does", async () => {
    const h = harness(() => Promise.resolve(WAIT), { intervalMs: 60_000 });
    await h.waiting.carryOn();
    expect(await h.waiting.ended).toEqual({ kind: "carried-on" });
    expect(h.closeListeners).toHaveBeenCalledTimes(1);
    expect(h.health.takesNoSales).toBe(false);
  });

  describe("a stepdown asked of the waiting start", () => {
    const suite = useVenueDb({ migrations });

    it("records the restriction, closes, and restarts; a later answer does not continue the start", async () => {
      let answer: (outcome: StartPeerCheckOutcome) => void = () => {};
      const pending = new Promise<StartPeerCheckOutcome>((done) => (answer = done));
      const h = harness(() => pending, {
        node: suite.node,
        intervalMs: 1,
        routes: [
          (app, hooks) =>
            app.post("/step", async (c) =>
              c.json(
                await hooks.stepDown({
                  kind: "superseded",
                  successorNodeId: SPARE_ID,
                  membershipTerm: 4,
                  self: c,
                }),
              ),
            ),
        ],
      });
      // The first re-ask is in flight when the stepdown arrives.
      await new Promise((done) => setTimeout(done, 10));
      const stepped = await h.app().request("/step", { method: "POST" });
      expect(await stepped.json()).toEqual({ restarting: true, replayed: false });
      expect(await readHandoverRestriction(suite.node, NODE_ID)).toMatchObject({
        kind: "superseded",
        successorNodeId: SPARE_ID,
        membershipTerm: 4,
      });
      answer(PROCEED);
      expect(await h.waiting.ended).toEqual({ kind: "stopped" });
      await vi.waitFor(() => expect(h.restart).toHaveBeenCalledTimes(1));
      expect(h.closeStore).toHaveBeenCalledTimes(1);
      expect(h.closeListeners).toHaveBeenCalledTimes(1);
    });
  });
});
