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
  dashboard: ["/management-api", "/media"],
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
