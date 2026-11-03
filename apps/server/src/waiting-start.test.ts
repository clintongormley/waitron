import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { generateSync } from "otplib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withNodeTransaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  persons,
  startManagementSession,
} from "@waitron/identity";
import type { SignedMembershipDocument } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  beginHandoverOperationTx,
  nodeHandoverEvents,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { TOTP_KEY_RING, enrolAuthenticator } from "./testing/authenticator.js";
import { fixturePasswordHash } from "./testing/known-secret-hashes.js";
import { setupVenue } from "./testing/venue-fixtures.js";
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

  describe("carrying on as the main box", () => {
    const suite = useVenueDb({ migrations });
    const sockets: TLSSocket[] = [];
    let adminId: string;
    let h: ReturnType<typeof harness>;

    beforeEach(async () => {
      await setupVenue(suite.db);
      const [admin] = await suite.db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      adminId = admin!.id;
      h = harness(() => new Promise(() => {}), {
        node: suite.node,
        intervalMs: 60_000,
        carryOn: { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
      });
    });
    afterEach(async () => {
      await h.waiting.server.close();
      for (const socket of sockets.splice(0)) socket.destroy();
    });

    const tls = () => {
      const socket = new TLSSocket(new Socket());
      sockets.push(socket);
      return { incoming: { socket } };
    };
    const page = async (secure = true) =>
      (
        await h
          .app()
          .request(
            "https://box.test/",
            { headers: { "accept-language": "en-GB" } },
            secure ? tls() : {},
          )
      ).text();
    const post = (fields: Record<string, string>, secure = true) =>
      h.app().request(
        "https://box.test/carry-on",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "accept-language": "en-GB",
          },
          body: new URLSearchParams(fields).toString(),
        },
        secure ? tls() : {},
      );
    const BOTH = { switchedOff: "yes", noOtherRecovery: "yes" };
    const ADMIN = { email: "owner@example.test", password: "dashPass123" };
    const events = () => suite.node.select().from(nodeHandoverEvents);
    const stillWaiting = async () =>
      expect(
        await Promise.race([
          h.waiting.ended,
          new Promise((done) => setTimeout(() => done("waiting"), 20)),
        ]),
      ).toBe("waiting");

    it("carry on with a correct sign-in and both statements restarts normally and records the decision", async () => {
      const answer = await post({ ...ADMIN, ...BOTH });
      expect(answer.status).toBe(200);
      expect(await answer.text()).toContain("<h1>This box is carrying on as the main box</h1>");
      expect(await h.waiting.ended).toEqual({ kind: "carried-on" });
      expect(h.closeListeners).toHaveBeenCalledTimes(1);
      expect(h.closeStore).not.toHaveBeenCalled();
      expect(h.health.takesNoSales).toBe(false);
      expect(await events()).toMatchObject([
        {
          nodeId: NODE_ID,
          operationId: null,
          kind: "carried_on_without_peer",
          detail: { personId: adminId, peerNodeIds: [SPARE_ID], chartTerm: 3 },
          envelope: null,
        },
      ]);
    });

    it("a person without `node.promote` is refused with the role sentence", async () => {
      await suite.db.insert(persons).values({
        displayName: "Signed-in Manager",
        role: "manager",
        email: "manager@example.test",
        passwordHash: fixturePasswordHash("managerPass1"),
      });
      const answer = await post({
        email: "manager@example.test",
        password: "managerPass1",
        ...BOTH,
      });
      expect(answer.status).toBe(403);
      expect(await answer.text()).toContain(
        "Your role does not let you choose which box runs the venue. Sign in here as an administrator to carry on.",
      );
      await stillWaiting();
      expect(await events()).toEqual([]);
    });

    it("a wrong password answers `password.invalid`", async () => {
      const wrong = await post({ ...ADMIN, password: "notThePassword", ...BOTH });
      const unknown = await post({ ...ADMIN, email: "nobody@example.test", ...BOTH });
      expect([wrong.status, unknown.status]).toEqual([401, 401]);
      const [wrongPage, unknownPage] = [await wrong.text(), await unknown.text()];
      expect(wrongPage).toContain(
        "That email and password do not match an account here. Check them and try again.",
      );
      expect(unknownPage.replace("nobody@example.test", "owner@example.test")).toBe(wrongPage);
      // A sign-in's refusal marks no field.
      expect(wrongPage).not.toContain("aria-invalid");
      await stillWaiting();
      expect(await events()).toEqual([]);
    });

    it("an account with an authenticator is asked for its code, then carries on", async () => {
      const secret = await enrolAuthenticator(suite.db, adminId, ADMIN.password, TOTP_KEY_RING);
      const asked = await post({ ...ADMIN, ...BOTH });
      expect(asked.status).toBe(401);
      const askedPage = await asked.text();
      expect(askedPage).toContain('name="totp"');
      expect(askedPage).toContain(
        "Enter your password again and the code from your authenticator app, or one of your recovery codes.",
      );
      await stillWaiting();
      const answer = await post({ ...ADMIN, totp: generateSync({ secret }), ...BOTH });
      expect(answer.status).toBe(200);
      expect(await h.waiting.ended).toEqual({ kind: "carried-on" });
      expect(await events()).toHaveLength(1);
    });

    it("either statement unticked keeps the action disabled", async () => {
      const blank = await page();
      expect(blank).toContain('<button type="submit" disabled>Carry on as the main box</button>');
      expect(blank).toContain(
        '<input type="checkbox" id="carry-on-switched-off" name="switchedOff" value="yes" required>',
      );
      expect(blank).toContain("<strong>Spare</strong> is switched off");
      expect(blank).toContain("No other recovery of this venue is in progress");
      // The password is never drawn back into the page, so a redrawn form starts with an empty
      // required field and its action disabled, even with both statements ticked.
      const ticked = await (await post({ ...ADMIN, password: "wrong", ...BOTH })).text();
      expect(ticked).toContain('<button type="submit" disabled>Carry on as the main box</button>');
      // The script enables the action only once every required field is filled.
      expect(ticked).toContain('const required = [...form.querySelectorAll("[required]")];');
      for (const missing of ["switchedOff", "noOtherRecovery"] as const) {
        const one: Record<string, string> = { ...BOTH };
        delete one[missing];
        const answer = await post({ ...ADMIN, ...one });
        expect(answer.status).toBe(400);
        const html = await answer.text();
        expect(html).toContain('<button type="submit" disabled>Carry on as the main box</button>');
        expect(html).toContain("Tick this to confirm it.");
        expect(html).toContain("Correct the highlighted fields to continue.");
      }
      await stillWaiting();
      expect(await events()).toEqual([]);
    });

    it("a box with a restriction refuses `handover.known_handover`", async () => {
      await withNodeTransaction(suite.node, (tx) =>
        recordHandoverRestrictionTx(tx, {
          nodeId: NODE_ID,
          operationId: null,
          kind: "superseded",
          successorNodeId: SPARE_ID,
          membershipTerm: 4,
        }),
      );
      const sentence =
        "This box has already handed over to <strong>Spare</strong>. It cannot carry on as the main box.";
      const shown = await page();
      expect(shown).toContain("<h1>This box has already handed over</h1>");
      expect(shown).toContain(sentence);
      expect(shown).not.toContain("This box is waiting for");
      expect(shown).not.toContain("<form");
      const answer = await post({ ...ADMIN, ...BOTH });
      expect(answer.status).toBe(409);
      const refused = await answer.text();
      expect(refused).toContain("<h1>This box has already handed over</h1>");
      expect(refused).toContain(sentence);
      expect(refused).not.toContain("This box is waiting for");
      expect(refused).not.toContain("<form");
      expect(refused).toContain('<a href="/">Back to this box&#39;s status</a>');
      await stillWaiting();
      expect(await events()).toEqual([]);
    });

    it("a box that is the source of an open handover refuses `handover.known_handover`", async () => {
      await withNodeTransaction(suite.node, (tx) =>
        beginHandoverOperationTx(tx, {
          nodeId: NODE_ID,
          operationId: "00000000-0000-4000-8000-0000000000ee",
          role: "source",
          scenario: "controlled",
          sourceNodeId: NODE_ID,
          destinationNodeId: TERRACE_ID,
          binding: {},
          fingerprint: "f",
          state: "source_stepped_down",
          waitingReason: null,
        }),
      );
      const answer = await post({ ...ADMIN, ...BOTH });
      expect(answer.status).toBe(409);
      expect(await answer.text()).toContain(
        "This box has already handed over to <strong>Terrace</strong>. It cannot carry on as the main box.",
      );
      await stillWaiting();
      expect(await events()).toEqual([]);
    });

    /** Replaces the case's waiting start with one whose first re-ask is held until `answer`. */
    const heldReAsk = async () => {
      await h.waiting.server.close();
      let answer: (outcome: StartPeerCheckOutcome) => void = () => {};
      const recheck = vi
        .fn<() => Promise<StartPeerCheckOutcome>>()
        .mockReturnValueOnce(new Promise((done) => (answer = done)))
        .mockReturnValue(new Promise(() => {}));
      h = harness(recheck, {
        node: suite.node,
        intervalMs: 1,
        carryOn: { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
      });
      await vi.waitFor(() => expect(recheck).toHaveBeenCalledTimes(1));
      return (outcome: StartPeerCheckOutcome) => answer(outcome);
    };
    /** Resolves once the carry-on has signed in and is waiting for the re-ask in flight. */
    const signedIn = () => new Promise((done) => setTimeout(done, 300));

    it("a peer's takeover answer already on its way wins over a carry-on: refused, nothing recorded", async () => {
      const answer = await heldReAsk();
      const posted = post({ ...ADMIN, ...BOTH });
      await signedIn();
      answer({ result: "superseded", successorNodeId: SPARE_ID });
      const refused = await posted;
      expect(refused.status).toBe(409);
      expect(await refused.text()).toContain(
        "This box has already handed over to <strong>Spare</strong>. It cannot carry on as the main box.",
      );
      expect(await h.waiting.ended).toEqual({
        kind: "checked",
        outcome: { result: "superseded", successorNodeId: SPARE_ID },
      });
      expect(await events()).toEqual([]);
    });

    it("a peer's answer to go on already on its way wins over a carry-on: the start goes on, nothing recorded", async () => {
      const answer = await heldReAsk();
      const posted = post({ ...ADMIN, ...BOTH });
      await signedIn();
      answer(PROCEED);
      const answered = await posted;
      expect(answered.status).toBe(200);
      const html = await answered.text();
      expect(html).toContain("<h1>The other box answered</h1>");
      expect(html).not.toContain("This box is carrying on as the main box");
      expect(await h.waiting.ended).toEqual({ kind: "checked", outcome: PROCEED });
      expect(await events()).toEqual([]);
    });

    it("a second carry-on records nothing more", async () => {
      const first = await post({ ...ADMIN, ...BOTH });
      const second = await post({ ...ADMIN, ...BOTH });
      expect([first.status, second.status]).toEqual([200, 200]);
      for (const answered of [first, second])
        expect(await answered.text()).toContain("<h1>This box is carrying on as the main box</h1>");
      expect(await h.waiting.ended).toEqual({ kind: "carried-on" });
      expect(await events()).toHaveLength(1);
    });

    it("a carry-on while the box steps down is refused and records nothing", async () => {
      await h.waiting.server.close();
      h = harness(() => new Promise(() => {}), {
        node: suite.node,
        intervalMs: 60_000,
        carryOn: { db: suite.db, credentialKeyRing: TOTP_KEY_RING },
        routes: [
          (app, hooks) =>
            app.post("/step", async (c) =>
              c.json(
                await hooks.stepDown({
                  kind: "superseded",
                  successorNodeId: null,
                  membershipTerm: 4,
                  self: c,
                }),
              ),
            ),
        ],
      });
      // The carry-on is admitted before the stepdown closes the gate, and is signing in when the
      // stepdown starts. A chart naming no main box records no restriction, so only the stepdown
      // in progress can refuse it.
      const posted = post({ ...ADMIN, ...BOTH });
      await new Promise((done) => setTimeout(done, 5));
      const stepped = await h.app().request("/step", { method: "POST" });
      const carried = await posted;
      expect(stepped.status).toBe(200);
      expect(carried.status).toBe(409);
      expect(await carried.text()).not.toContain("This box is carrying on as the main box");
      expect(await h.waiting.ended).toEqual({ kind: "stopped" });
      expect(await events()).toEqual([]);
    });

    it("an administrator without the authenticator may give a recovery code instead", async () => {
      const codes = await enrolWithCodes(adminId);
      const asked = await (await post({ ...ADMIN, ...BOTH })).text();
      expect(asked).toContain('name="recoveryCode"');
      const answer = await post({ ...ADMIN, totp: "", recoveryCode: codes[0]!, ...BOTH });
      expect(answer.status).toBe(200);
      expect(await h.waiting.ended).toEqual({ kind: "carried-on" });
      expect(await events()).toHaveLength(1);
    });

    /** Enrols an authenticator for `personId` and returns its recovery codes. */
    const enrolWithCodes = (personId: string) =>
      withTransaction(suite.db, async (tx) => {
        const { token } = await startManagementSession(tx, { personId });
        const { enrollmentId, secret } = await beginOwnTotpEnrollment(tx, {
          managementSessionId: token,
          currentPassword: ADMIN.password,
          keyRing: TOTP_KEY_RING,
        });
        const { codes } = await finishOwnTotpEnrollment(tx, {
          managementSessionId: token,
          enrollmentId,
          code: generateSync({ secret }),
          keyRing: TOTP_KEY_RING,
        });
        return codes;
      });

    it("over plain HTTP the page offers no form, and a sign-in is refused", async () => {
      const shown = await page(false);
      expect(shown).not.toContain("<form");
      expect(shown).toContain(
        "To carry on as the main box, open this page at its https:// address.",
      );
      const answer = await post({ ...ADMIN, ...BOTH }, false);
      expect(answer.status).toBe(403);
      await stillWaiting();
      expect(await events()).toEqual([]);
    });
  });
});
