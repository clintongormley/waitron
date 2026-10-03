import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProxyOptions, UserConfig, UserConfigExport } from "vite";

import { devServerProxy } from "./dev-server-proxy.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const originalStateDir = process.env.WAITRON_STATE_DIR;
const stateDir = mkdtempSync(join(import.meta.dirname, "dev-proxy-state-"));

const EXPECTED_ROUTES: Record<string, string[]> = {
  dashboard: ["/api", "/management-api", "/media"],
  setup: ["/setup-api"],
  till: ["/api", "/media"],
};

function staticConfig(config: UserConfigExport): UserConfig {
  expect(config).toBeTypeOf("object");
  return config as UserConfig;
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
  writeFileSync(join(stateDir, "tls", "server.crt"), "certificate");
  writeFileSync(join(stateDir, "tls", "server.key"), "key");
  process.env.WAITRON_STATE_DIR = stateDir;
});

afterAll(() => {
  if (originalStateDir === undefined) delete process.env.WAITRON_STATE_DIR;
  else process.env.WAITRON_STATE_DIR = originalStateDir;
  rmSync(stateDir, { recursive: true, force: true });
});

describe("development server proxy", () => {
  it("uses HTTP without a box leaf and accepts the self-signed HTTPS leaf when present", () => {
    expect(devServerProxy({ stateDir: join(stateDir, "absent") })).toEqual({
      target: "http://127.0.0.1:8080",
    });
    expect(devServerProxy({ stateDir })).toEqual({
      target: "https://127.0.0.1:8080",
      secure: false,
    });
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
