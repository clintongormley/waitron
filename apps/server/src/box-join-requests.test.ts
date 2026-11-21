import { describe, expect, it, vi } from "vitest";
import { commitmentFor, joinCode, type JoinCodeInputs } from "./box-join-code.js";
import type { LockedJoinBundle } from "./box-join-seal.js";
import { createBoxJoinRequests, type JoinHello } from "./box-join-requests.js";

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

/** The real code request `id` from `address` will show, computed the way the new box does. */
function codeOf(id: string, address: string): string {
  const inputs: JoinCodeInputs = {
    ...helloFrom(address),
    mainNodeId: MAIN.nodeId,
    mainPublicKey: MAIN.publicKey,
    newNonce: newNonceOf(address),
    mainNonce: mainNonceOf(id),
    requestId: id,
  };
  return joinCode(inputs);
}

function setup() {
  const clock = { steady: 1_000, wall: WALL_START };
  const decoys: string[] = [];
  let ids = 0;
  let decoyFill = 0;
  const store = createBoxJoinRequests({
    steadyNow: () => clock.steady,
    wallNow: () => clock.wall,
    newId: () => `req-${++ids}`,
    newMainNonce: (id) => mainNonceOf(id),
    drawCode: () => decoys.shift() ?? String(100_000 + decoyFill++),
  });
  const advance = (ms: number) => {
    clock.steady += ms;
    clock.wall += ms;
  };
  const hello = (address: string) =>
    store.admitHello(address) ??
    store.openHello({ address, hello: helloFrom(address), main: MAIN, at: iso(0) });
  const signAnswer = vi.fn((mainNonce: Buffer) => `signed ${mainNonce.toString("hex", 0, 4)}`);
  const reveal = (id: string, address: string, nonce = newNonceOf(address), seq = 1) =>
    store.reveal({ requestId: id, newNonce: nonce, seq, signAnswer });
  /** Hello and reveal; returns the request id. */
  const revealFrom = (address: string) => {
    const answer = hello(address);
    if ("refused" in answer) throw new Error(`hello refused: ${answer.refused}`);
    const revealed = reveal(answer.requestId, address);
    return { id: answer.requestId, revealed };
  };
  return { store, clock, decoys, advance, hello, reveal, revealFrom, signAnswer };
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
    expect(hello("10.0.0.1")).toEqual({ refused: "full", limit: "address", retryAt: iso(30_000) });
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
    expect(hello("10.0.0.1")).toEqual({ refused: "full", limit: "address", retryAt: iso(60_000) });
    advance(55_000);
    expect(hello("10.0.0.1")).toMatchObject({ requestId: "req-6" });
  });

  it("takes twenty hellos a minute in total", () => {
    const { hello, advance } = setup();
    for (let n = 1; n <= 20; n++) hello(`10.0.0.${n}`);
    advance(10_000);
    expect(hello("10.0.1.1")).toEqual({ refused: "full", limit: "network", retryAt: iso(60_000) });
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
  it("lists the request with its code and two decoys, and answers the main box's nonce", () => {
    const { store, decoys, revealFrom, signAnswer } = setup();
    decoys.push("111111", "222222");
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
        expiresAt: iso(15 * 60_000),
        startedAgain: false,
      },
    ]);
    const check = store.check("req-1");
    expect("refused" in check ? [] : [...check.choices].sort()).toEqual(
      ["111111", "222222", codeOf("req-1", "10.0.0.1")].sort(),
    );
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
    expect(store.poll({ requestId: id, seq: 2, at: iso(0) })).toEqual({
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
    expect(store.poll({ requestId: id, seq: 2, at: iso(0) })).toEqual({
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
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0) })).toEqual({
      refused: "not_found",
    });
    expect(reveal("req-1", "10.0.0.1")).toHaveProperty("mainNonce");
  });

  it("keeps the order of the three codes from one Check to the next", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    const order = () => {
      const check = store.check(id);
      return "refused" in check ? [] : check.choices;
    };
    const first = order();
    expect(first).toHaveLength(3);
    for (let n = 0; n < 20; n++) expect(order()).toEqual(first);
  });

  it("hands Check a copy of the codes, so a caller cannot reorder the stored list", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    const read = store.check(id);
    if ("refused" in read) throw new Error("not listed");
    const first = [...read.choices];
    read.choices.reverse();
    expect(store.check(id)).toMatchObject({ choices: first });
  });

  it("refuses a code a listed request shows, real or decoy, without the main box's nonce", () => {
    const { store, decoys, revealFrom } = setup();
    decoys.push(codeOf("req-2", "10.0.0.2"), "222222");
    revealFrom("10.0.0.1");
    expect(revealFrom("10.0.0.2").revealed).toEqual({ refused: "code_taken" });
    expect(store.poll({ requestId: "req-2", seq: 2, at: iso(0) })).toEqual({
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
    });
    expect(revealFrom("10.0.0.1").revealed).toHaveProperty("mainNonce");
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0) })).toEqual({
      state: "ended",
      reason: "replaced",
    });
    expect(store.listed().map((r) => r.id)).toEqual(["req-2", "req-3", "req-5"]);
  });

  it("frees a reveal place on a wrong tap or a Dismiss, not on a cancel, replacement, expiry or taken code", () => {
    const { store, decoys, hello, reveal, revealFrom, advance } = setup();
    hello("10.0.0.9");
    advance(29_000);
    reveal("req-1", "10.0.0.9"); // 1: expires 14 min 31 s from now
    store.dismiss(revealFrom("10.0.0.1").id);
    store.approve.begin(revealFrom("10.0.0.2").id, "not-the-code");
    store.cancel({ requestId: revealFrom("10.0.0.3").id, seq: 2 }); // 2
    revealFrom("10.0.0.4"); // 3
    decoys.push(codeOf("req-7", "10.0.0.5"));
    revealFrom("10.0.0.4"); // 4: replaces req-5
    expect(revealFrom("10.0.0.5").revealed).toEqual({ refused: "code_taken" }); // 5
    advance(15 * 60_000 - 29_000);
    expect(store.poll({ requestId: "req-1", seq: 2, at: iso(0) })).toEqual({
      refused: "not_found",
    });
    expect(revealFrom("10.0.0.6").revealed).toHaveProperty("mainNonce"); // 6
    expect(revealFrom("10.0.0.7").revealed).toEqual({
      refused: "full",
      limit: "recent",
      retryAt: iso(29_000 + 15 * 60_000),
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
    expect(store.poll({ requestId: id, seq: 1, at: iso(0) })).toEqual({ refused: "invalid" });
    advance(2_000);
    expect(store.poll({ requestId: id, seq: 2, at: iso(5_000) })).toEqual({ state: "waiting" });
    expect(store.poll({ requestId: id, seq: 2, at: iso(5_000) })).toEqual({ refused: "invalid" });
    advance(2_000);
    expect(store.poll({ requestId: id, seq: 3, at: iso(-60_000) })).toEqual({ state: "waiting" });
    expect(store.check(id)).toMatchObject({ at: iso(-60_000), atReceivedAt: iso(4_000) });
  });

  it("ends a listed request 15 minutes after its hello", () => {
    const { store, revealFrom, advance } = setup();
    const { id } = revealFrom("10.0.0.1");
    advance(15 * 60_000 - 1);
    expect(store.poll({ requestId: id, seq: 2, at: iso(0) })).toEqual({ state: "waiting" });
    advance(1);
    expect(store.poll({ requestId: id, seq: 3, at: iso(0) })).toEqual({ refused: "not_found" });
    expect(store.listed()).toEqual([]);
  });

  it("keeps an ended request's reason, and an approved request's bundle, for 2 minutes", () => {
    const { store, revealFrom, advance } = setup();
    const ended = revealFrom("10.0.0.1").id;
    const approved = revealFrom("10.0.0.2").id;
    store.dismiss(ended);
    store.approve.begin(approved, codeOf(approved, "10.0.0.2"));
    store.approve.finish(approved, locked("a"));
    advance(2 * 60_000 - 1);
    expect(store.poll({ requestId: ended, seq: 2, at: iso(0) })).toEqual({
      state: "ended",
      reason: "dismissed",
    });
    expect(store.poll({ requestId: approved, seq: 2, at: iso(0) })).toEqual({
      state: "approved",
      locked: locked("a"),
    });
    advance(1);
    expect(store.poll({ requestId: ended, seq: 3, at: iso(0) })).toEqual({ refused: "not_found" });
    expect(store.poll({ requestId: approved, seq: 3, at: iso(0) })).toEqual({
      refused: "not_found",
    });
  });
});

