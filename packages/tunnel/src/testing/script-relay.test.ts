import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { encodeFrame, type Frame } from "../protocol.js";
import { onceRegister, scriptRelay, wait, type ScriptRelay } from "./script-relay.js";

let scripted: ScriptRelay | undefined;
afterEach(async () => {
  if (scripted !== undefined) await scripted.close();
  scripted = undefined;
});

describe("scriptRelay", () => {
  it("survives a box that resets its connection, and accepts the next one", async () => {
    // A hard reset reaches the relay's side as an 'error' (ECONNRESET); unhandled, it would crash
    // the process instead of just dropping that one socket.
    const registers: Frame[] = [];
    const arrived: Array<() => void> = [];
    const nth = (n: number): Promise<void> => new Promise<void>((res) => (arrived[n] = res));
    const firstRead = nth(0);
    const secondRead = nth(1);
    scripted = await scriptRelay(
      (box, index) =>
        void onceRegister(box).then((f) => {
          registers.push(f);
          arrived[index]?.();
        }),
    );
    const first = connect(scripted.port, "127.0.0.1");
    first.write(encodeFrame({ t: "register", boxId: "b", token: "t" }));
    await firstRead;
    first.resetAndDestroy();
    await wait(20); // let the reset reach the relay before the next dial
    const second = connect(scripted.port, "127.0.0.1");
    second.write(encodeFrame({ t: "register", boxId: "b2", token: "t" }));
    await secondRead;
    expect(scripted.count()).toBe(2);
    expect(registers).toEqual([
      { t: "register", boxId: "b", token: "t" },
      { t: "register", boxId: "b2", token: "t" },
    ]);
    second.destroy();
  });
});

describe("onceRegister", () => {
  it("waits for the rest of a register frame that arrives split across two writes", async () => {
    let got: (f: Frame) => void = () => {};
    const register = new Promise<Frame>((res) => (got = res));
    let prefixSeen: () => void = () => {};
    const prefixRead = new Promise<void>((res) => (prefixSeen = res));
    scripted = await scriptRelay((box) => {
      void onceRegister(box).then(got);
      box.once("data", () => prefixSeen()); // after onceRegister's listener has read the same chunk
    });
    const box = connect(scripted.port, "127.0.0.1");
    const frame = encodeFrame({ t: "register", boxId: "b", token: "t" });
    box.write(frame.subarray(0, 6)); // partial — no complete frame yet
    await prefixRead; // the relay has read the prefix alone, so the two halves cannot coalesce
    box.write(frame.subarray(6));
    expect(await register).toEqual({ t: "register", boxId: "b", token: "t" });
    box.destroy();
  });
});
