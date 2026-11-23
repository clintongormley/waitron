import { describe, expect, it, vi } from "vitest";
import { commitmentFor, joinCode, type JoinCodeInputs, type JoinHello } from "./box-join-code.js";
import type { LockedJoinBundle } from "./box-join-seal.js";
import { createBoxJoinRequests } from "./box-join-requests.js";

const MAIN = { nodeId: "main-node", publicKey: Buffer.from("main key").toString("base64") };
const WALL_START = Date.parse("2026-11-21T10:00:00.000Z");
const iso = (ms: number) => new Date(WALL_START + ms).toISOString();

function helloFrom(address: string): JoinHello {
  return {
    newNodeId: `node-${address}`,
    newPublicKey: Buffer.from(`pk ${address}`).toString("base64"),
    encryptionKey: Buffer.from(`ek ${address}`).toString("base64"),
    contactUrl: `https://${address}:8443`,
    storeUrl: `https://${address}:9000`,
    addresses: [address],
  };
}

const newNonceOf = (address: string) => Buffer.alloc(32, address);
const mainNonceOf = (id: string) => Buffer.alloc(32, `main ${id}`);

/** A nonce that gives request `req-2` from 10.0.0.2 the code `req-1` from 10.0.0.1 shows (found by search). */
function takenNonce(): Buffer {
  const nonce = Buffer.alloc(32);
  nonce.writeUInt32BE(1_995_409, 28);
  return nonce;
}

/** The real code request `id` from `address` will show, computed the way the new box does. */
function codeOf(id: string, address: string, newNonce: Buffer = newNonceOf(address)): string {
  const inputs: JoinCodeInputs = {
    ...helloFrom(address),
    mainNodeId: MAIN.nodeId,
    mainPublicKey: MAIN.publicKey,
    newNonce,
    mainNonce: mainNonceOf(id),
    requestId: id,
  };
  return joinCode(inputs);
}

function setup() {
  const clock = { steady: 1_000, wall: WALL_START };
  let ids = 0;
  const changed = vi.fn();
  const store = createBoxJoinRequests({
    changed,
    steadyNow: () => clock.steady,
    wallNow: () => clock.wall,
    newId: () => `req-${++ids}`,
    newMainNonce: (id) => mainNonceOf(id),
  });
  const advance = (ms: number) => {
    clock.steady += ms;
    clock.wall += ms;
  };
  const hello = (address: string) =>
    store.admitHello(address) ??
    store.openHello({ address, hello: helloFrom(address), main: MAIN, at: iso(0) });
  const signAnswer = vi.fn((mainNonce: Buffer) => `signed ${mainNonce.toString("hex", 0, 4)}`);
  const reveal = (id: string, address: string, nonce: Buffer = newNonceOf(address), seq = 1) =>
    store.reveal({ requestId: id, newNonce: nonce, seq, signAnswer });
  /** Hello and reveal; returns the request id. */
  const revealFrom = (address: string) => {
    const answer = hello(address);
    if ("refused" in answer) throw new Error(`hello refused: ${answer.refused}`);
    const revealed = reveal(answer.requestId, address);
    return { id: answer.requestId, revealed };
  };
  /** A poll carrying the new box's Yes. */
  const confirm = (id: string, seq = 2) =>
    store.poll({ requestId: id, seq, at: iso(0), confirmed: true });
  return { store, clock, advance, hello, reveal, revealFrom, confirm, signAnswer, changed };
}

const locked = (tag: string): LockedJoinBundle => ({
  oneUsePublicKey: `one-use ${tag}`,
  ciphertext: `cipher ${tag}`,
  signature: `sig ${tag}`,
});

