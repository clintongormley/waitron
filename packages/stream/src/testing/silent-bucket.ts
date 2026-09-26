import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import type { BucketConfig } from "../s3-store.js";

export interface SilentBucket {
  /** Settings that address this bucket by path, as the store does for any endpoint it is given. */
  config: BucketConfig;
  /** How many connections it has taken. */
  connections(): number;
  close(): Promise<void>;
}

/**
 * A bucket that takes every connection on 127.0.0.1, reads what it is sent, and never writes a
 * byte back.
 */
export async function silentBucket(): Promise<SilentBucket> {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    const forget = () => {
      sockets.delete(socket);
    };
    socket.on("error", forget);
    socket.on("close", forget);
    socket.resume();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: {
      endpoint: `http://127.0.0.1:${port}`,
      region: "us-east-1",
      bucket: "silent",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "not-a-real-secret",
    },
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
