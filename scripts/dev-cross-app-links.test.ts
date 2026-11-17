import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { UserConfigExport, ViteDevServer } from "vite";

const require = createRequire(new URL("../apps/setup/package.json", import.meta.url));
const { createServer } = (await import(
  pathToFileURL(require.resolve("vite")).href
)) as typeof import("vite");
const servers = new Map<string, ViteDevServer>();
const box = createHttpServer((request, response) => response.end(`box ${request.url}`));
const variables = [
  "WAITRON_TILL_VITE_PORT",
  "WAITRON_DASHBOARD_VITE_PORT",
  "WAITRON_SETUP_VITE_PORT",
];

beforeAll(async () => {
  await new Promise<void>((resolve) => box.listen(0, "127.0.0.1", resolve));
  const boxOrigin = `http://127.0.0.1:${(box.address() as AddressInfo).port}`;
  for (const app of ["till", "dashboard", "setup"]) {
    const root = new URL(`../apps/${app}/`, import.meta.url);
    const { default: exported } = (await import(new URL("vite.config.ts", root).href)) as {
      default: UserConfigExport;
    };
    const config = await (typeof exported === "function"
      ? exported({ command: "serve", mode: "development" })
      : exported);
    const server = await createServer({
      ...config,
      configFile: false,
      root: fileURLToPath(root),
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      server: {
        ...config.server,
        host: "localhost",
        port: 0,
        proxy:
          app === "setup"
            ? Object.fromEntries(
                Object.entries(config.server?.proxy ?? {}).map(([path, proxy]) => [
                  path,
                  { ...(typeof proxy === "string" ? {} : proxy), target: boxOrigin },
                ]),
              )
            : {},
      },
    });
    servers.set(app, server);
    await server.listen();
  }
});
afterAll(async () => {
  for (const server of servers.values()) await server.close();
  await new Promise<void>((resolve, reject) =>
    box.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  for (const variable of variables) vi.stubEnv(variable, undefined);
});
afterEach(() => vi.unstubAllEnvs());

function origin(app: string): string {
  return `http://localhost:${(servers.get(app)!.httpServer!.address() as AddressInfo).port}`;
}

it.each([false, true])(
  "sends existing cross-app links to their own origin (shifted=%s)",
  async (shifted) => {
    if (shifted) variables.forEach((variable, index) => vi.stubEnv(variable, String(5290 + index)));
    const till = shifted ? 5290 : 5190;
    const dashboard = shifted ? 5291 : 5191;
    for (const [app, url, expected] of [
      ["till", "/manage/devices?view=all", `http://localhost:${dashboard}/manage/devices?view=all`],
      ["till", "/manage", `http://localhost:${dashboard}/manage`],
      ["dashboard", "/till/?dev", `http://localhost:${till}/till/?dev`],
      ["setup", "/till/", `http://localhost:${till}/till/`],
      ["setup", "/manage/email", `http://localhost:${dashboard}/manage/email`],
    ]) {
      const response = await fetch(origin(app!) + url, { redirect: "manual" });
      await response.arrayBuffer();
      expect(response.status, `${app}${url}`).toBe(302);
      expect(response.headers.get("location"), `${app}${url}`).toBe(expected);
    }
  },
);

it("keeps app paths local and preserves setup's handover entry", async () => {
  const till = await fetch(origin("till") + "/till/", { redirect: "manual" });
  expect(till.status).toBe(200);
  expect(await till.text()).toContain("<title>Waitron Till</title>");
  for (const app of ["till", "setup"]) {
    for (const url of ["/manage-x", "/management-api"]) {
      const response = await fetch(origin(app) + url, { redirect: "manual" });
      await response.arrayBuffer();
      expect(response.status).not.toBe(302);
    }
  }
  const setup = await fetch(origin("setup") + "/setup/");
  expect(await setup.text()).toContain("/setup/src/main.ts");
  const handover = await fetch(origin("setup") + "/handover/emergency");
  expect(handover.status).toBe(200);
  const html = await handover.text();
  expect(html).toContain("/setup/src/main.ts");
  const entry = await fetch(origin("setup") + "/setup/src/main.ts");
  expect(entry.headers.get("content-type")).toContain("javascript");
  expect(await entry.text()).toContain("/handover/");
});

it("routes setup's existing box links before setup page handling", async () => {
  for (const path of [
    "/setup/trust",
    "/setup/connection",
    "/ca.crt",
    "/help/en/email",
    "/legal/privacy",
    "/setup-api/state",
    "/api/node/handover/emergency/preview",
  ]) {
    const response = await fetch(origin("setup") + path, { redirect: "manual" });
    expect(response.status, path).toBe(200);
    expect(await response.text(), path).toBe(`box ${path}`);
  }
});