describe("hello", () => {
  it("answers a request id, the commitment to its own nonce and the expiry, and no nonce", () => {
    const { hello } = setup();
    const answer = hello("10.0.0.1");
    expect(answer).toEqual({
      requestId: "req-1",
      commitment: commitmentFor("req-1", mainNonceOf("req-1")),
      expiresAt: iso(15 * 60_000),
    });
  });

  it("holds one unrevealed hello per address", () => {
    const { hello, reveal, advance } = setup();
    hello("10.0.0.1");
    advance(1_000);
    expect(hello("10.0.0.1")).toEqual({
      refused: "full",
      limit: "address",
      retryAt: iso(30_000),
      max: 5,
      minutes: 1,
    });
    reveal("req-1", "10.0.0.1");
    expect(hello("10.0.0.1")).toMatchObject({ requestId: "req-2" });
  });

  it("takes five hellos a minute from one address", () => {
    const { store, hello, advance } = setup();
    for (let n = 1; n <= 5; n++) {
      hello("10.0.0.1");
      store.cancel({ requestId: `req-${n}`, seq: 1 });
      advance(1_000);
    }
    expect(hello("10.0.0.1")).toEqual({
      refused: "full",
      limit: "address",
      retryAt: iso(60_000),
      max: 5,
      minutes: 1,
    });
    advance(55_000);
    expect(hello("10.0.0.1")).toMatchObject({ requestId: "req-6" });
  });

  it("takes twenty hellos a minute in total", () => {
    const { hello, advance } = setup();
    for (let n = 1; n <= 20; n++) hello(`10.0.0.${n}`);
    advance(10_000);
    expect(hello("10.0.1.1")).toEqual({
      refused: "full",
      limit: "network",
      retryAt: iso(60_000),
      max: 20,
      minutes: 1,
    });
    advance(50_000);
    expect(hello("10.0.1.1")).toMatchObject({ requestId: "req-21" });
  });

  it("drops a hello not revealed within 30 seconds", () => {
    const { hello, reveal, advance } = setup();
    hello("10.0.0.1");
    advance(29_999);
    expect(hello("10.0.0.1")).toMatchObject({ refused: "full" });
    advance(1);
    expect(reveal("req-1", "10.0.0.1")).toEqual({ refused: "not_found" });
    expect(hello("10.0.0.1")).toMatchObject({ requestId: "req-2" });
  });

  it("measures time on the steady clock, so a wall-clock step back does not stretch it", () => {
    const { clock, hello, reveal } = setup();
    hello("10.0.0.1");
    clock.wall -= 60 * 60_000;
    clock.steady += 29_999;
    expect(hello("10.0.0.1")).toMatchObject({ refused: "full", limit: "address" });
    clock.steady += 1;
    expect(reveal("req-1", "10.0.0.1")).toEqual({ refused: "not_found" });
  });
});

