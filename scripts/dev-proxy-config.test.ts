import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProxyOptions, UserConfig, UserConfigExport } from "vite";

import { devServerProxy } from "./dev-server-proxy.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const originalStateDir = process.env.WAITRON_STATE_DIR;
const stateDir = mkdtempSync(join(import.meta.dirname, "dev-proxy-state-"));

const EXPECTED_ROUTES: Record<string, string[]> = {
  dashboard: ["/api", "/help", "/legal", "/management-api", "/media"],
  setup: [
    "/api/node/handover",
    "/ca.crt",
    "/help",
    "/legal",
    "/setup-api",
    "/setup/connection",
    "/setup/trust",
  ],
  till: ["/api", "/help", "/legal", "/media"],
};

function staticConfig(config: UserConfigExport): UserConfig {
  const resolved =
    typeof config === "function" ? config({ command: "serve", mode: "development" }) : config;
  expect(resolved).toBeTypeOf("object");
  return resolved as UserConfig;
}

function proxyFrontEnds(): { app: string; configPath: string }[] {
  const apps = join(REPO_ROOT, "apps");
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      app: entry.name,
      configPath: join(apps, entry.name, "vite.config.ts"),
    }))
    .filter(({ configPath }) => existsSync(configPath))
    .filter(({ configPath }) => readFileSync(configPath, "utf8").includes("proxy:"));
}

beforeAll(() => {
  mkdirSync(join(stateDir, "tls"));
  writeFileSync(join(stateDir, "tls", "server.pem"), "certificate");
  writeFileSync(join(stateDir, "tls", "server.pem"), "key");
  process.env.WAITRON_STATE_DIR = stateDir;
});