describe("approve", () => {
  it("ends the request on a wrong code", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    expect(store.approve.begin(id, "000000")).toEqual({ refused: "wrong_code" });
    expect(store.poll({ requestId: id, seq: 2, at: iso(0) })).toEqual({
      state: "ended",
      reason: "wrong_code",
    });
  });

  it("blocks a second approve while building, and a failed build leaves the request waiting", () => {
    const { store, revealFrom } = setup();
    const { id } = revealFrom("10.0.0.1");
    const code = codeOf(id, "10.0.0.1");
    expect(store.approve.begin(id, code)).toEqual({
      encryptionKey: helloFrom("10.0.0.1").encryptionKey,
    });
    expect(store.approve.begin(id, code)).toEqual({ refused: "in_progress" });
    store.approve.abandon(id);
    expect(store.poll({ requestId: id, seq: 2, at: iso(0) })).toEqual({ state: "waiting" });
    expect(store.approve.begin(id, code)).not.toHaveProperty("refused");
  });

  it("gives a locked bundle only to its own request", () => {
    const { store, revealFrom } = setup();
    const a = revealFrom("10.0.0.1").id;
    const b = revealFrom("10.0.0.2").id;
    store.approve.begin(a, codeOf(a, "10.0.0.1"));
    expect(store.approve.finish(a, locked("a"))).toBe(true);
    expect(store.poll({ requestId: b, seq: 2, at: iso(0) })).toEqual({ state: "waiting" });
    expect(store.poll({ requestId: a, seq: 2, at: iso(0) })).toEqual({
      state: "approved",
      locked: locked("a"),
    });
    expect(store.listed().map((r) => r.id)).toEqual([b]);
  });
});
