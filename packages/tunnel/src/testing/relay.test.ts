import { connect, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "../protocol.js";
import { createRelayStandin, type RelayStandin } from "./relay.js";

let relay: RelayStandin | undefined;
afterEach(async () => {
  if (relay !== undefined) await relay.close();
  relay = undefined;
});

const readFrame = (s: Socket): Promise<ReturnType<typeof decodeFrame>> =>
  new Promise((res) => s.once("data", (d) => res(decodeFrame(d))));

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

const closed = (s: Socket): Promise<void> => new Promise((res) => s.once("close", () => res()));

// A test-side box: consume the handshake frames (`ack`, then `go`), then echo every raw byte back.
// Robust to `ack` and `go` coalescing into one TCP segment (which happens when the box is handed
// straight to a waiting client), unlike an inline `decodeFrame(chunk)` that would drop the second
// frame's `rest`.
function echoAfterGo(box: Socket): void {
  let buf: Buffer = Buffer.alloc(0);
  let live = false;
  box.on("data", (d) => {
    if (live) {
      box.write(d);
      return;
    }
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = decodeFrame(buf);
      if (r === null) return;
      buf = r.rest;
      if (r.frame.t === "go") {
        live = true;
        if (buf.length > 0) box.write(buf);
        buf = Buffer.alloc(0);
        return;
      }
    }
  });
}

