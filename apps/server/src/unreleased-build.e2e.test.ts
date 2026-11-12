import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "undici";
import { childProcess, entryWorkspaces, ready } from "../test/first-fiscal-hour-entry.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { writeTradingEnv } from "./trading-config.js";
import { useBuiltServer } from "./testing/built-server.js";

const ENTRY = "src/node-entry.ts";
const fixture = entryWorkspaces();
// What `loadConfig` requires in production before the check can run.
const PRODUCTION_ENV = {
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
};

/** Bounded, so a start that serves instead of failing fails the case rather than its time limit. */
async function exitOf(child: Awaited<ReturnType<typeof childProcess>>): Promise<void> {
  await expect
    .poll(() => child.child.exitCode ?? child.child.signalCode, { timeout: 45_000 })
    .not.toBeNull();
}

async function boxSecrets(stateDir: string): Promise<Agent> {
  await ensureBoxSecrets({
    stateDir,
    hostnames: ["localhost", "waitron.local"],
    now: () => new Date(),
    listIpv4: () => ["127.0.0.1"],
  });
  return new Agent({ connect: { ca: await readFile(join(stateDir, "tls", "ca.crt")) } });
}

describe("a bundle stamped as no release", () => {
  const built = useBuiltServer([ENTRY], { releaseVersion: null });

  it("fails a production start with server.unreleased_build", async () => {
    const f = await fixture();
    const child = await childProcess(built(ENTRY), {
      ...f.env,
      ...PRODUCTION_ENV,
      WAITRON_ENV: "production",
    });
    try {
      await exitOf(child);
      expect((await readRecoveryState(f.stateDir)).lastErrorCode).toBe("server.unreleased_build");
    } finally {
      await child.stop();
    }
  });

  // First setup's live choice writes `WAITRON_ENV=production` into `trading.env` through
  // `writeTradingEnv`; the start after it reads that file, as the image's does, with no
  // `WAITRON_ENV` of its own.
  it("after first setup saved live, refuses the next start and reaches the recovery page", async () => {
    const f = await fixture();
    const env: NodeJS.ProcessEnv = { ...f.env, ...PRODUCTION_ENV };
    delete env.WAITRON_ENV;
    await writeTradingEnv(f.stateDir, {
      nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      environment: "production",
      onboardingIntent: "live",
    });
    await writeRecoveryState(f.stateDir, { ...FRESH, failures: 2 });
    const failing = await childProcess(built(ENTRY), env);
    try {
      await exitOf(failing);
    } finally {
      await failing.stop();
    }
    expect(await readRecoveryState(f.stateDir)).toMatchObject({
      level: "recovery",
      lastErrorCode: "server.unreleased_build",
    });

    const agent = await boxSecrets(f.stateDir);
    const recovering = await childProcess(built(ENTRY), env);
    try {
      await expect
        .poll(
          async () => {
            const response = await fetch(`https://127.0.0.1:${recovering.port}/`, {
              dispatcher: agent,
              signal: AbortSignal.timeout(1000),
            } as RequestInit);
            return await response.text();
          },
          { timeout: 45_000 },
        )
        .toContain("This box is running a test build.");
      const text = await (
        await fetch(`https://127.0.0.1:${recovering.port}/`, { dispatcher: agent } as RequestInit)
      ).text();
      expect(text).toContain("Install a release.");
    } finally {
      await recovering.stop();
      await agent.close();
    }
  }, 180_000);
});

describe("a bundle stamped as release 1.2.3", () => {
  const built = useBuiltServer([ENTRY], { releaseVersion: "1.2.3" });

  it("gets past the unreleased-build check in production", async () => {
    const f = await fixture();
    const agent = await boxSecrets(f.stateDir);
    const child = await childProcess(built(ENTRY), {
      ...f.env,
      ...PRODUCTION_ENV,
      WAITRON_ENV: "production",
    });
    try {
      expect(await ready(child, `https://127.0.0.1:${child.port}`, agent)).toEqual({
        claimed: false,
      });
      expect((await readRecoveryState(f.stateDir)).lastErrorCode).not.toBe(
        "server.unreleased_build",
      );
    } finally {
      await child.stop();
      await agent.close();
    }
  }, 180_000);
});
