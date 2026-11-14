import { expect, it, onTestFinished } from "vitest";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { installationFixture } from "../test/cloud-installation-fixture.js";

async function fixture(wait: (req: IncomingMessage) => Promise<void> = async () => {}) {
  const calls: object[] = [];
  const reply: Record<string, unknown> = {
    version: 1,
    url: "",
    revision: 0,
    state: "off",
    publication: null,
  };
  const f = await installationFixture(undefined, {
    guestMenu: async (values, saved, req, res, sent) => {
      calls.push({
        action: values[2],
        path: req.url,
        body: JSON.parse(String(values[7])),
        currentLease: values[6] === JSON.stringify((saved.lifecycle as { lease: unknown }).lease),
        ...(typeof sent.body === "string" ? { text: sent.body } : {}),
      });
      await wait(req);
      res.end(JSON.stringify(reply));
    },
  });
  onTestFinished(() => f.close());
  reply.url = `https://menus.example.test/m/${(await f.client.status()).registration!.venueId}`;
  return { ...f, calls, reply };
}

it("reads hosted-menu status using its signed action and current installation lease", async () => {
  const f = await fixture();
  const { calls, reply } = f;
  await expect((async () => f.client.guestMenuStatus())()).resolves.toEqual(reply);
  expect(calls).toEqual([
    {
      action: "guest-menu-status",
      path: "/api/installations/guest-menu-status",
      body: { version: 1 },
      currentLease: true,
    },
  ]);
});

it("publishes the exact UTF-8 pages with their signed digest, byte length and expected revision", async () => {
  const f = await fixture();
  const body = JSON.stringify({ defaultLanguage: "en", pages: { en: "<p>Soup £6</p>" } });
  const digest = createHash("sha256").update(body).digest("hex");
  Object.assign(f.reply, {
    revision: 4,
    state: "current",
    publication: {
      bodySha256: digest,
      defaultLanguage: "en",
      receivedAt: "2026-11-14T05:00:00.000Z",
    },
  });
  await expect((async () => f.client.publishGuestMenu(3, body))()).resolves.toEqual(f.reply);
  expect(f.calls).toEqual([
    {
      action: "guest-menu-publish",
      path: "/api/installations/guest-menu-publish",
      body: {
        version: 1,
        expectedRevision: 3,
        bodySha256: digest,
        bodyBytes: Buffer.byteLength(body),
      },
      currentLease: true,
      text: body,
    },
  ]);
});

it("signs withdrawal and reads Cloud's blocked confirmation", async () => {
  const f = await fixture();
  f.reply.state = "blocked";
  await expect((async () => f.client.withdrawGuestMenu())()).resolves.toEqual(f.reply);
  expect(f.calls).toEqual([
    {
      action: "guest-menu-withdraw",
      path: "/api/installations/guest-menu-withdraw",
      body: { version: 1 },
      currentLease: true,
    },
  ]);
});

it("refuses a publication over two MiB in UTF-8 before sending its pages", async () => {
  const f = await fixture();
  const body = JSON.stringify({ defaultLanguage: "en", pages: { en: "€".repeat(700000) } });
  expect(body.length).toBeLessThan(2097152);
  await expect((async () => f.client.publishGuestMenu(0, body))()).rejects.toMatchObject({
    code: "cloud.request_invalid",
  });
  expect(f.calls).toEqual([]);
});

it("refuses malformed or differently addressed hosted-menu confirmations", async () => {
  const f = await fixture();
  const original = { ...f.reply };
  const publication = {
    bodySha256: "a".repeat(64),
    defaultLanguage: "en",
    receivedAt: "2026-11-14T05:00:00.000Z",
  };
  for (const patch of [
    { url: "not a URL" },
    { url: "https://menus.example.test/m/another-venue" },
    { revision: -1 },
    { state: "pending" },
    { state: ["off"] },
    { state: "current", publication: null },
    { publication },
    { state: "current", publication: { ...publication, bodySha256: "wrong" } },
    { state: "current", publication: { ...publication, defaultLanguage: "" } },
    { state: "current", publication: { ...publication, receivedAt: "not a date" } },
  ]) {
    Object.assign(f.reply, original, patch);
    await expect(f.client.guestMenuStatus(), JSON.stringify(patch)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  }
});

it("ends an in-flight status read when its caller aborts", async () => {
  let entered = () => {},
    release = () => {};
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    entered();
    await held;
  });
  const controller = new AbortController();
  try {
    const outcome = f.client.guestMenuStatus(controller.signal);
    await reached;
    controller.abort();
    await expect(outcome).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    release();
  }
}, 3000);