describe("reveal", () => {
  it("lists the request, not yet confirmed, with its one code, and answers the main box's nonce", () => {
    const { store, revealFrom, signAnswer } = setup();
    const { revealed } = revealFrom("10.0.0.1");
    expect(revealed).toEqual({
      mainNonce: mainNonceOf("req-1"),
      signature: `signed ${mainNonceOf("req-1").toString("hex", 0, 4)}`,
    });
    expect(signAnswer).toHaveBeenCalledWith(mainNonceOf("req-1"));
    expect(store.listed()).toEqual([
      {
        id: "req-1",
        address: "10.0.0.1",
        askedAt: iso(0),
        startedAgain: false,
        newConfirmed: false,
      },
    ]);
    expect(store.check("req-1")).toMatchObject({
      code: codeOf("req-1", "10.0.0.1"),
      newConfirmed: false,
    });
  });

  it("repeats the stored answer for the same nonce and seq, counting it once", () => {
    const { store, reveal, revealFrom, signAnswer } = setup();
    const { id, revealed } = revealFrom("10.0.0.1");
    for (let n = 0; n < 6; n++) expect(reveal(id, "10.0.0.1")).toEqual(revealed);
    expect(signAnswer).toHaveBeenCalledTimes(1);
    store.cancel({ requestId: id, seq: 2 });
    for (let n = 2; n <= 6; n++) {
      const next = revealFrom(`10.0.0.${n}`);
      expect(next.revealed).toHaveProperty("mainNonce");
      store.cancel({ requestId: next.id, seq: 2 });
    }
    expect(revealFrom("10.0.0.7").revealed).toMatchObject({ refused: "full", limit: "recent" });
  });

  it("ends the request when a second reveal brings another nonce", () => {
    const { store, reveal, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(reveal(id, "10.0.0.1", Buffer.alloc(32, "other"))).toEqual({ refused: "invalid" });
    expect(store.poll({ requestId: id, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "invalid",
    });
    expect(store.listed()).toEqual([]);
  });

  it("ends the request when a second reveal brings the same nonce with another seq", () => {
    const { store, reveal, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(reveal(id, "10.0.0.1", newNonceOf("10.0.0.1"), 2)).toEqual({ refused: "invalid" });
    expect(store.listed()).toEqual([]);
  });

  it("ends a request whose message failed its check, without freeing its reveal place", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    store.endInvalid(id);
    expect(store.poll({ requestId: id, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "invalid",
    });
    expect(store.listed()).toEqual([]);
    for (let n = 2; n <= 6; n++) {
      const next = revealFrom(`10.0.0.${n}`);
      expect(next.revealed).toHaveProperty("mainNonce");
      store.cancel({ requestId: next.id, seq: 2 });
    }
    expect(revealFrom("10.0.0.7").revealed).toMatchObject({ refused: "full", limit: "recent" });
  });

  it("does not answer a poll before the reveal, and the reveal still succeeds", () => {
    const { store, hello, reveal } = setup();
    hello("10.0.0.1");
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0), confirmed: false })).toEqual({
      refused: "not_found",
    });
    expect(reveal("req-1", "10.0.0.1")).toHaveProperty("mainNonce");
  });

  it("reports the same asked time on every read, however the two clocks have moved", () => {
    const { store, revealFrom, clock } = setup();
    revealFrom("10.0.0.1");
    const asked = () => store.listed()[0]!.askedAt;
    const first = asked();
    clock.steady += 5;
    clock.wall += 7;
    expect([asked(), asked()]).toEqual([first, first]);
  });

  it("refuses a code a listed request shows, without the main box's nonce", () => {
    const { store, hello, reveal, revealFrom } = setup();
    expect(codeOf("req-2", "10.0.0.2", takenNonce())).toBe(codeOf("req-1", "10.0.0.1"));
    revealFrom("10.0.0.1");
    hello("10.0.0.2");
    expect(reveal("req-2", "10.0.0.2", takenNonce())).toEqual({ refused: "code_taken" });
    expect(store.poll({ requestId: "req-2", seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "code_taken",
    });
    expect(store.listed().map((r) => r.id)).toEqual(["req-1"]);
  });

  it("lists at most three, one per address, a newer reveal ending the older", () => {
    const { store, revealFrom, advance } = setup();
    for (const n of [1, 2, 3]) revealFrom(`10.0.0.${n}`);
    advance(1_000);
    expect(revealFrom("10.0.0.4").revealed).toEqual({
      refused: "full",
      limit: "listed",
      retryAt: iso(15 * 60_000),
      max: 3,
      minutes: 15,
    });
    expect(revealFrom("10.0.0.1").revealed).toHaveProperty("mainNonce");
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "replaced",
    });
    expect(store.listed().map((r) => r.id)).toEqual(["req-2", "req-3", "req-5"]);
  });

  it("frees a reveal place on a Dismiss, not on a cancel, replacement, expiry or taken code", () => {
    const { store, hello, reveal, revealFrom, advance } = setup();
    hello("10.0.0.1");
    advance(29_000);
    reveal("req-1", "10.0.0.1"); // 1: expires 14 min 31 s from now
    hello("10.0.0.2");
    expect(reveal("req-2", "10.0.0.2", takenNonce())).toEqual({ refused: "code_taken" }); // 2
    store.dismiss(revealFrom("10.0.0.3").id);
    store.cancel({ requestId: revealFrom("10.0.0.4").id, seq: 2 }); // 3
    revealFrom("10.0.0.5"); // 4
    revealFrom("10.0.0.5"); // 5: replaces req-5
    advance(15 * 60_000 - 29_000);
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0), confirmed: false })).toEqual({
      refused: "not_found",
    });
    expect(revealFrom("10.0.0.6").revealed).toHaveProperty("mainNonce"); // 6
    expect(revealFrom("10.0.0.7").revealed).toEqual({
      refused: "full",
      limit: "recent",
      retryAt: iso(29_000 + 15 * 60_000),
      max: 6,
      minutes: 15,
    });
  });

  it("flags a request whose address cancelled or was replaced in the last 15 minutes, not one that expired", () => {
    const { store, revealFrom, advance } = setup();
    store.cancel({ requestId: revealFrom("10.0.0.1").id, seq: 2 });
    revealFrom("10.0.0.1");
    revealFrom("10.0.0.2");
    revealFrom("10.0.0.2");
    revealFrom("10.0.0.3");
    const flagged = () => store.listed().map((r) => [r.address, r.startedAgain]);
    expect(flagged()).toEqual([
      ["10.0.0.1", true],
      ["10.0.0.2", true],
      ["10.0.0.3", false],
    ]);
    advance(15 * 60_000);
    expect(store.listed()).toEqual([]);
    revealFrom("10.0.0.3");
    expect(flagged()).toEqual([["10.0.0.3", false]]);
  });
});

