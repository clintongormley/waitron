// A relay the test drives byte by byte, for the edge paths the well-behaved stand-in in `relay.ts`
// never takes.
import { createServer, type AddressInfo, type Socket } from "node:net";
import { decodeFrame, type Frame } from "../protocol.js";

/** `count()` is how many box connections have been accepted, so a replacement dial shows up. */
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

/** The client writes only one frame before the relay speaks, so a single decode suffices. */
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
