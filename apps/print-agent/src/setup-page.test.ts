import type { AgentConfig, AgentSetupSnapshot, AgentStatus } from "@waitron/print-agent";
import { describe, expect, it, vi } from "vitest";
import { createSetupApp, type SetupDeps } from "./setup-page.js";

const UNCONFIGURED: AgentStatus = { phase: "unconfigured", serverUrl: null, current: null };

function snapshot(overrides: Partial<AgentSetupSnapshot> = {}): AgentSetupSnapshot {
  return {
    status: UNCONFIGURED,
    config: null,
    joined: false,
    outOfTouch: false,
    ...overrides,
  };
}

function deps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    snapshot: async () => snapshot(),
    configure: async () => true,
    beginNetworkReset: async () => true,
    cancelNetworkReset: async () => true,
    envLocked: false,
    defaultName: "kitchen-pi",
    now: () => 1_000,
    ...overrides,
  };
}

function peer(address?: string): never {
  return {
    incoming: {
      socket: {
        remoteAddress: address,
        remoteFamily: address?.includes(":") === true ? "IPv6" : "IPv4",
        remotePort: 12_345,
      },
    },
  } as never;
}

function request(
  app: ReturnType<typeof createSetupApp>,
  path: string,
  init?: RequestInit,
  address?: string,
): Promise<Response> {
  return Promise.resolve(app.request(path, init, peer(address)));
}

const RUNNING: AgentStatus = {
  phase: "running",
  serverUrl: "https://box.test",
  current: "https://box.test",
};
const CONFIG: AgentConfig = { serverUrl: "https://box.test", name: "kitchen" };