describe("waiting", () => {
  it("takes only a rising seq, and keeps the latest at even when it is earlier", () => {
    const { store, revealFrom, advance } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(store.poll({ requestId: id, seq: 1, at: iso(0), confirmed: false })).toEqual({
      refused: "invalid",
    });
    advance(2_000);
    expect(store.poll({ requestId: id, seq: 2, at: iso(5_000), confirmed: false })).toEqual({
      state: "waiting",
    });
    expect(store.poll({ requestId: id, seq: 2, at: iso(5_000), confirmed: false })).toEqual({
      refused: "invalid",
    });
    advance(2_000);
    expect(store.poll({ requestId: id, seq: 3, at: iso(-60_000), confirmed: false })).toEqual({
      state: "waiting",
    });
    expect(store.check(id)).toMatchObject({ at: iso(-60_000), atReceivedAt: iso(4_000) });
  });

  it("ends a listed request 15 minutes after its hello", () => {
    const { store, revealFrom, advance } = setup();
    const { id } = revealFrom("10.0.0.1");
    advance(15 * 60_000 - 1);
    expect(store.poll({ requestId: id, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "waiting",
    });
    advance(1);
    expect(store.poll({ requestId: id, seq: 3, at: iso(0), confirmed: false })).toEqual({
      refused: "not_found",
    });
    expect(store.listed()).toEqual([]);
  });

  it("keeps an ended request's reason, and an approved request's bundle, for 2 minutes", () => {
    const { store, revealFrom, confirm, advance } = setup();
    const ended = revealFrom("10.0.0.1").id;
    const approved = revealFrom("10.0.0.2").id;
    store.dismiss(ended);
    confirm(approved);
    store.approve.begin(approved);
    store.approve.finish(approved, locked("a"));
    advance(2 * 60_000 - 1);
    expect(store.poll({ requestId: ended, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "dismissed",
    });
    expect(store.poll({ requestId: approved, seq: 3, at: iso(0), confirmed: false })).toEqual({
      state: "approved",
      locked: locked("a"),
    });
    advance(1);
    expect(store.poll({ requestId: ended, seq: 3, at: iso(0), confirmed: false })).toEqual({
      refused: "not_found",
    });
    expect(store.poll({ requestId: approved, seq: 4, at: iso(0), confirmed: false })).toEqual({
      refused: "not_found",
    });
  });
});

describe("the new box's Yes", () => {
  it("is recorded from the first poll that carries it, announced once, and never taken back", () => {
    const { store, revealFrom, confirm, changed } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.poll({ requestId: id, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "waiting",
    });
    expect(store.listed()[0]!.newConfirmed).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(confirm(id, 3)).toEqual({ state: "waiting" });
    expect(store.listed()[0]!.newConfirmed).toBe(true);
    expect(store.check(id)).toMatchObject({ newConfirmed: true });
    expect(changed).toHaveBeenCalledTimes(2);
    confirm(id, 4);
    store.poll({ requestId: id, seq: 5, at: iso(0), confirmed: false });
    expect(store.listed()[0]!.newConfirmed).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("is not recorded from a poll the store refuses", () => {
    const { store, revealFrom, confirm, changed } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(confirm(id, 1)).toEqual({ refused: "invalid" });
    expect(store.listed()[0]!.newConfirmed).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("does not stop the new box's cancel ending a waiting request", () => {
    const { store, revealFrom, confirm } = setup();
    const { id } = revealFrom("10.0.0.1");
    confirm(id);
    expect(store.cancel({ requestId: id, seq: 3 })).toEqual({ cancelled: true });
    expect(store.poll({ requestId: id, seq: 4, at: iso(0), confirmed: true })).toEqual({
      state: "ended",
      reason: "cancelled",
    });
    expect(store.listed()).toEqual([]);
  });
});

describe("approve", () => {
  it("refuses an approve before the new box said Join, leaving the request waiting and listed", () => {
    const { store, revealFrom, confirm, changed } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(store.approve.begin(id)).toEqual({ refused: "not_confirmed" });
    expect(store.listed().map((r) => r.id)).toEqual([id]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(confirm(id)).toEqual({ state: "waiting" });
    expect(store.approve.begin(id)).toEqual({
      encryptionKey: helloFrom("10.0.0.1").encryptionKey,
    });
  });

  it("blocks a second approve while building, and a failed build leaves the request waiting", () => {
    const { store, revealFrom, confirm } = setup();
    const { id } = revealFrom("10.0.0.1");
    confirm(id);
    expect(store.approve.begin(id)).toEqual({
      encryptionKey: helloFrom("10.0.0.1").encryptionKey,
    });
    expect(store.approve.begin(id)).toEqual({ refused: "in_progress" });
    store.approve.abandon(id);
    expect(store.poll({ requestId: id, seq: 3, at: iso(0), confirmed: false })).toEqual({
      state: "waiting",
    });
    expect(store.approve.begin(id)).not.toHaveProperty("refused");
  });

  it("gives a locked bundle only to its own request", () => {
    const { store, revealFrom, confirm } = setup();
    const a = revealFrom("10.0.0.1").id;
    const b = revealFrom("10.0.0.2").id;
    confirm(a);
    store.approve.begin(a);
    expect(store.approve.finish(a, locked("a"))).toBe(true);
    expect(store.poll({ requestId: b, seq: 2, at: iso(0), confirmed: false })).toEqual({
      state: "waiting",
    });
    expect(store.poll({ requestId: a, seq: 3, at: iso(0), confirmed: false })).toEqual({
      state: "approved",
      locked: locked("a"),
    });
    expect(store.listed().map((r) => r.id)).toEqual([b]);
  });
});

describe("changes to the list", () => {
  it("tells its listener when a request is listed, confirmed, approved or ends, and not for a hello or another poll", () => {
    const { store, hello, reveal, revealFrom, confirm, changed } = setup();
    const opened = hello("10.0.0.1");
    if ("refused" in opened) throw new Error("hello refused");
    expect(changed).not.toHaveBeenCalled();
    reveal(opened.requestId, "10.0.0.1");
    expect(changed).toHaveBeenCalledTimes(1);
    store.poll({ requestId: opened.requestId, seq: 2, at: iso(0), confirmed: false });
    expect(changed).toHaveBeenCalledTimes(1);

    const approved = revealFrom("10.0.0.2").id;
    expect(changed).toHaveBeenCalledTimes(2);
    confirm(approved);
    expect(changed).toHaveBeenCalledTimes(3);
    store.approve.begin(approved);
    store.approve.finish(approved, locked("a"));
    expect(changed).toHaveBeenCalledTimes(4);

    store.dismiss(opened.requestId);
    expect(changed).toHaveBeenCalledTimes(5);
    const cancelled = revealFrom("10.0.0.3").id;
    store.cancel({ requestId: cancelled, seq: 2 });
    expect(changed).toHaveBeenCalledTimes(7);
  });
});

describe("stopping a request while it is approved", () => {
  it("refuses a cancel while the copy is built or once approved, and a Dismiss while it is built", () => {
    const { store, revealFrom, confirm } = setup();
    const { id } = revealFrom("10.0.0.1");
    confirm(id);
    store.approve.begin(id);
    expect(store.cancel({ requestId: id, seq: 3 })).toEqual({ refused: "approving" });
    expect(store.dismiss(id)).toEqual({ refused: "in_progress" });
    expect(store.approve.finish(id, locked("a"))).toBe(true);
    expect(store.cancel({ requestId: id, seq: 4 })).toEqual({ refused: "approving" });
    expect(store.poll({ requestId: id, seq: 5, at: iso(0), confirmed: false })).toEqual({
      state: "approved",
      locked: locked("a"),
    });
  });

  it("takes a cancel again once a failed build has left the request waiting", () => {
    const { store, revealFrom, confirm } = setup();
    const { id } = revealFrom("10.0.0.1");
    confirm(id);
    store.approve.begin(id);
    expect(store.cancel({ requestId: id, seq: 3 })).toEqual({ refused: "approving" });
    store.approve.abandon(id);
    expect(store.cancel({ requestId: id, seq: 4 })).toEqual({ cancelled: true });
    expect(store.poll({ requestId: id, seq: 5, at: iso(0), confirmed: false })).toEqual({
      state: "ended",
      reason: "cancelled",
    });
  });
});

describe("one approval at a time", () => {
  it("refuses approving another request while one is built or approved, until that one is forgotten", () => {
    const { store, revealFrom, confirm, advance } = setup();
    const a = revealFrom("10.0.0.1").id;
    const b = revealFrom("10.0.0.2").id;
    confirm(a);
    confirm(b);
    store.approve.begin(a);
    expect(store.approve.begin(b)).toEqual({ refused: "other_approved" });
    store.approve.finish(a, locked("a"));
    expect(store.approve.begin(b)).toEqual({ refused: "other_approved" });
    expect(store.poll({ requestId: b, seq: 3, at: iso(0), confirmed: false })).toEqual({
      state: "waiting",
    });
    advance(2 * 60_000);
    expect(store.approve.begin(b)).toEqual({
      encryptionKey: helloFrom("10.0.0.2").encryptionKey,
    });
  });

  it("takes an approve of another request once a failed build has left the first waiting", () => {
    const { store, revealFrom, confirm } = setup();
    const a = revealFrom("10.0.0.1").id;
    const b = revealFrom("10.0.0.2").id;
    confirm(a);
    confirm(b);
    store.approve.begin(a);
    store.approve.abandon(a);
    expect(store.approve.begin(b)).not.toHaveProperty("refused");
  });
});

describe("refusals for a request it cannot act on", () => {
  it("answers a reveal of an ended request with why it ended, and one with seq 0 as invalid", () => {
    const { store, hello, reveal, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    store.cancel({ requestId: id, seq: 2 });
    expect(reveal(id, "10.0.0.1")).toEqual({ refused: "ended", reason: "cancelled" });

    const second = hello("10.0.0.2");
    if ("refused" in second) throw new Error("hello refused");
    expect(reveal(second.requestId, "10.0.0.2", newNonceOf("10.0.0.2"), 0)).toEqual({
      refused: "invalid",
    });
    expect(store.listed()).toEqual([]);
  });

  it("refuses a cancel for an unknown request, and one whose seq does not rise", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(store.cancel({ requestId: "req-unknown", seq: 2 })).toEqual({ refused: "not_found" });
    expect(store.cancel({ requestId: id, seq: 1 })).toEqual({ refused: "invalid" });
    expect(store.listed().map((r) => r.id)).toEqual([id]);
  });

  it("refuses to approve a request it does not list", () => {
    const { store, hello } = setup();
    hello("10.0.0.1");
    expect(store.approve.begin("req-1")).toEqual({ refused: "not_found" });
    expect(store.approve.begin("req-unknown")).toEqual({ refused: "not_found" });
  });
});