describe("createRelayStandin", () => {
  it("acks a box that registers with a valid token", async () => {
    relay = await createRelayStandin({
      verifyToken: (id, t) => id === "box-1" && t === "good",
      host: "127.0.0.1",
    });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "box-1", token: "good" }));
    expect((await readFrame(box))!.frame).toEqual({ t: "ack" });
    box.destroy();
  });

  it("rejects a bad token and closes the connection", async () => {
    relay = await createRelayStandin({ verifyToken: () => false });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "box-1", token: "nope" }));
    expect((await readFrame(box))!.frame).toEqual({
      t: "reject",
      code: "tunnel.registration_rejected",
    });
  });

  it("pairs a client with an idle box connection and splices both directions", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    // Box registers and waits for `go`, then echoes.
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box); // ack
    box.on("data", (d) => {
      const r = decodeFrame(d);
      if (r && r.frame.t === "go") {
        if (r.rest.length) box.write(r.rest); // echo any leftover
        box.on("data", (chunk) => box.write(chunk)); // echo subsequent bytes
      }
    });
    // Client connects and sends a payload; expects it echoed back through the splice.
    const client = connect(relay.clientPort, "127.0.0.1");
    const got = new Promise<string>((res) => client.once("data", (d) => res(d.toString())));
    // Give the relay a tick to send `go` before the client speaks.
    await new Promise((r) => setTimeout(r, 20));
    client.write("hello-through-the-tunnel");
    expect(await got).toBe("hello-through-the-tunnel");
    expect(
      relay
        .bytesSeen()
        .map((b) => b.toString())
        .join(""),
    ).toContain("hello-through-the-tunnel");
    client.destroy();
    box.destroy();
  });

  it("drops a box that sends a garbage line and keeps serving other connections", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    // A malformed (non-JSON) line makes decodeFrame's JSON.parse throw. It must destroy only this
    // one socket, never crash the relay (Task 1 review carry-forward).
    const bad = connect(relay.boxPort, "127.0.0.1");
    const badClosed = closed(bad);
    bad.write(Buffer.from("this is not json\n"));
    await badClosed;
    // The relay still serves a subsequent valid registration.
    const good = connect(relay.boxPort, "127.0.0.1");
    good.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    expect((await readFrame(good))!.frame).toEqual({ t: "ack" });
    good.destroy();
  });

  it("waits for a box to register, then pairs the already-waiting client", async () => {
    relay = await createRelayStandin({ verifyToken: () => true, waitForBoxMs: 1000 });
    const client = connect(relay.clientPort, "127.0.0.1");
    const got = new Promise<string>((res) => client.once("data", (d) => res(d.toString())));
    // The client arrives first; the box registers only after it is already waiting.
    await sleep(20);
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    echoAfterGo(box);
    await sleep(20);
    client.write("via-waiter");
    expect(await got).toBe("via-waiter");
    client.destroy();
    box.destroy();
  });

  it("drops a client that waits when no box ever registers", async () => {
    relay = await createRelayStandin({ verifyToken: () => true, waitForBoxMs: 25 });
    const client = connect(relay.clientPort, "127.0.0.1");
    await closed(client); // dropped once the wait window elapses with no idle box
  });

  it("pongs a ping while idle and ignores a non-ping frame", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box); // ack — now parked idle
    box.write(encodeFrame({ t: "pong" })); // stray non-ping frame — relay ignores it
    box.write(encodeFrame({ t: "ping" })); // heartbeat — relay pongs
    expect((await readFrame(box))!.frame).toEqual({ t: "pong" });
    box.destroy();
  });

  it("acks a register frame that arrives split across two writes", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box = connect(relay.boxPort, "127.0.0.1");
    const frame = encodeFrame({ t: "register", boxId: "b", token: "t" });
    box.write(frame.subarray(0, 6)); // partial — decodeFrame returns null, the relay buffers
    await sleep(10);
    box.write(frame.subarray(6)); // completes the frame
    expect((await readFrame(box))!.frame).toEqual({ t: "ack" });
    box.destroy();
  });

  it("drops a box whose first frame is not a register", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box = connect(relay.boxPort, "127.0.0.1");
    const boxClosed = closed(box);
    box.write(encodeFrame({ t: "ping" })); // not a register → dropped
    await boxClosed;
    box.destroy();
  });

  it("drops an idle box that sends garbage after registering, and keeps serving", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box); // ack — parked idle
    const boxClosed = closed(box);
    box.write(Buffer.from("garbage-not-json\n")); // malformed idle-phase line → dropped
    await boxClosed;
    const good = connect(relay.boxPort, "127.0.0.1");
    good.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    expect((await readFrame(good))!.frame).toEqual({ t: "ack" });
    good.destroy();
  });

  it("pairs two clients with two idle connections from the same box", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box1 = connect(relay.boxPort, "127.0.0.1");
    const box2 = connect(relay.boxPort, "127.0.0.1");
    box1.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    box2.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box1); // ack
    await readFrame(box2); // ack — both parked under "b"
    echoAfterGo(box1);
    echoAfterGo(box2);

    const c1 = connect(relay.clientPort, "127.0.0.1");
    const g1 = new Promise<string>((res) => c1.once("data", (d) => res(d.toString())));
    await sleep(20);
    c1.write("one");
    expect(await g1).toBe("one");

    const c2 = connect(relay.clientPort, "127.0.0.1");
    const g2 = new Promise<string>((res) => c2.once("data", (d) => res(d.toString())));
    await sleep(20);
    c2.write("two");
    expect(await g2).toBe("two");

    c1.destroy();
    c2.destroy();
    box1.destroy();
    box2.destroy();
  });

  it("close() destroys parked idle box connections", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    const box = connect(relay.boxPort, "127.0.0.1");
    box.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await readFrame(box); // ack — parked idle
    const boxClosed = closed(box);
    await relay.close();
    await boxClosed; // closing the relay tore down the parked idle socket
    relay = undefined; // already closed; skip the afterEach close
    box.destroy();
  });

  it("close() drops a client that is still waiting for a box", async () => {
    relay = await createRelayStandin({ verifyToken: () => true, waitForBoxMs: 5000 });
    const client = connect(relay.clientPort, "127.0.0.1");
    const clientClosed = closed(client);
    await sleep(20); // let the relay accept the client and park it as a waiter
    await relay.close(); // cancels the pending waiter and tears the client down before the timeout
    await clientClosed;
    relay = undefined; // already closed; skip the afterEach close
  });

  it("close() is idempotent", async () => {
    relay = await createRelayStandin({ verifyToken: () => true });
    await relay.close();
    await relay.close(); // second close resolves without error
    relay = undefined;
  });
});
