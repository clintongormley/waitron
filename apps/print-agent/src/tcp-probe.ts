import { createConnection, isIP, type NetConnectOpts, type Socket } from "node:net";
import type { DiscoveredDevice, NetworkProbe } from "@waitron/print-agent";

/** Only establish a connection; arbitrary bytes can print on a device's raw TCP port. */
export function connectTcp(
  host: string,
  port: number,
  timeoutMs: number,
  dial: (options: NetConnectOpts) => Socket = createConnection,
): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve(ok);
    };
    try {
      socket = dial({ host, port });
      timer = setTimeout(() => finish(false), timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** The host checks literal IPs only, with a bounded fan-out and a deadline for every socket. */
export async function probeNetwork(
  targets: NetworkProbe[],
  connect: (host: string, port: number, timeoutMs: number) => Promise<boolean> = connectTcp,
): Promise<DiscoveredDevice[]> {
  const checked = targets
    .slice(0, 8)
    .filter(
      ({ host, port }) =>
        isIP(host) !== 0 &&
        !host.includes("%") &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535,
    );
  const results = await Promise.all(
    checked.map(async ({ host, port }) => {
      try {
        return await connect(host, port, 500);
      } catch {
        return false;
      }
    }),
  );
  return checked
    .filter((_, index) => results[index])
    .map(({ host, port }) => ({ transport: "network_tcp", host, port }));
}
