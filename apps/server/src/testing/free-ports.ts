import { createServer, type Server, type AddressInfo } from "node:net";

function bindProbe(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve(probe));
  });
}

function release(probe: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}

/**
 * `count` distinct OS-assigned ports, released before use: `WAITRON_HTTP_PORT` rejects `"0"`. Every
 * probe stays bound until the last port is drawn, because Linux can hand a just-released port
 * straight back to the next draw. Draw every port a test needs before it binds any of them in one
 * call; a port another process binds between the release and the test's own bind is not covered.
 */
export async function freePorts(count: number): Promise<number[]> {
  const probes: Server[] = [];
  try {
    for (let i = 0; i < count; i += 1) probes.push(await bindProbe());
  } catch (error) {
    await Promise.allSettled(probes.map(release));
    throw error;
  }
  const ports = probes.map((probe) => (probe.address() as AddressInfo).port);
  await Promise.all(probes.map(release));
  return ports;
}

export async function freePort(): Promise<number> {
  const [port] = await freePorts(1);
  return port as number;
}
