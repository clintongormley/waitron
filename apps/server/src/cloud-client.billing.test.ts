import { readFile, writeFile } from "node:fs/promises";
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

it("waits for the Retry-After hint of a 429 whose body is not JSON", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, reads } = await billingCloud((_v, _s, res) => {
    res.writeHead(429, { "content-type": "text/plain", "retry-after": "120" });
    res.end("Too many requests");
  });
  try {
    const start = Date.now();
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    vi.setSystemTime(start + 119_000);
    await codeOf(f.client.billing());
    expect(reads()).toBe(1);
    vi.setSystemTime(start + 120_000);
    await codeOf(f.client.billing());
    expect(reads()).toBe(2);
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

const OTHER_INSTALLATION = "99999999-9999-4999-8999-999999999999";
async function pairElsewhere(stateDir: string) {
  const file = join(stateDir, "cloud-connection.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  // A new pairing's file: another installation, and no lease or lifecycle from the old one yet.
  state.view.registration.installationId = OTHER_INSTALLATION;
  delete state.lifecycle;
  await writeFile(file, JSON.stringify(state));
}

it("reads again at once for another registration, never serving the last one's answer", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, reads } = await billingCloud((v, s, res) => send(res, 200, reply(v, s)));
  try {
    const first = await f.client.billing();
    await pairElsewhere(f.options.stateDir);
    const second = await f.client.billing();
    expect(reads()).toBe(2);
    expect([first.installationId, second.installationId]).toEqual([
      expect.not.stringMatching(OTHER_INSTALLATION),
      OTHER_INSTALLATION,
    ]);
  } finally {
    await f.close();
  }
});

it("drops an answer when the box is paired elsewhere while the read waits, and reads for the new pairing at once", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let during: (() => Promise<void>) | undefined;
  const { f, reads } = await billingCloud(async (v, s, res) => {
    const change = during;
    during = undefined;
    await change?.();
    send(res, 200, reply(v, s));
  });
  during = () => pairElsewhere(f.options.stateDir);
  try {
    expect(await codeOf(f.client.billing())).toBe("cloud.unavailable");
    expect((await f.client.billing()).installationId).toBe(OTHER_INSTALLATION);
    expect(reads()).toBe(2);
  } finally {
    await f.close();
  }
});

it("waits at most an hour, however long a 429 asks for", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { f, reads } = await billingCloud((_v, _s, res) =>
    send(res, 429, { error: "rate_limited" }, { "retry-after": "86400" }),
  );
  try {
    const start = Date.now();
    await codeOf(f.client.billing());
    vi.setSystemTime(start + 3_599_000);
    await codeOf(f.client.billing());
    expect(reads()).toBe(1);
    vi.setSystemTime(start + 3_600_000);
    await codeOf(f.client.billing());
    expect(reads()).toBe(2);
  } finally {
    await f.close();
  }
});

it("offers neither the account nor sign-up link once access is stopped", async () => {
  const { f } = await billingCloud((v, s, res) => send(res, 200, reply(v, s)));
  try {
    expect((await f.client.status()).accountUrl).toBe(`${f.options.origin}/account`);
    await f.client.revoke(async () => {});
    const status = await f.client.status();
    expect([status.installation?.state, status.accountUrl, status.signupUrl]).toEqual([
      "revoked",
      undefined,
      undefined,
    ]);
  } finally {
    await f.close();
  }
});
