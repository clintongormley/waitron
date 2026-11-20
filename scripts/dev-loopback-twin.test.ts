import { createRequire } from "node:module";
import { connect, createServer as createNetServer, type AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { Logger, UserConfig, UserConfigExport, ViteDevServer } from "vite";

const require = createRequire(new URL("../apps/setup/package.json", import.meta.url));
const { createLogger, createServer } = (await import(
  pathToFileURL(require.resolve("vite")).href
)) as typeof import("vite");

const PAGES = {
  till: ["/till/", "<title>Waitron Till</title>"],
  dashboard: ["/", "<title>Waitron Dashboard</title>"],
  setup: ["/setup/", "<title>Waitron — set up your server</title>"],
} as const;
type App = keyof typeof PAGES;

const open: ViteDevServer[] = [];
const blockers: ReturnType<typeof createNetServer>[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) await server.close();
  for (const blocker of blockers.splice(0)) await new Promise((done) => blocker.close(done));
});

async function serve(
  app: App,
  host: string | undefined,
  port = 0,
  logger?: Logger,
): Promise<number> {
  const root = new URL(`../apps/${app}/`, import.meta.url);
  const { default: exported } = (await import(new URL("vite.config.ts", root).href)) as {
    default: UserConfigExport;
  };
  const config = (await (typeof exported === "function"
    ? exported({ command: "serve", mode: "development" })
    : exported)) as UserConfig;
  const server = await createServer({
    ...config,
    configFile: false,
    root: fileURLToPath(root),
    logLevel: "silent",
    customLogger: logger,
    optimizeDeps: { noDiscovery: true },
    server: { ...config.server, ...(host === undefined ? {} : { host }), port, proxy: {} },
  });
  open.push(server);
  await server.listen();
  return (server.httpServer!.address() as AddressInfo).port;
}

function url(host: string, port: number, path: string): string {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}${path}`;
}

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

it.each([
  ...(["till", "dashboard", "setup"] as const).flatMap((app) => [
    [app, "::1", "127.0.0.1"] as const,
    [app, "127.0.0.1", "::1"] as const,
  ]),
])("the %s server bound to %s also answers on %s", async (app, host, twin) => {
  const port = await serve(app, host);
  const [path, title] = PAGES[app];
  for (const address of [host, twin]) {
    const response = await fetch(url(address, port, path), { redirect: "manual" });
    expect(response.status, address).toBe(200);
    expect(await response.text(), address).toContain(title);
  }
});

it.each(["till", "dashboard", "setup"] as const)(
  "the %s server's own host setting binds loopback only, and both loopbacks answer",
  async (app) => {
    const port = await serve(app, undefined);
    const bound = (open.at(-1)!.httpServer!.address() as AddressInfo).address;
    expect(["::1", "127.0.0.1"]).toContain(bound);
    const [path, title] = PAGES[app];
    for (const address of ["::1", "127.0.0.1"]) {
      const response = await fetch(url(address, port, path), { redirect: "manual" });
      expect(response.status, address).toBe(200);
      expect(await response.text(), address).toContain(title);
    }
  },
);

it("carries the hot-reload websocket through the twin", async () => {
  const port = await serve("till", "::1");
  const socket = new WebSocket(`ws://127.0.0.1:${port}/till/`, "vite-hmr");
  const first = await new Promise<string>((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
    socket.addEventListener("error", () => reject(new Error("websocket failed")), { once: true });
  });
  socket.close();
  expect(JSON.parse(first)).toMatchObject({ type: "connected" });
});

// The IPv4-mapped spelling of 127.0.0.1 is not in the plugin's table, so it stands for any other
// address while still binding on every machine without reaching the network.
it("opens no twin for a server bound to another address", async () => {
  const port = await serve("till", "::ffff:127.0.0.1");
  expect(await accepts("127.0.0.1", port)).toBe(true);
  expect(await accepts("::1", port)).toBe(false);
});

it("warns and keeps serving when the twin's port is taken", async () => {
  const blocker = createNetServer();
  blockers.push(blocker);
  await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
  const taken = (blocker.address() as AddressInfo).port;
  const logger = createLogger("silent");
  const warn = vi.spyOn(logger, "warn");
  const port = await serve("till", "::1", taken, logger);
  await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`127.0.0.1:${taken}`)),
  );
  const response = await fetch(url("::1", port, "/till/"));
  expect(response.status).toBe(200);
  await response.arrayBuffer();
});

it("closes the twin with the server", async () => {
  const port = await serve("till", "::1");
  expect(await accepts("127.0.0.1", port)).toBe(true);
  await open.pop()!.close();
  expect(await accepts("127.0.0.1", port)).toBe(false);
});