it("reconciles changed publications on later passes and withdraws missing publications without reviving a Cloud block", async () => {
  const f = await fixture(async () => {
    const last = f.calls.at(-1) as { action: string; body: { bodySha256: string }; text?: string };
    if (last.action === "guest-menu-publish")
      Object.assign(f.reply, {
        revision: Number(f.reply.revision) + 1,
        state: "current",
        publication: {
          bodySha256: last.body.bodySha256,
          defaultLanguage: JSON.parse(last.text!).defaultLanguage,
          receivedAt: "2026-11-14T05:00:00.000Z",
        },
      });
    if (last.action === "guest-menu-withdraw")
      Object.assign(f.reply, {
        revision: Number(f.reply.revision) + 1,
        state: "off",
        publication: null,
      });
  });
  let pages: { defaultLanguage: string; pages: Record<string, string> } | null = {
    defaultLanguage: "en",
    pages: { en: "<h1>Lunch</h1>" },
  };
  const { createGuestMenuDelivery } = await import("./cloud-guest-menu.js");
  const delivery = createGuestMenuDelivery({
    connection: f.client,
    readPages: async () => pages,
    isPrimary: () => true,
  });
  const signal = new AbortController().signal;
  expect(await delivery.status()).toEqual({ state: "pending", receivedAt: null });
  await delivery.reconcile(signal);
  expect(await delivery.status()).toEqual({
    state: "current",
    receivedAt: "2026-11-14T05:00:00.000Z",
  });
  await delivery.reconcile(signal);
  expect(
    f.calls.filter((v) => (v as { action: string }).action === "guest-menu-publish"),
  ).toHaveLength(1);
  pages = { defaultLanguage: "fr", pages: { fr: "<h1>Dinner</h1>" } };
  expect((await delivery.status()).state).toBe("pending");
  await delivery.reconcile(signal);
  expect((f.calls.at(-1) as { text: string }).text).toBe(
    '{"defaultLanguage":"fr","pages":{"fr":"<h1>Dinner</h1>"}}',
  );
  expect((await delivery.status()).state).toBe("current");
  pages = null;
  expect((await delivery.status()).state).toBe("pending");
  await delivery.reconcile(signal);
  expect((await delivery.status()).state).toBe("off");
  expect((f.calls.at(-1) as { action: string }).action).toBe("guest-menu-withdraw");
  Object.assign(f.reply, { state: "blocked", publication: null });
  pages = { defaultLanguage: "en", pages: { en: "<h1>Lunch</h1>" } };
  await delivery.reconcile(signal);
  expect((await delivery.status()).state).toBe("blocked");
  expect((f.calls.at(-1) as { action: string }).action).toBe("guest-menu-status");
});

it.each(["abort", "stepdown"] as const)(
  "does not publish if %s arrives during the status exchange",
  async (stop) => {
    const controller = new AbortController();
    let primary = true;
    const f = await fixture(async () => {
      if (stop === "abort") controller.abort();
      else primary = false;
    });
    const { createGuestMenuDelivery } = await import("./cloud-guest-menu.js");
    const delivery = createGuestMenuDelivery({
      connection: f.client,
      isPrimary: () => primary,
      readPages: async () => ({ defaultLanguage: "en", pages: { en: "<h1>Lunch</h1>" } }),
    });
    await delivery.reconcile(controller.signal).catch(() => {});
    expect(f.calls.map((v) => (v as { action: string }).action)).toEqual(["guest-menu-status"]);
  },
);

it("confirms a publish whose reply was lost on the next connected pass without resending it", async () => {
  let offline = true;
  const f = await fixture(async (req) => {
    const last = f.calls.at(-1) as { action: string; body: { bodySha256: string } };
    if (offline) {
      req.socket.destroy();
      return;
    }
    if (last.action === "guest-menu-publish") {
      Object.assign(f.reply, {
        revision: 1,
        state: "current",
        publication: {
          bodySha256: last.body.bodySha256,
          defaultLanguage: "en",
          receivedAt: "2026-11-14T05:00:00.000Z",
        },
      });
      req.socket.destroy();
    }
  });
  const { createGuestMenuDelivery } = await import("./cloud-guest-menu.js");
  const delivery = createGuestMenuDelivery({
    connection: f.client,
    isPrimary: () => true,
    readPages: async () => ({ defaultLanguage: "en", pages: { en: "<h1>Lunch</h1>" } }),
  });
  const signal = new AbortController().signal;
  await expect(delivery.reconcile(signal)).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect((await delivery.status()).state).toBe("pending");
  offline = false;
  await expect(delivery.reconcile(signal)).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect((await delivery.status()).state).toBe("pending");
  await delivery.reconcile(signal);
  expect((await delivery.status()).state).toBe("current");
  expect(f.calls.map((v) => (v as { action: string }).action)).toEqual([
    "guest-menu-status",
    "guest-menu-status",
    "guest-menu-publish",
    "guest-menu-status",
  ]);
  expect((await f.client.status()).installation?.state).toBe("active");
});