describe("createSetupApp — access states", () => {
  it.each([
    ["unjoined", false, false, "loopback", 200, "serverUrl"],
    ["unjoined", false, false, "network", 200, "serverUrl"],
    ["joined running", true, false, "loopback", 200, "Connected and printing"],
    ["joined running", true, false, "network", 403, "not available on the network"],
    ["joined before first probe", true, false, "loopback", 200, "Checking the venue connection"],
    ["joined before first probe", true, false, "network", 403, "not available on the network"],
    ["joined out of touch", true, true, "loopback", 200, "Join a new network"],
    ["joined out of touch", true, true, "network", 200, "Join a new network"],
  ])(
    "%s (joined=%s, outOfTouch=%s) from %s",
    async (label, joined, outOfTouch, source, expectedStatus, expectedText) => {
      const status = label === "joined running" ? RUNNING : UNCONFIGURED;
      const app = createSetupApp(
        deps({
          snapshot: async () =>
            snapshot({ status, config: joined ? CONFIG : null, joined, outOfTouch }),
        }),
      );
      const response = await request(
        app,
        "/",
        undefined,
        source === "loopback" ? "127.0.0.1" : "192.168.20.5",
      );
      expect(response.status).toBe(expectedStatus);
      expect(await response.text()).toContain(expectedText);
    },
  );

  it.each(["127.0.0.1", "127.2.3.4", "::1", "::ffff:127.2.3.4"])(
    "recognises %s as loopback",
    async (address) => {
      const app = createSetupApp(
        deps({
          snapshot: async () =>
            snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
        }),
      );
      expect((await request(app, "/", undefined, address)).status).toBe(200);
    },
  );

  it.each(["192.168.20.5", undefined])("fails closed for peer address %s", async (address) => {
    const app = createSetupApp(
      deps({
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
      }),
    );
    expect((await request(app, "/", undefined, address)).status).toBe(403);
  });

  it("ignores forwarding headers in both directions", async () => {
    const app = createSetupApp(
      deps({
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
      }),
    );
    expect(
      (
        await request(
          app,
          "/",
          { headers: { "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1" } },
          "192.168.20.5",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          app,
          "/",
          { headers: { "x-forwarded-for": "192.168.20.5", forwarded: "for=192.168.20.5" } },
          "127.0.0.1",
        )
      ).status,
    ).toBe(200);
  });

  it("reads a fresh setup snapshot for every request", async () => {
    const snapshots = [
      snapshot(),
      snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
    ];
    const read = vi.fn(async () => snapshots.shift()!);
    const app = createSetupApp(deps({ snapshot: read }));
    expect((await request(app, "/", undefined, "192.168.20.5")).status).toBe(200);
    expect((await request(app, "/", undefined, "192.168.20.5")).status).toBe(403);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("removes the Bluetooth card and its old routes", async () => {
    const app = createSetupApp(deps());
    const html = await (await request(app, "/", undefined, "127.0.0.1")).text();
    expect(html).not.toContain("Bluetooth printers");
    expect((await request(app, "/bluetooth/scan", { method: "POST" }, "127.0.0.1")).status).toBe(
      404,
    );
    expect((await request(app, "/bluetooth/pair", { method: "POST" }, "127.0.0.1")).status).toBe(
      404,
    );
  });
});

describe("createSetupApp — rendering", () => {
  it("renders the address form with the default name for an unconfigured agent", async () => {
    const html = await (
      await request(createSetupApp(deps()), "/", undefined, "192.168.20.5")
    ).text();
    expect(html).toContain('name="serverUrl"');
    expect(html).toContain('name="name"');
    expect(html).toContain('value="kitchen-pi"');
  });

  it("renders pending and pairing status beside the unjoined form", async () => {
    const pending: AgentStatus = {
      phase: "pending",
      serverUrl: "https://box.test",
      current: "https://box.test",
      verificationCode: "42",
    };
    const pendingHtml = await (
      await request(
        createSetupApp(
          deps({ snapshot: async () => snapshot({ status: pending, config: CONFIG }) }),
        ),
        "/",
        undefined,
        "192.168.20.5",
      )
    ).text();
    expect(pendingHtml).toContain("verification code");
    expect(pendingHtml).toContain("42");
    expect(pendingHtml).toContain('name="serverUrl"');

    const closed: AgentStatus = {
      phase: "pairing_closed",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const closedHtml = await (
      await request(
        createSetupApp(
          deps({ snapshot: async () => snapshot({ status: closed, config: CONFIG }) }),
        ),
        "/",
        undefined,
        "192.168.20.5",
      )
    ).text();
    expect(closedHtml).toContain("open Add a print agent on the Printers page");
    expect(closedHtml).toContain('name="serverUrl"');
  });

  it("keeps truthful pending and running details", async () => {
    const pending: AgentStatus = {
      phase: "pending",
      serverUrl: "https://box.test",
      current: null,
    };
    const pendingHtml = await (
      await request(
        createSetupApp(
          deps({ snapshot: async () => snapshot({ status: pending, config: CONFIG }) }),
        ),
        "/",
        undefined,
        "127.0.0.1",
      )
    ).text();
    expect(pendingHtml).toContain("Waiting for approval");
    expect(pendingHtml).not.toContain("restart to get a fresh code");
    expect(pendingHtml).not.toContain("verification code");

    const running: AgentStatus = {
      ...RUNNING,
      lastJobAt: Date.parse("2026-09-09T10:00:00Z"),
      lastError: "network_tcp printer p1 timed out",
    };
    const runningHtml = await (
      await request(
        createSetupApp(
          deps({
            snapshot: async () =>
              snapshot({ status: running, config: CONFIG, joined: true, outOfTouch: false }),
          }),
        ),
        "/",
        undefined,
        "127.0.0.1",
      )
    ).text();
    expect(runningHtml).toContain("https://box.test");
    expect(runningHtml).toContain("Last job");
    expect(runningHtml).toContain("Last error");
    expect(runningHtml).toContain("network_tcp printer p1 timed out");

    const noJobsHtml = await (
      await request(
        createSetupApp(
          deps({
            snapshot: async () =>
              snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
          }),
        ),
        "/",
        undefined,
        "127.0.0.1",
      )
    ).text();
    expect(noJobsHtml).toContain("no jobs printed yet");
    expect(noJobsHtml).not.toContain("Last error");
  });

  it("tells an unauthorized operator to save and approve again without asking for a restart", async () => {
    const unauthorized: AgentStatus = {
      phase: "unauthorized",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const html = await (
      await request(
        createSetupApp(
          deps({ snapshot: async () => snapshot({ status: unauthorized, config: CONFIG }) }),
        ),
        "/",
        undefined,
        "192.168.20.5",
      )
    ).text();
    expect(html).toContain("This agent was denied or disabled.");
    expect(html).toContain("Save the server address");
    expect(html).toContain("approve the new join");
    expect(html).not.toContain("restart");
  });

  it("escapes an unreachable error and chooses the current, saved, or generic server label", async () => {
    const render = async (status: AgentStatus): Promise<string> =>
      (
        await request(
          createSetupApp(deps({ snapshot: async () => snapshot({ status, config: CONFIG }) })),
          "/",
          undefined,
          "127.0.0.1",
        )
      ).text();
    expect(
      await render({
        phase: "unreachable",
        serverUrl: "https://saved.test",
        current: "https://live.test",
        lastError: "<script>alert(1)</script>",
      }),
    ).toContain("Can't reach https://live.test right now");
    expect(
      await render({ phase: "unreachable", serverUrl: "https://saved.test", current: null }),
    ).toContain("Can't reach https://saved.test right now");
    const generic = await render({ phase: "unreachable", serverUrl: null, current: null });
    expect(generic).toContain("Can't reach the server right now");
    expect(generic).not.toContain('class="muted"');
    const escaped = await render({
      phase: "unreachable",
      serverUrl: "https://box.test",
      current: null,
      lastError: "<script>alert(1)</script>",
    });
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).not.toContain("<script>alert(1)</script>");
  });
});

describe("createSetupApp — mutations", () => {
  const setupRequest: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "serverUrl=https%3A%2F%2Fbox.test%2Fpath&name=Barra",
  };

  it("normalises and saves setup only while unjoined", async () => {
    const configure = vi.fn(async () => true);
    const app = createSetupApp(deps({ configure }));
    const response = await request(app, "/setup", setupRequest, "192.168.20.5");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(configure).toHaveBeenCalledWith({ serverUrl: "https://box.test", name: "Barra" });
  });

  it("uses the default name and refuses invalid or file-valued fields", async () => {
    const configure = vi.fn(async () => true);
    const app = createSetupApp(deps({ configure }));
    await request(
      app,
      "/setup",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "serverUrl=https%3A%2F%2Fbox.test&name=",
      },
      "192.168.20.5",
    );
    expect(configure).toHaveBeenCalledWith({ serverUrl: "https://box.test", name: "kitchen-pi" });

    const bad = await request(
      app,
      "/setup",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "serverUrl=ftp%3A%2F%2Fbox.test&name=Barra",
      },
      "192.168.20.5",
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("That is not a valid http(s) address: ftp://box.test");

    const malformed = await request(
      app,
      "/setup",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "serverUrl=not-a-url&name=Barra",
      },
      "192.168.20.5",
    );
    expect(malformed.status).toBe(400);

    const form = new FormData();
    form.append("serverUrl", new File(["https://box.test"], "url.txt"));
    form.append("name", "Barra");
    expect(
      (await request(app, "/setup", { method: "POST", body: form }, "192.168.20.5")).status,
    ).toBe(400);
    expect(configure).toHaveBeenCalledTimes(1);

    const fileName = new FormData();
    fileName.append("serverUrl", "https://box.test");
    fileName.append("name", new File(["Barra"], "name.txt"));
    expect(
      (await request(app, "/setup", { method: "POST", body: fileName }, "192.168.20.5")).status,
    ).toBe(303);
    expect(configure).toHaveBeenLastCalledWith({
      serverUrl: "https://box.test",
      name: "kitchen-pi",
    });
  });

  it("returns 405 for an environment-locked unjoined agent and renders the address read-only", async () => {
    const configure = vi.fn(async () => true);
    const app = createSetupApp(
      deps({
        configure,
        envLocked: true,
        snapshot: async () => snapshot({ config: CONFIG }),
      }),
    );
    expect((await request(app, "/setup", setupRequest, "192.168.20.5")).status).toBe(405);
    expect(configure).not.toHaveBeenCalled();
    const html = await (await request(app, "/", undefined, "192.168.20.5")).text();
    expect(html).toContain("https://box.test");
    expect(html).not.toContain(">Save</button>");
  });

  it.each([
    ["127.0.0.1", 409],
    ["192.168.20.5", 403],
  ])("refuses joined setup from %s", async (address, expectedStatus) => {
    const configure = vi.fn(async () => true);
    const app = createSetupApp(
      deps({
        configure,
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
      }),
    );
    expect((await request(app, "/setup", setupRequest, address)).status).toBe(expectedStatus);
    expect(configure).not.toHaveBeenCalled();
  });

  it("returns 409 when approval wins the race after the setup snapshot", async () => {
    const configure = vi.fn(async () => false);
    const app = createSetupApp(deps({ configure }));
    expect((await request(app, "/setup", setupRequest, "192.168.20.5")).status).toBe(409);
    expect(configure).toHaveBeenCalledOnce();
  });

  it("offers reset only while joined and out of touch, then shows a m:ss countdown and cancel", async () => {
    const beginNetworkReset = vi.fn(async () => true);
    const state = snapshot({
      status: { ...RUNNING, phase: "unreachable" },
      config: CONFIG,
      joined: true,
      outOfTouch: true,
    });
    const app = createSetupApp(
      deps({ snapshot: async () => state, beginNetworkReset, now: () => 2_000 }),
    );
    const offered = await (await request(app, "/", undefined, "192.168.20.5")).text();
    expect(offered).toContain('action="/network/reset"');
    expect(offered).toContain("Join a new network");
    expect(offered).not.toContain('action="/network/reset/cancel"');
    expect((await request(app, "/network/reset", { method: "POST" }, "192.168.20.5")).status).toBe(
      303,
    );
    expect(beginNetworkReset).toHaveBeenCalledOnce();

    state.resetAt = 301_000;
    const countdown = await (await request(app, "/", undefined, "192.168.20.5")).text();
    expect(countdown).toContain("Resetting in 4:59");
    expect(countdown).toContain('action="/network/reset/cancel"');
    expect(countdown).not.toContain('action="/network/reset"');
  });

  it("refuses reset outside its state and reports a stale serialized precondition", async () => {
    const beginNetworkReset = vi.fn(async () => true);
    const unavailable = createSetupApp(deps({ beginNetworkReset }));
    expect(
      (await request(unavailable, "/network/reset", { method: "POST" }, "192.168.20.5")).status,
    ).toBe(409);
    expect(beginNetworkReset).not.toHaveBeenCalled();

    beginNetworkReset.mockResolvedValueOnce(false);
    const stale = createSetupApp(
      deps({
        beginNetworkReset,
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: true }),
      }),
    );
    expect(
      (await request(stale, "/network/reset", { method: "POST" }, "192.168.20.5")).status,
    ).toBe(409);
  });

  it("allows cancel only during a countdown and reports a stale serialized precondition", async () => {
    const cancelNetworkReset = vi.fn(async () => true);
    const noCountdown = createSetupApp(
      deps({
        cancelNetworkReset,
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: true }),
      }),
    );
    expect(
      (await request(noCountdown, "/network/reset/cancel", { method: "POST" }, "192.168.20.5"))
        .status,
    ).toBe(409);
    expect(cancelNetworkReset).not.toHaveBeenCalled();

    const active = createSetupApp(
      deps({
        cancelNetworkReset,
        snapshot: async () =>
          snapshot({
            status: RUNNING,
            config: CONFIG,
            joined: true,
            outOfTouch: true,
            resetAt: 301_000,
          }),
      }),
    );
    expect(
      (await request(active, "/network/reset/cancel", { method: "POST" }, "192.168.20.5")).status,
    ).toBe(303);

    cancelNetworkReset.mockResolvedValueOnce(false);
    expect(
      (await request(active, "/network/reset/cancel", { method: "POST" }, "192.168.20.5")).status,
    ).toBe(409);
  });
});