afterAll(() => {
  if (originalStateDir === undefined) delete process.env.WAITRON_STATE_DIR;
  else process.env.WAITRON_STATE_DIR = originalStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

describe("development server proxy", () => {
  it("keeps the deployed setup base relative", async () => {
    const { default: config } = (await import("../apps/setup/vite.config.js")) as {
      default: UserConfigExport;
    };
    const resolved = await (typeof config === "function"
      ? config({ command: "build", mode: "production" })
      : config);
    expect(resolved.base).toBe("./");
  });
  it("uses HTTP without a box leaf and accepts the self-signed HTTPS leaf when present", () => {
    expect(devServerProxy({ stateDir: join(stateDir, "absent") })).toEqual({
      target: "http://127.0.0.1:8080",
      configure: expect.any(Function),
    });
    expect(devServerProxy({ stateDir })).toEqual({
      target: "https://127.0.0.1:8080",
      secure: false,
      configure: expect.any(Function),
    });
  });

  it("re-checks the box leaf each time the proxy target is read, so a leaf minted after Vite starts is followed", () => {
    const lateState = join(stateDir, "late");
    const proxy = devServerProxy({ stateDir: lateState });
    expect(proxy.target).toBe("http://127.0.0.1:8080");
    expect(proxy.secure).toBeUndefined();
    expect({ ...proxy }).toEqual({
      target: "http://127.0.0.1:8080",
      configure: expect.any(Function),
    });
    mkdirSync(join(lateState, "tls"), { recursive: true });
    writeFileSync(join(lateState, "tls", "server.pem"), "certificate");
    try {
      expect(proxy.target).toBe("https://127.0.0.1:8080");
      expect(proxy.secure).toBe(false);
      // http-proxy spreads the options object Vite hands it on every request.
      expect({ ...proxy }).toEqual({
        target: "https://127.0.0.1:8080",
        secure: false,
        configure: expect.any(Function),
      });
    } finally {
      rmSync(lateState, { recursive: true, force: true });
    }
  });

  it("sends each request by the protocol the box serves at that moment, through Vite's own proxy, presenting a same-host page's Origin as HTTPS to the HTTPS box", async () => {
    const lateState = join(stateDir, "per-request");
    const tlsDir = join(lateState, "tls");
    const keyDir = mkdtempSync(join(import.meta.dirname, "dev-proxy-key-"));
    const originalPort = process.env.WAITRON_HTTP_PORT;
    const listen = (server: Server, port: number) =>
      new Promise<number>((done, fail) => {
        server.once("error", fail);
        server.listen(port, "127.0.0.1", () => done((server.address() as AddressInfo).port));
      });
    const close = (server: Server) => new Promise((done) => server.close(done));
    const answer =
      (protocol: string) =>
      (
        request: import("node:http").IncomingMessage,
        response: import("node:http").ServerResponse,
      ) =>
        response.end(`${protocol} ${request.headers.origin ?? "none"}`);
    const plain = createHttpServer(answer("http"));
    let secure: Server | undefined;
    let vite: import("vite").ViteDevServer | undefined;
    try {
      const port = await listen(plain, 0);
      process.env.WAITRON_HTTP_PORT = String(port);
      const proxy = devServerProxy({ stateDir: lateState });
      const viteUrl = pathToFileURL(
        createRequire(join(REPO_ROOT, "apps", "setup", "package.json")).resolve("vite"),
      ).href;
      const { createServer } = (await import(viteUrl)) as typeof import("vite");
      vite = await createServer({
        configFile: false,
        root: keyDir,
        logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, proxy: { "/probe": proxy } },
      });
      await vite.listen();
      const page = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
      const probe = `${page}/probe`;
      const send = async (origin?: string) => {
        const response = await fetch(probe, origin === undefined ? {} : { headers: { origin } });
        expect(response.status).toBe(200);
        return response.text();
      };
      expect(await send()).toBe("http none");
      // A plain-HTTP box sees the page's own Origin as it was sent.
      expect(await send(page)).toBe(`http ${page}`);

      await close(plain);
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-subj",
          "/CN=127.0.0.1",
          "-days",
          "1",
        ].concat(["-keyout", join(keyDir, "key.pem"), "-out", join(keyDir, "cert.pem")]),
        { stdio: "ignore" },
      );
      secure = createHttpsServer(
        {
          key: readFileSync(join(keyDir, "key.pem")),
          cert: readFileSync(join(keyDir, "cert.pem")),
        },
        answer("https"),
      );
      await listen(secure, port);
      mkdirSync(tlsDir, { recursive: true });
      writeFileSync(join(tlsDir, "server.pem"), readFileSync(join(keyDir, "cert.pem")));
      expect(await send()).toBe("https none");
      expect(await send(page)).toBe(`https ${page.replace("http://", "https://")}`);
      expect(await send("http://localhost:1")).toBe("https http://localhost:1");
      expect(await send(`https://127.0.0.1:1`)).toBe("https https://127.0.0.1:1");
    } finally {
      await vite?.close();
      if (secure !== undefined) await close(secure);
      if (plain.listening) await close(plain);
      if (originalPort === undefined) delete process.env.WAITRON_HTTP_PORT;
      else process.env.WAITRON_HTTP_PORT = originalPort;
      rmSync(lateState, { recursive: true, force: true });
      rmSync(keyDir, { recursive: true, force: true });
    }
  });

  it("routes a shifted stack to its own server port and gives each app its assigned listener", async () => {
    const ports = {
      WAITRON_TILL_VITE_PORT: "5290",
      WAITRON_DASHBOARD_VITE_PORT: "5291",
      WAITRON_SETUP_VITE_PORT: "5292",
      WAITRON_HTTP_PORT: "8180",
    };
    const original = Object.fromEntries(Object.keys(ports).map((key) => [key, process.env[key]]));
    const priorStateDir = process.env.WAITRON_STATE_DIR;
    try {
      Object.assign(process.env, ports);
      process.env.WAITRON_STATE_DIR = join(stateDir, "absent");
      for (const [app, port] of [
        ["till", 5290],
        ["dashboard", 5291],
        ["setup", 5292],
      ] as const) {
        const configPath = join(REPO_ROOT, "apps", app, "vite.config.ts");
        const exported = (await import(
          `${pathToFileURL(configPath).href}?stack=shifted-${app}`
        )) as { default: UserConfigExport };
        const config = staticConfig(exported.default);
        expect(config.server?.port).toBe(port);
        expect(config.server?.strictPort).toBe(true);
        for (const proxy of Object.values(config.server?.proxy ?? {})) {
          expect(proxy).toMatchObject({ target: "http://127.0.0.1:8180" });
        }
      }
    } finally {
      if (priorStateDir === undefined) delete process.env.WAITRON_STATE_DIR;
      else process.env.WAITRON_STATE_DIR = priorStateDir;
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("refuses an invalid listener port instead of silently choosing a random one", async () => {
    const original = process.env.WAITRON_TILL_VITE_PORT;
    try {
      process.env.WAITRON_TILL_VITE_PORT = "0";
      const configPath = join(REPO_ROOT, "apps", "till", "vite.config.ts");
      await expect(import(`${pathToFileURL(configPath).href}?port=zero`)).rejects.toThrow(
        /WAITRON_TILL_VITE_PORT/,
      );
    } finally {
      if (original === undefined) delete process.env.WAITRON_TILL_VITE_PORT;
      else process.env.WAITRON_TILL_VITE_PORT = original;
    }
  });

  it("covers every proxy route in every Vite front-end", async () => {
    const frontEnds = proxyFrontEnds();
    expect(frontEnds.map(({ app }) => app).sort()).toEqual(Object.keys(EXPECTED_ROUTES).sort());

    const states: { label: string; stateDir: string; expected: ProxyOptions }[] = [
      {
        label: "http",
        stateDir: join(stateDir, "absent"),
        expected: { target: "http://127.0.0.1:8080" },
      },
      {
        label: "https",
        stateDir,
        expected: { target: "https://127.0.0.1:8080", secure: false },
      },
    ];

    for (const state of states) {
      process.env.WAITRON_STATE_DIR = state.stateDir;
      for (const { app, configPath } of frontEnds) {
        const exported = (await import(
          `${pathToFileURL(configPath).href}?protocol=${state.label}`
        )) as { default: UserConfigExport };
        const proxy = staticConfig(exported.default).server?.proxy;
        expect(Object.keys(proxy ?? {}).sort()).toEqual(EXPECTED_ROUTES[app]!.toSorted());
        for (const route of Object.values(proxy ?? {})) {
          expect(route).toMatchObject<ProxyOptions>(state.expected);
        }
      }
    }
  });
});
