import { createServer, type Server } from "node:net";

const RANGE_START = 20000;
const SLICE_SIZE = 500;
const SLICES = 25;

/**
 * Ports are drawn from 20000–32499, below the automatic range Linux (32768–60999) and macOS
 * (49152–65535) hand out for a port-0 bind or an outgoing connection, so no such bind in any
 * process can take a drawn port before the test binds it. Each Vitest worker draws from its own
 * slice of 500 (`VITEST_POOL_ID` modulo 25, else the process id), walking forward from a random
 * start, so two workers of one run never draw the same port. Two separate runs on one machine share
 * slice numbers, so a port can still be taken between its check and the test's bind.
 */
const poolId = Number(process.env.VITEST_POOL_ID);
const slice = (Number.isInteger(poolId) && poolId > 0 ? poolId : process.pid) % SLICES;
const sliceStart = RANGE_START + slice * SLICE_SIZE;
let cursor: number | undefined;

function bindOn(port: number): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" ? resolve(undefined) : reject(error),
    );
    probe.listen(port, "127.0.0.1", () => resolve(probe));
  });
}

function release(probe: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}

async function nextPort(): Promise<number> {
  cursor ??= Math.floor(Math.random() * SLICE_SIZE);
  for (let tried = 0; tried < SLICE_SIZE; tried += 1) {
    const port = sliceStart + cursor;
    cursor = (cursor + 1) % SLICE_SIZE;
    const probe = await bindOn(port);
    if (probe === undefined) continue;
    await release(probe);
    return port;
  }
  throw new Error(`every port from ${sliceStart} to ${sliceStart + SLICE_SIZE - 1} is in use`);
}

/** `count` distinct ports, free when checked and released before use: `WAITRON_HTTP_PORT` rejects `"0"`. */
export async function freePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let i = 0; i < count; i += 1) ports.push(await nextPort());
  return ports;
}

export async function freePort(): Promise<number> {
  const [port] = await freePorts(1);
  return port as number;
}
