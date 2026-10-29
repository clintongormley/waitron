import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { cloudFixture } from "../test/cloud-fixture.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

afterEach(() => {
  vi.useRealTimers();
});

const reply = (values: unknown[], saved: Record<string, unknown>) => {
  const r = (saved.view as { registration: Record<string, string> }).registration;
  return {
    version: 1,
    installationId: r.installationId,
    venueId: r.venueId,
    countryCode: "ES",
    calendarTimeZone: "Europe/Madrid",
    asOf: new Date().toISOString(),
    billing: { status: "ready", level: "hosted", state: "active", period: null },
    prices: { status: "unavailable", reason: "not_published" },
    accountUrl: `${String(values[1])}/account`,
  };
};
const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "answered";
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
};

async function billingCloud(
  answer: (
    values: unknown[],
    saved: Record<string, unknown>,
    res: ServerResponse,
  ) => Promise<void> | void,
) {
  let reads = 0;
  const f = await installationFixture(undefined, {
    billing: async (values, saved, _req, res) => {
      reads++;
      await answer(values, saved, res);
    },
  });
  await f.client.refresh();
  return { f, reads: () => reads };
}

it("sends one read a minute, shared by every caller", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, reads } = await billingCloud((v, s, res) => send(res, 200, reply(v, s)));
  try {
    const [a, b] = await Promise.all([f.client.billing(), f.client.billing()]);
    expect(a).toEqual(b);
    expect(a.billing).toEqual({ status: "ready", level: "hosted", state: "active", period: null });
    vi.setSystemTime(Date.now() + 59_000);
    await f.client.billing();
    expect(reads()).toBe(1);
    vi.setSystemTime(Date.now() + 1_000);
    await f.client.billing();
    expect(reads()).toBe(2);
  } finally {
    await f.close();
  }
});

it("shares a failed read for the same minute rather than asking again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, reads } = await billingCloud((_v, _s, res) =>
    send(res, 503, { error: "temporarily_unavailable" }),
  );
  try {
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect(reads()).toBe(1);
    vi.setSystemTime(Date.now() + 60_000);
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect(reads()).toBe(2);
  } finally {
    await f.close();
  }
});

it("waits for a 429's Retry-After hint before reading again, and one minute without a hint", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let hint: string | undefined = "120";
  const { f, reads } = await billingCloud((_v, _s, res) =>
    send(res, 429, { error: "rate_limited" }, hint ? { "retry-after": hint } : {}),
  );
  try {
    const start = Date.now();
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    vi.setSystemTime(start + 119_000);
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect(reads()).toBe(1);
    hint = undefined;
    vi.setSystemTime(start + 120_000);
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect(reads()).toBe(2);
    vi.setSystemTime(start + 180_000);
    await codeOf(f.client.billing());
    expect(reads()).toBe(3);
  } finally {
    await f.close();
  }
});

it("refuses without a connection, sending nothing", async () => {
  const f = await cloudFixture();
  try {
    const client = createCloudConnection(f.options);
    expect(await codeOf(client.billing())).toBe("cloud.not_configured");
    expect(f.requests).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("stops serving the remembered answer once access is stopped", async () => {
  const { f, reads } = await billingCloud((v, s, res) => send(res, 200, reply(v, s)));
  try {
    await f.client.billing();
    await f.client.revoke(async () => {});
    expect(await codeOf(f.client.billing())).toBe("cloud.not_configured");
    expect(reads()).toBe(1);
  } finally {
    await f.close();
  }
});

it("drops an answer for a registration that stopped while the read waited", async () => {
  const held: { stop?: () => Promise<unknown> } = {};
  const { f } = await billingCloud(async (v, s, res) => {
    await held.stop?.();
    send(res, 200, reply(v, s));
  });
  held.stop = () => f.client.revoke(async () => {});
  try {
    expect(await codeOf(f.client.billing())).toBe("cloud.not_configured");
  } finally {
    await f.close();
  }
});

it("lets one caller give up without spoiling the shared read for the others", async () => {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { f, reads } = await billingCloud(async (v, s, res) => {
    await gate;
    send(res, 200, reply(v, s));
  });
  try {
    const controller = new AbortController();
    const leaving = f.client.billing(controller.signal);
    const staying = f.client.billing();
    controller.abort();
    expect(await codeOf(leaving)).toBe("cloud.unavailable");
    release();
    expect((await staying).billing.status).toBe("ready");
    expect(await codeOf(f.client.billing())).toBe("answered");
    expect(reads()).toBe(1);
  } finally {
    await f.close();
  }
});

it("keeps no billing snapshot: a read with a live lease leaves the saved state untouched", async () => {
  const { f } = await billingCloud((v, s, res) => send(res, 200, reply(v, s)));
  try {
    const file = join(f.options.stateDir, "cloud-connection.json");
    const before = await readFile(file);
    await f.client.billing();
    expect((await readFile(file)).equals(before)).toBe(true);
  } finally {
    await f.close();
  }
});