describe("createSetupApp — GET /status.json", () => {
  it("returns status without a token to loopback and refuses joined network callers", async () => {
    const app = createSetupApp(
      deps({
        snapshot: async () =>
          snapshot({ status: RUNNING, config: CONFIG, joined: true, outOfTouch: false }),
      }),
    );
    const local = await request(app, "/status.json", undefined, "127.0.0.1");
    expect(local.status).toBe(200);
    const body = (await local.json()) as Record<string, unknown>;
    expect(body).toEqual(RUNNING);
    expect(body).not.toHaveProperty("token");
    expect((await request(app, "/status.json", undefined, "192.168.20.5")).status).toBe(403);
  });

  it("adds the Bluetooth side's availability once it has been checked", async () => {
    const unavailable = {
      available: false as const,
      reason: "dbus_unreachable" as const,
      detail: 'assertion "connection != NULL" failed',
    };
    const checked: { bluetooth?: typeof unavailable } = {};
    const app = createSetupApp(deps({ bluetooth: () => checked.bluetooth }));
    expect(
      await (await request(app, "/status.json", undefined, "127.0.0.1")).json(),
    ).not.toHaveProperty("bluetooth");
    checked.bluetooth = unavailable;
    expect(await (await request(app, "/status.json", undefined, "127.0.0.1")).json()).toMatchObject(
      {
        phase: "unconfigured",
        bluetooth: unavailable,
      },
    );
  });
});
