// A scriptable stand-in relay + the small timing helpers the client suites share. The real relay
// stand-in (`relay.js`) is well-behaved, so the edge paths — coalescing `go` with its leftover,
// sending a garbage line, resetting mid-handshake, rejecting a registration — need a relay the test
// drives byte by byte. Lives here (a sibling of `relay.ts`) so `client.test.ts` and
// `client.resilience.test.ts` import one copy instead of keeping two in sync.
import { createServer, type AddressInfo, type Socket } from "node:net";
import { decodeFrame, type Frame } from "../protocol.js";

/** For each incoming box connection the relay invokes `script(box, index)`, so a test drives the
 * handshake bytes directly. `count()` reports how many box connections have been accepted (a
 * replacement dial shows up as a new one). */
export interface ScriptRelay {
  port: number;
  count: () => number;
  close: () => Promise<void>;
}

export function scriptRelay(script: (box: Socket, index: number) => void): Promise<ScriptRelay> {
  const boxes = new Set<Socket>();
  let index = 0;
  const server = createServer((box) => {
    boxes.add(box);
    box.on("error", () => box.destroy());
    box.on("close", () => boxes.delete(box));
    script(box, index++);
  });
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () =>
      res({
        port: (server.address() as AddressInfo).port,
        count: () => index,
        close: () =>
          new Promise<void>((r) => {
            for (const b of boxes) b.destroy();
            server.close(() => r());
          }),
      }),
    ),
  );
}

/** Resolve with the first complete frame a box connection sends (the client's `register`), then
 * detach. The client only writes one frame before the relay speaks, so a single decode suffices. */
export function onceRegister(box: Socket): Promise<Frame> {
  let buf = Buffer.alloc(0);
  return new Promise((res) => {
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      const r = decodeFrame(buf);
      if (r !== null) {
        box.off("data", onData);
        res(r.frame);
      }
    };
    box.on("data", onData);
  });
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The injected `deps.sleep`: a real abort-aware setTimeout that rejects on abort (the client's `nap`
 * wrapper swallows that rejection). Used where timing is driven by the abort rather than asserted. */
export const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("aborted"));
      },
      { once: true },
    );
  });
