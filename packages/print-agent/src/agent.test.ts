import { describe, expect, it, vi } from "vitest";
import {
  createAgent,
  PAGE_RENEW_INTERVAL_MS,
  PAGE_RENEW_SETTLE_MS,
  PAGE_REPORT_GIVE_UP_MS,
} from "./agent.js";
import type {
  AgentClient,
  AgentInventory,
  BluetoothCommand,
  Failure,
  JoinStatus,
  NodeProbe,
  PageHold,
  PageJob,
  PageJobOutcome,
  PullReply,
  Result,
  WireJob,
} from "./client.js";
import type { DiscoveredDevice, Host, PagePrintOutcome } from "./host.js";
import { fakeHost } from "./testing/fake-host.js";
import { FakeSink, type PrinterTarget } from "./transport.js";

const A = "http://a.test";
const CONFIG = { serverUrl: A, name: "kitchen-pi" };
const primary: NodeProbe = {
  nodeId: "n1",
  term: 1,
  acceptingSales: true,
  environment: "preproduction",
};
const okR = <T>(value: T): Result<T> => ({ ok: true, value });
// `Result<never>` so a bare `failR({ ... })` is assignable to any method's `Result<T>` without the
// call site restating T — the failure branch carries no value, so `never` is the honest element type.
const failR = (failure: Failure): Result<never> => ({ ok: false, failure });

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Answers renewals in turn (then success) and never answers past `limit`, so a renewal loop that
 * does not stop fails its case instead of exhausting the heap. */
function renewer(answers: Result<void>[] = [], limit = 10) {
  let calls = 0;
  return vi.fn(async (): Promise<Result<void>> => {
    calls += 1;
    if (calls > limit) return new Promise<never>(() => {});
    return answers[calls - 1] ?? okR(undefined);
  });
}

/** A scripted client; each method is a vi.fn you override per test. Defaults walk the happy path:
 * probe → join → approved → empty pull. */
function client(over: Partial<AgentClient> = {}): AgentClient {
  return {
    probeNode: vi.fn(async () => okR(primary)),
    join: vi.fn(async () => okR({ token: "a1.s", verificationNumber: "07" })),
    // Default = refused: the happy path is the manual knock, so only a box that opts in self-enrols.
    // A device (till/mirror) has nothing that self-enrols it, so the loop falls through to join.
    enrolSelf: vi.fn(async () => failR({ kind: "refused" })),
    joinStatus: vi.fn(async () => okR<JoinStatus>("approved")),
    pullJobs: vi.fn(async () =>
      okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
    ),
    report: vi.fn(async () => okR(undefined)),
    claimPageJob: vi.fn(async () => okR<PageJob | null>(null)),
    fetchPageDocument: vi.fn(async () => okR(new Uint8Array([0x25, 0x50]))),
    renewPageJob: renewer(),
    reportPageJob: vi.fn(async () => okR(undefined)),
    ...over,
  };
}

describe("createAgent — phases", () => {
  it("reports the machine hostname independently of the agent display name", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    Object.assign(host, { hostname: () => "printer-box.local" });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.pullJobs).toHaveBeenCalledWith(A, "a1.s", {
      visible: [],
      scanned: [],
      pairedBluetooth: [],
      bluetoothOutcomes: [],
      host: "printer-box.local",
    });
  });

  it.each(["http://192.168.10.40:9210", null])(
    "reports the host's setup URL, including clearing one that is unavailable (%s)",
    async (setupUrl) => {
      const host = fakeHost({ config: CONFIG, token: "a1.s" });
      Object.assign(host, { setupUrl: () => setupUrl, setupPort: () => 9210 });
      const c = client();
      await createAgent({ host, client: c }).runOnce();
      expect(c.pullJobs).toHaveBeenCalledWith(A, "a1.s", {
        visible: [],
        scanned: [],
        pairedBluetooth: [],
        bluetoothOutcomes: [],
        setupUrl,
        setupPort: 9210,
      });
    },
  );

  it.each([false, true])(
    "tells the server whether the host can print over Bluetooth (%s)",
    async (bluetoothPrinting) => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        bluetoothPrinting: () => bluetoothPrinting,
      });
      const c = client();
      await createAgent({ host, client: c }).runOnce();
      expect(c.pullJobs).toHaveBeenCalledWith(A, "a1.s", {
        visible: [],
        scanned: [],
        pairedBluetooth: [],
        bluetoothOutcomes: [],
        bluetoothPrinting,
      });
    },
  );

  it("unconfigured: reports the phase and probes nothing", async () => {
    const host = fakeHost({ config: null });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unconfigured");
    expect(c.probeNode).not.toHaveBeenCalled();
  });

  it("no token: joins, saves the token, reports pending with the number, does NOT poll status yet", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
    expect(await host.token()).toBe("a1.s");
    expect(host.statuses.at(-1)).toMatchObject({
      phase: "pending",
      verificationCode: "07",
      current: A,
    });
    expect(c.joinStatus).not.toHaveBeenCalled();
    expect(c.pullJobs).not.toHaveBeenCalled();
  });

  it("join refused because the window is shut → pairing_closed, token stays null, retries next tick", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ join: vi.fn(async () => failR({ kind: "pairing_closed" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("pairing_closed");
    expect(await host.token()).toBeNull();
    await agent.runOnce();
    expect(c.join).toHaveBeenCalledTimes(2); // no halt — it keeps asking
  });

  it("join fails for another reason → unreachable with that reason, token stays null", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ join: vi.fn(async () => failR({ kind: "rate_limited" })) });
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)).toMatchObject({
      phase: "unreachable",
      current: A,
      lastError: "rate_limited",
    });
    expect(await host.token()).toBeNull();
  });

  it("join status cannot be read → unreachable with the failure detail, token kept, no pull", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      joinStatus: vi.fn(async () => failR({ kind: "unreachable", detail: "status 503" })),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)).toMatchObject({
      phase: "unreachable",
      current: A,
      lastError: "unreachable: status 503",
    });
    expect(await host.token()).toBe("a1.s");
    expect(c.pullJobs).not.toHaveBeenCalled();
  });

  it("have token, status pending → phase pending, no pull", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("pending")) });
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("pending");
    expect(c.pullJobs).not.toHaveBeenCalled();
    expect(await host.token()).toBe("a1.s");
  });

  it("have token, status not_approved (denied) → clears token, unauthorized, halts", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("not_approved")) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(host.statuses.at(-1)?.phase).toBe("unauthorized");
    await agent.runOnce();
    await agent.runOnce();
    expect(c.join).not.toHaveBeenCalled(); // halted: no re-join without a restart
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
  });

  it("a denial drops the persisted verification number so a restart shows no stale code", async () => {
    const pinned = { ...CONFIG, environment: "preproduction" };
    const host = fakeHost({
      config: { ...pinned, pendingVerificationNumber: "07" },
      token: "a1.s",
    });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("not_approved")) });
    await createAgent({ host, client: c }).runOnce();
    expect((await host.config())?.pendingVerificationNumber).toBeUndefined();
    expect(await host.config()).toEqual(pinned);
    expect(host.statuses.at(-1)).toMatchObject({
      phase: "unauthorized",
      verificationCode: undefined,
    });
  });

  it("status approved → pulls this same tick and reports running", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
    expect(c.pullJobs).toHaveBeenCalledTimes(1);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });

  it("once approved, later ticks pull WITHOUT polling status again", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client();
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect(c.joinStatus).toHaveBeenCalledTimes(1);
    expect(c.pullJobs).toHaveBeenCalledTimes(2);
  });

  it("fixes the environment into the saved config on the first successful probe", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    await createAgent({ host, client: client() }).runOnce();
    expect((await host.config())?.environment).toBe("preproduction");
  });

  it("never sends to a server whose environment differs from the agent's pin (CLAUDE.md §5)", async () => {
    const host = fakeHost({
      config: { serverUrl: A, name: "kitchen-pi", environment: "production" },
    });
    const c = client({
      probeNode: vi.fn(async () =>
        okR<NodeProbe>({
          nodeId: "n1",
          term: 1,
          acceptingSales: true,
          environment: "preproduction",
        }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).not.toHaveBeenCalled();
    expect(c.joinStatus).not.toHaveBeenCalled();
    expect(c.pullJobs).not.toHaveBeenCalled();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
  });

  it("does send to a server reporting the agent's own environment (positive control)", async () => {
    const host = fakeHost({
      config: { serverUrl: A, name: "kitchen-pi", environment: "production" },
    });
    const c = client({
      probeNode: vi.fn(async () =>
        okR<NodeProbe>({ nodeId: "n1", term: 1, acceptingSales: true, environment: "production" }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
  });

  it("no in-environment primary names the pinned environment, or `unknown` before one is pinned", async () => {
    const pinned = fakeHost({ config: { ...CONFIG, environment: "production" } });
    await createAgent({ host: pinned, client: client() }).runOnce();
    expect(pinned.statuses.at(-1)).toMatchObject({
      phase: "unreachable",
      lastError: "no accepting primary in environment production",
    });

    const unpinned = fakeHost({ config: CONFIG });
    const c = client({
      probeNode: vi.fn(async () => failR({ kind: "unreachable", detail: "ECONNREFUSED" })),
    });
    await createAgent({ host: unpinned, client: c }).runOnce();
    expect(unpinned.statuses.at(-1)).toMatchObject({
      phase: "unreachable",
      current: A,
      lastError: "no accepting primary in environment unknown",
    });
    expect(c.join).not.toHaveBeenCalled();
  });

  it("without an injected client, talks to the server through the host's fetch", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === `${A}/api/node`) {
        return new Response(JSON.stringify(primary), { status: 200 });
      }
      if (String(url) === `${A}/print-api/agent/join`) {
        return new Response(JSON.stringify({ token: "a1.s", verificationNumber: "42" }), {
          status: 201,
        });
      }
      throw new Error("ECONNREFUSED");
    });
    const host = fakeHost({ config: CONFIG, fetch: fetchImpl as unknown as typeof fetch });
    await createAgent({ host }).runOnce();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1/api/node/enrol-self",
      `${A}/api/node`,
      `${A}/print-api/agent/join`,
    ]);
    expect(host.statuses.at(-1)).toMatchObject({ phase: "pending", verificationCode: "42" });
    expect(await host.token()).toBe("a1.s");
  });

  it("persists the verification number so a restart while pending can still show it", async () => {
    const host = fakeHost({ config: CONFIG });
    await createAgent({ host, client: client() }).runOnce(); // joins, saves token + number
    expect((await host.config())?.pendingVerificationNumber).toBe("07");
    // Simulate a restart: a fresh agent over the SAME persisted config + token, status still pending.
    const c2 = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("pending")) });
    await createAgent({ host, client: c2 }).runOnce();
    expect(c2.join).not.toHaveBeenCalled(); // re-uses the saved token, no fresh join
    expect(host.statuses.at(-1)).toMatchObject({ phase: "pending", verificationCode: "07" });
  });

  it("persists the pending number before the token", async () => {
    const host = fakeHost({ config: { ...CONFIG, environment: "preproduction" } });
    const writes: Array<["config", string | undefined] | ["token", string | null]> = [];
    const saveConfig = host.saveConfig.bind(host);
    const saveToken = host.saveToken.bind(host);
    host.saveConfig = async (config) => {
      writes.push(["config", config.pendingVerificationNumber]);
      await saveConfig(config);
    };
    host.saveToken = async (token) => {
      writes.push(["token", token]);
      await saveToken(token);
    };

    await createAgent({ host, client: client() }).runOnce();

    expect(writes).toEqual([
      ["config", "07"],
      ["token", "a1.s"],
    ]);
  });

  it("overwrites a stale pending number when a crash left config without a token", async () => {
    const host = fakeHost({
      config: {
        ...CONFIG,
        environment: "preproduction",
        pendingVerificationNumber: "99",
      },
      token: null,
    });
    await createAgent({ host, client: client() }).runOnce();
    expect(await host.config()).toMatchObject({ pendingVerificationNumber: "07" });
    expect(await host.token()).toBe("a1.s");
  });

  it("keeps a token with a pending number in the approval flow after a restart", async () => {
    const host = fakeHost({
      config: { ...CONFIG, pendingVerificationNumber: "07" },
      token: "a1.s",
    });
    const c = client({ joinStatus: vi.fn(async () => okR<JoinStatus>("pending")) });
    await createAgent({ host, client: c }).runOnce();
    expect(c.joinStatus).toHaveBeenCalledWith(A, "a1.s");
    expect(c.pullJobs).not.toHaveBeenCalled();
    expect(host.statuses.at(-1)).toMatchObject({ phase: "pending", verificationCode: "07" });
  });

  it("clears the persisted verification number once approved", async () => {
    const host = fakeHost({ config: CONFIG });
    await createAgent({ host, client: client() }).runOnce(); // join → number persisted
    expect((await host.config())?.pendingVerificationNumber).toBe("07");
    await createAgent({ host, client: client() }).runOnce(); // token present, approved → clears
    expect((await host.config())?.pendingVerificationNumber).toBeUndefined();
  });

  it("pull unreachable → phase unreachable, token kept, no halt", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unreachable", detail: "x" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
    expect(await host.token()).toBe("a1.s");
    await agent.runOnce();
    expect(c.pullJobs).toHaveBeenCalledTimes(2);
  });

  it("pull unauthorized (revoked after approval) → clears token, unauthorized, halts", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unauthorized" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(host.statuses.at(-1)?.phase).toBe("unauthorized");
    await agent.runOnce();
    expect(c.pullJobs).toHaveBeenCalledTimes(1); // halted
  });

  it("running: merges the reply's servers into the router", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({
          nodeId: "n1",
          servers: [{ url: "http://b.test", nodeId: "n2" }],
          jobs: [],
          discoveryUntil: null,
        }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect((c.probeNode as ReturnType<typeof vi.fn>).mock.calls.map((x) => x[0])).toContain(
      "http://b.test",
    );
  });

  it("persists reply servers and probes them after a restart", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const first = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({
          nodeId: "n1",
          servers: [{ url: "http://b.test", nodeId: "n2" }],
          jobs: [],
          discoveryUntil: null,
        }),
      ),
    });
    await createAgent({ host, client: first }).runOnce();
    expect(await host.config()).toMatchObject({
      servers: [{ url: "http://b.test", nodeId: "n2" }],
    });

    const second = client();
    await createAgent({ host, client: second }).runOnce();
    expect((second.probeNode as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)).toEqual([
      A,
      "http://b.test",
    ]);
  });

  it("never sends its token to a remembered server in another environment", async () => {
    const host = fakeHost({
      config: {
        ...CONFIG,
        environment: "preproduction",
        servers: [{ url: "http://b.test", nodeId: "n2" }],
      },
      token: "a1.s",
    });
    const c = client({
      probeNode: vi.fn(async (url: string) =>
        okR<NodeProbe>({
          nodeId: url === A ? "n1" : "n2",
          term: url === A ? 1 : 2,
          acceptingSales: url !== A,
          environment: url === A ? "preproduction" : "production",
        }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.pullJobs).not.toHaveBeenCalledWith("http://b.test", "a1.s", expect.anything());
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
  });
});

describe("createAgent — setup controls", () => {
  it("reconfigures a denied agent, wakes its held sleep, and joins again without a restart", async () => {
    const sleepStarted = deferred();
    const joinStarted = deferred();
    const host = fakeHost({
      config: {
        ...CONFIG,
        environment: "preproduction",
        pendingVerificationNumber: "07",
        servers: [{ url: "http://b.test", nodeId: "n2" }],
      },
      token: "a1.s",
      sleep: async () => {
        sleepStarted.resolve();
        await new Promise(() => {});
      },
    });
    const c = client({
      joinStatus: vi.fn(async () => okR<JoinStatus>("not_approved")),
      join: vi.fn(async () => {
        joinStarted.resolve();
        return okR({ token: "a2.s", verificationNumber: "42" });
      }),
    });
    const savedConfigs: unknown[] = [];
    const saveConfig = host.saveConfig.bind(host);
    host.saveConfig = async (config) => {
      savedConfigs.push(config);
      await saveConfig(config);
    };
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(await host.token()).toBeNull();

    const running = agent.start();
    await sleepStarted.promise;
    await expect(
      agent.configure({ serverUrl: "http://new.test", name: "bar-printer" }),
    ).resolves.toBe(true);
    await joinStarted.promise;
    agent.stop();
    await running;

    expect(await host.config()).toEqual({
      serverUrl: "http://new.test",
      name: "bar-printer",
      environment: "preproduction",
      pendingVerificationNumber: "42",
    });
    expect(await host.token()).toBe("a2.s");
    expect(savedConfigs).toContainEqual({ serverUrl: "http://new.test", name: "bar-printer" });
  });

  it("refuses a queued configure after the in-flight tick approves the token", async () => {
    const pullStarted = deferred();
    const pullReply = deferred<Result<PullReply>>();
    const host = fakeHost({
      config: { ...CONFIG, pendingVerificationNumber: "07" },
      token: "a1.s",
    });
    const c = client({
      pullJobs: vi.fn(async () => {
        pullStarted.resolve();
        return pullReply.promise;
      }),
    });
    const agent = createAgent({ host, client: c });
    expect((await agent.setupSnapshot()).joined).toBe(false);

    const tick = agent.runOnce();
    await pullStarted.promise;
    const configure = agent.configure({ serverUrl: "http://attacker.test", name: "changed" });
    pullReply.resolve(
      okR({ nodeId: "n1", servers: [{ url: "http://b.test" }], jobs: [], discoveryUntil: null }),
    );
    await tick;
    await expect(configure).resolves.toBe(false);

    expect(await host.token()).toBe("a1.s");
    expect(await host.config()).toEqual({
      ...CONFIG,
      environment: "preproduction",
      servers: [{ url: "http://b.test" }],
    });
  });

  it("serves a setup snapshot without waiting for an in-flight pull", async () => {
    const pullStarted = deferred();
    const pullReply = deferred<Result<PullReply>>();
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const agent = createAgent({
      host,
      client: client({
        pullJobs: vi.fn(async () => {
          pullStarted.resolve();
          return pullReply.promise;
        }),
      }),
    });
    const tick = agent.runOnce();
    await pullStarted.promise;
    try {
      const served = await Promise.race([
        agent.setupSnapshot(),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(served).not.toBe("blocked");
      expect(served).toMatchObject({ joined: true });
    } finally {
      pullReply.resolve(okR({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }));
      await tick;
    }
  });

  it("starts one five-minute reset window only for an approved out-of-touch agent", async () => {
    let now = 1_000;
    const host = fakeHost({
      config: { ...CONFIG, environment: "preproduction" },
      token: "a1.s",
      now: () => now,
    });
    const c = client({
      probeNode: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect((await agent.setupSnapshot()).outOfTouch).toBe(true);
    await expect(agent.beginNetworkReset()).resolves.toBe(true);
    expect((await agent.setupSnapshot()).resetAt).toBe(301_000);
    expect(await host.token()).toBe("a1.s");

    now = 2_000;
    await expect(agent.beginNetworkReset()).resolves.toBe(true);
    expect((await agent.setupSnapshot()).resetAt).toBe(301_000);
  });

  it("wakes a sleeping loop to retry the venue when a network reset starts", async () => {
    const sleepStarted = deferred();
    const retried = deferred();
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      sleep: async () => {
        sleepStarted.resolve();
        await new Promise(() => {});
      },
    });
    let probeCalls = 0;
    const probeNode = vi.fn(async () => {
      probeCalls += 1;
      if (probeCalls === 3) {
        retried.resolve();
        agent.stop();
      }
      return failR({ kind: "unreachable", detail: "offline" });
    });
    const agent = createAgent({ host, client: client({ probeNode }) });

    await agent.runOnce();
    const running = agent.start();
    await sleepStarted.promise;
    try {
      await expect(agent.beginNetworkReset()).resolves.toBe(true);
      const result = await Promise.race([
        retried.promise.then(() => "retried" as const),
        new Promise<"sleeping">((resolve) => setTimeout(() => resolve("sleeping"), 100)),
      ]);
      expect(result).toBe("retried");
    } finally {
      agent.stop();
      await running;
    }

    expect(probeNode).toHaveBeenCalledTimes(3);
  });

  it("marks only loss of a primary or an authenticated pull failure as out of touch", async () => {
    const initial = createAgent({
      host: fakeHost({ config: CONFIG, token: "a1.s" }),
      client: client(),
    });
    expect((await initial.setupSnapshot()).outOfTouch).toBe(false);

    const noPrimaryHost = fakeHost({ config: CONFIG, token: "a1.s" });
    const noPrimary = createAgent({
      host: noPrimaryHost,
      client: client({
        probeNode: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
      }),
    });
    await noPrimary.runOnce();
    expect((await noPrimary.setupSnapshot()).outOfTouch).toBe(true);

    const pullFailure = createAgent({
      host: fakeHost({ config: CONFIG, token: "a1.s" }),
      client: client({
        pullJobs: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
      }),
    });
    await pullFailure.runOnce();
    expect((await pullFailure.setupSnapshot()).outOfTouch).toBe(true);

    const inventoryFailure = createAgent({
      host: fakeHost({
        config: CONFIG,
        token: "a1.s",
        visibleDevices: async () => {
          throw new Error("usb inventory failed");
        },
      }),
      client: client(),
    });
    await inventoryFailure.runOnce();
    expect((await inventoryFailure.setupSnapshot()).outOfTouch).toBe(false);

    const statusFailure = createAgent({
      host: fakeHost({
        config: { ...CONFIG, pendingVerificationNumber: "07" },
        token: "a1.s",
      }),
      client: client({
        joinStatus: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
      }),
    });
    await statusFailure.runOnce();
    expect((await statusFailure.setupSnapshot()).outOfTouch).toBe(false);
  });

  it("calls off a pending reset after a successful pull", async () => {
    let fail = true;
    let now = 1_000;
    const host = fakeHost({ config: CONFIG, token: "a1.s", now: () => now });
    const c = client({
      pullJobs: vi.fn(async () =>
        fail
          ? failR({ kind: "unreachable", detail: "offline" })
          : okR({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.beginNetworkReset();
    expect((await agent.setupSnapshot()).resetAt).toBe(301_000);

    fail = false;
    now = 2_000;
    await agent.runOnce();
    expect(await agent.setupSnapshot()).toMatchObject({ outOfTouch: false });
    expect((await agent.setupSnapshot()).resetAt).toBeUndefined();
    expect(await host.token()).toBe("a1.s");
  });

  it("cancels a reset without changing persisted join state", async () => {
    const config = { ...CONFIG, environment: "preproduction" };
    const host = fakeHost({ config, token: "a1.s" });
    const agent = createAgent({
      host,
      client: client({
        probeNode: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
      }),
    });
    await agent.runOnce();
    await agent.beginNetworkReset();
    await expect(agent.cancelNetworkReset()).resolves.toBe(true);
    expect((await agent.setupSnapshot()).resetAt).toBeUndefined();
    expect(await host.config()).toEqual(config);
    expect(await host.token()).toBe("a1.s");
  });

  it("refuses a queued cancel after a successful pull already called the reset off", async () => {
    const pullStarted = deferred();
    const pullReply = deferred<Result<PullReply>>();
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      pullJobs: vi
        .fn()
        .mockResolvedValueOnce(failR({ kind: "unreachable", detail: "offline" }))
        .mockImplementationOnce(async () => {
          pullStarted.resolve();
          return pullReply.promise;
        }),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.beginNetworkReset();
    const tick = agent.runOnce();
    await pullStarted.promise;
    const cancel = agent.cancelNetworkReset();
    pullReply.resolve(okR({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }));
    await tick;
    await expect(cancel).resolves.toBe(false);
    expect((await agent.setupSnapshot()).resetAt).toBeUndefined();
  });

  it("expires the reset, retains the configured identity and environment, then joins again", async () => {
    let now = 1_000;
    const host = fakeHost({
      config: {
        ...CONFIG,
        environment: "preproduction",
        servers: [{ url: "http://b.test", nodeId: "n2" }],
      },
      token: "a1.s",
      now: () => now,
    });
    const c = client({
      pullJobs: vi.fn(async () => failR({ kind: "unreachable", detail: "offline" })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.beginNetworkReset();
    now = 301_000;
    await agent.runOnce();
    expect(await host.token()).toBeNull();
    expect(await host.config()).toEqual({
      ...CONFIG,
      environment: "preproduction",
      servers: undefined,
    });
    expect(await agent.setupSnapshot()).toMatchObject({ joined: false, outOfTouch: false });

    await agent.runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
  });

  it.each([
    [null, null, false],
    [CONFIG, null, false],
    [{ ...CONFIG, pendingVerificationNumber: "07" }, "a1.s", false],
    [CONFIG, "a1.s", true],
  ] as const)("derives joined from token and pending state %#", async (config, token, joined) => {
    const agent = createAgent({ host: fakeHost({ config, token }), client: client() });
    expect((await agent.setupSnapshot()).joined).toBe(joined);
  });
});

describe("createAgent — on-node self-enrol", () => {
  it("on the primary box: self-enrol succeeds → token stored, no knock", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ enrolSelf: vi.fn(async () => okR({ token: "id.secret" })) });
    await createAgent({ host, client: c }).runOnce();
    expect(await host.token()).toBe("id.secret");
    expect(c.join).not.toHaveBeenCalled(); // never falls through to the manual path
  });

  it("on a device: self-enrol refused → falls through to the existing knock", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ enrolSelf: vi.fn(async () => failR({ kind: "refused" })) });
    await createAgent({ host, client: c }).runOnce();
    expect(c.join).toHaveBeenCalledWith(A, "kitchen-pi");
  });

  it("self-enrol runs even when the configured server reports no accepting primary", async () => {
    // The probe reports no accepting primary AND is never reached, yet the token is stored.
    const host = fakeHost({ config: CONFIG });
    const c = client({
      probeNode: vi.fn(async () =>
        okR<NodeProbe>({
          nodeId: "n1",
          term: 1,
          acceptingSales: false,
          environment: "preproduction",
        }),
      ),
      enrolSelf: vi.fn(async () => okR({ token: "id.secret" })),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(await host.token()).toBe("id.secret");
    expect(c.probeNode).not.toHaveBeenCalled(); // short-circuited before the probe round
  });

  it("self-enrol targets a LITERAL 127.0.0.1 origin, not the configured (non-loopback) host", async () => {
    const host = fakeHost({
      config: { serverUrl: "https://primary.lan:8443", name: "kitchen-pi" },
    });
    let seen = "";
    const c = client({
      enrolSelf: vi.fn(async (url: string) => {
        seen = url;
        return failR({ kind: "refused" });
      }),
    });
    await createAgent({ host, client: c }).runOnce();
    const u = new URL(seen);
    expect(u.hostname).toBe("127.0.0.1"); // hostname forced to loopback
    expect(u.port).toBe("8443"); // port preserved
    expect(u.protocol).toBe("https:"); // protocol preserved
  });

  it("once self-enrolled, the next tick pulls with the stored token WITHOUT polling join status", async () => {
    const host = fakeHost({ config: CONFIG });
    const c = client({ enrolSelf: vi.fn(async () => okR({ token: "id.secret" })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce(); // self-enrols, stores the token, returns
    await agent.runOnce(); // token now non-null → skips self-enrol, goes straight to the pull
    expect(c.enrolSelf).toHaveBeenCalledTimes(1); // second tick had a token, so it did not self-enrol
    expect(c.joinStatus).not.toHaveBeenCalled(); // `approved` was set, so no status poll
    expect(c.pullJobs).toHaveBeenCalledTimes(1);
  });
});

describe("createAgent — push and report", () => {
  const job = (id: string) => ({
    id,
    printerId: "p1",
    transport: "network_tcp" as const,
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    payload: new Uint8Array([7, 7]),
  });

  it("sends each job's bytes through the transport, in order, and reports done", async () => {
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport: sink });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({
          nodeId: "n1",
          servers: [],
          jobs: [job("j1"), job("j2")],
          discoveryUntil: null,
        }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(sink.written.map((w) => w.printerId)).toEqual(["p1", "p1"]);
    expect(sink.written[0]!.bytes).toEqual(new Uint8Array([7, 7]));
    expect(c.report).toHaveBeenNthCalledWith(1, A, "a1.s", "j1", { status: "done" });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "a1.s", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastJobAt).toBeTypeOf("number");
  });

  it("a failed send reports failed with the error text and keeps going", async () => {
    const transport = {
      send: vi.fn().mockRejectedValueOnce(new Error("no route")).mockResolvedValueOnce(undefined),
    };
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({
          nodeId: "n1",
          servers: [],
          jobs: [job("j1"), job("j2")],
          discoveryUntil: null,
        }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenNthCalledWith(1, A, "a1.s", "j1", {
      status: "failed",
      error: "no route",
    });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "a1.s", "j2", { status: "done" });
    expect(host.statuses.at(-1)?.lastError).toBe("no route");
  });

  it("a failed send's error is cleared once a later fully clean tick runs", async () => {
    const transport = {
      send: vi.fn().mockRejectedValueOnce(new Error("no route")).mockResolvedValue(undefined),
    };
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport });
    const pulls = vi
      .fn()
      .mockResolvedValueOnce(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")], discoveryUntil: null }),
      )
      .mockResolvedValue(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
      );
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.lastError).toBe("no route"); // failed send stays visible
    await agent.runOnce();
    expect(host.statuses.at(-1)?.lastError).toBeUndefined(); // clean tick clears it
  });

  it("a send that rejects with a non-Error reports that value as the error text", async () => {
    const transport = { send: vi.fn().mockRejectedValue("printer offline") };
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")], discoveryUntil: null }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenCalledWith(A, "a1.s", "j1", {
      status: "failed",
      error: "printer offline",
    });
    expect(host.statuses.at(-1)?.lastError).toBe("printer offline");
  });

  it("a report that cannot be delivered is logged and dropped (the lease reclaims)", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")], discoveryUntil: null }),
      ),
      report: vi.fn(async () => failR({ kind: "unreachable", detail: "gone" })),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenCalledTimes(1);
    expect(host.logs.some((l) => l.includes("report") && l.includes("j1"))).toBe(true);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });
});

describe("createAgent — inventory, discovery and resolve", () => {
  const usbJob = (id: string) => ({
    id,
    printerId: "p1",
    transport: "usb" as const,
    host: null,
    port: null,
    localKey: "SN-1",
    payload: new Uint8Array([1]),
  });
  const inventoryOf = (c: AgentClient, tick: number) =>
    (c.pullJobs as ReturnType<typeof vi.fn>).mock.calls[tick]![2] as {
      visible: unknown[];
      scanned: unknown[];
    };

  it.each([0, 100_000, -100_000])(
    "probes explicit addresses independently of a failed scan and stops at expiry (clock offset %s ms)",
    async (offset) => {
      const target = { host: "192.168.20.247", port: 9100, expiresInMs: 29000 };
      const found = { transport: "network_tcp" as const, host: target.host, port: target.port };
      const probeNetwork = vi.fn().mockResolvedValue([found]);
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        probeNetwork,
        scan: async () => {
          throw new Error("no Bluetooth");
        },
      });
      let now = 1000 + offset;
      host.now = () => now;
      const c = client({
        pullJobs: vi.fn().mockResolvedValue(
          okR({
            nodeId: "n1",
            servers: [],
            jobs: [],
            discoveryUntil: 90000,
            networkProbes: [target],
          }),
        ),
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      expect(probeNetwork).not.toHaveBeenCalled();
      vi.mocked(c.pullJobs).mockResolvedValue(failR({ kind: "unreachable", detail: "offline" }));
      await agent.runOnce();
      expect(agent.status.phase).toBe("unreachable");
      expect(probeNetwork).toHaveBeenCalledWith([target]);
      expect(inventoryOf(c, 1).scanned).toEqual([found]);
      now = 30000 + offset;
      await agent.runOnce();
      expect(probeNetwork).toHaveBeenCalledTimes(1);
      expect(inventoryOf(c, 2).scanned).toEqual([]);
    },
  );

  it("does not carry a server's address checks to a different primary", async () => {
    const B = "http://b.test";
    const target = { host: "192.168.20.247", port: 9100, expiresInMs: 30000 };
    const found = { transport: "network_tcp" as const, host: target.host, port: target.port };
    const probeNetwork = vi.fn().mockResolvedValue([found]);
    const host = fakeHost({ config: CONFIG, token: "a1.s", probeNetwork });
    let promoted = false;
    const c = client({
      probeNode: vi.fn(async (url) =>
        okR({
          ...primary,
          nodeId: url === B ? "n2" : "n1",
          term: promoted ? 2 : 1,
          acceptingSales: promoted ? url === B : url === A,
        }),
      ),
      pullJobs: vi.fn().mockResolvedValue(
        okR({
          nodeId: "n1",
          servers: [{ url: B, nodeId: "n2" }],
          jobs: [],
          discoveryUntil: null,
          networkProbes: [target],
        }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect(probeNetwork).toHaveBeenCalledWith([target]);
    expect(inventoryOf(c, 1).scanned).toEqual([found]);
    probeNetwork.mockClear();
    promoted = true;
    await agent.runOnce();
    expect(agent.status.current).toBe(B);
    expect(probeNetwork).not.toHaveBeenCalled();
    expect(c.pullJobs).toHaveBeenLastCalledWith(
      B,
      "a1.s",
      expect.objectContaining({ scanned: [] }),
    );
  });

  it("a rejected address probe does not block pulling and delivering a print job", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      probeNetwork: async () => {
        throw new Error("network unavailable");
      },
    });
    const c = client({
      pullJobs: vi
        .fn()
        .mockResolvedValueOnce(
          okR({
            nodeId: "n1",
            servers: [],
            jobs: [],
            discoveryUntil: null,
            networkProbes: [{ host: "10.0.0.1", port: 9100, expiresInMs: 30000 }],
          }),
        )
        .mockResolvedValue(
          okR({ nodeId: "n1", servers: [], jobs: [usbJob("probe-print")], discoveryUntil: null }),
        ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect(c.report).toHaveBeenCalledWith(expect.any(String), "a1.s", "probe-print", {
      status: "done",
    });
    expect(host.logs.some((line) => line.includes("address probe failed"))).toBe(true);
  });

  describe("office-printer classification", () => {
    const H = "192.168.20.56";
    const target = { host: H, port: 9100, expiresInMs: 30000 };
    const scannedHp = { transport: "network_tcp" as const, host: H, port: 9100, name: "HP" };
    const probedHp = { transport: "network_tcp" as const, host: H, port: 9100 };
    const openWindowWithProbe = () =>
      vi.fn().mockResolvedValue(
        okR<PullReply>({
          nodeId: "n1",
          servers: [],
          jobs: [],
          discoveryUntil: 10_000_000_000,
          networkProbes: [target],
        }),
      );
    const markHp = async (devices: DiscoveredDevice[]) =>
      devices.map((d) => (d.host === H ? { ...d, pagePrinter: true as const } : d));

    it("classifies the merged scan and probe results once, so a scan duplicate of a typed address is reported marked", async () => {
      const markPagePrinters = vi.fn(markHp);
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: async () => [{ ...scannedHp }],
        probeNetwork: async () => [{ ...probedHp }],
        markPagePrinters,
      });
      // The typed address arrives with the second reply, so the pull that carries the pass's
      // devices is also the first to probe it.
      const pulls = openWindowWithProbe().mockResolvedValueOnce(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
      );
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      await agent.runOnce(); // opens the window
      expect(markPagePrinters).not.toHaveBeenCalled();
      await agent.runOnce(); // starts the pass and records the typed address
      await agent.runOnce(); // takes the pass's devices, probes, merges, then classifies
      expect(markPagePrinters).toHaveBeenCalledTimes(1);
      expect(markPagePrinters).toHaveBeenCalledWith([scannedHp]);
      expect(inventoryOf(c, 2).scanned).toStrictEqual([{ ...scannedHp, pagePrinter: true }]);
    });

    it("does not classify when nothing on the list is a network device", async () => {
      const markPagePrinters = vi.fn(markHp);
      const bt = { transport: "bluetooth" as const, localKey: "AA:BB:CC" };
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: async () => [bt],
        markPagePrinters,
      });
      const c = client({
        pullJobs: vi
          .fn()
          .mockResolvedValue(
            okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
          ),
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await agent.runOnce();
      await agent.runOnce();
      expect(inventoryOf(c, 2).scanned).toStrictEqual([bt]);
      expect(markPagePrinters).not.toHaveBeenCalled();
    });

    it("a throwing classification never blocks the job pull and reports the devices unmarked", async () => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: async () => [{ ...scannedHp }],
        markPagePrinters: async () => {
          throw new Error("ipp exploded");
        },
      });
      const c = client({
        pullJobs: vi
          .fn()
          .mockResolvedValueOnce(
            okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
          )
          .mockResolvedValue(
            okR<PullReply>({
              nodeId: "n1",
              servers: [],
              jobs: [usbJob("classify-print")],
              discoveryUntil: null,
            }),
          ),
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await agent.runOnce();
      await agent.runOnce();
      expect(inventoryOf(c, 2).scanned).toStrictEqual([scannedHp]);
      expect(c.report).toHaveBeenCalledWith(expect.any(String), "a1.s", "classify-print", {
        status: "done",
      });
      expect(c.report).toHaveBeenCalledTimes(2); // the pull whose classification threw printed too
      expect(host.logs.some((line) => line.includes("office-printer check failed"))).toBe(true);
    });

    describe("a host announced only by IPP", () => {
      const ippOnly: DiscoveredDevice = {
        transport: "network_tcp",
        host: "192.168.20.70",
        port: 8631,
        ipp: { port: 8631, resourcePath: "/ipp/printer" },
        ippOnly: true,
      };
      const unreadable = {
        ...ippOnly,
        office: {
          port: 8631,
          resourcePath: "/ipp/printer",
          printable: false,
          reason: "invalid_reply",
          supportedFormats: [],
        },
      };
      /** A raw device whose host also announced IPP: it has a raw port, so the fallback leaves it. */
      const rawWithIpp: DiscoveredDevice = {
        transport: "network_tcp",
        host: "192.168.20.71",
        port: 9100,
        ipp: { port: 631, resourcePath: "/ipp/print" },
      };
      const windowOpen = () =>
        vi
          .fn()
          .mockResolvedValue(
            okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
          );

      it.each([
        [
          "the classification throws",
          {
            markPagePrinters: async () => {
              throw new Error("ipp exploded");
            },
          },
        ],
        ["the host has no classifier", {}],
        ["the classifier leaves it without a report", { markPagePrinters: markHp }],
      ] as Array<[string, Pick<Host, "markPagePrinters">]>)(
        "is reported unreadable, never a receipt printer, when %s",
        async (_label, over) => {
          const host = fakeHost({
            config: CONFIG,
            token: "a1.s",
            scan: async () => [{ ...ippOnly }, { ...rawWithIpp }, { ...scannedHp }],
            ...over,
          });
          const c = client({ pullJobs: windowOpen() });
          const agent = createAgent({ host, client: c });
          await agent.runOnce();
          await agent.runOnce();
          await agent.runOnce();
          expect(inventoryOf(c, 2).scanned).toStrictEqual([
            unreadable,
            rawWithIpp,
            over.markPagePrinters === markHp ? { ...scannedHp, pagePrinter: true } : scannedHp,
          ]);
        },
      );

      it("adds no report to one that names no IPP queue to report on", async () => {
        const queueless: DiscoveredDevice = { ...ippOnly };
        delete queueless.ipp;
        const host = fakeHost({
          config: CONFIG,
          token: "a1.s",
          scan: async () => [{ ...queueless }],
        });
        const c = client({ pullJobs: windowOpen() });
        const agent = createAgent({ host, client: c });
        await agent.runOnce();
        await agent.runOnce();
        await agent.runOnce();
        expect(inventoryOf(c, 2).scanned).toStrictEqual([queueless]);
      });

      it("keeps the report its classifier gave", async () => {
        const office = {
          port: 8631,
          resourcePath: "/ipp/printer",
          printable: true as const,
          documentFormat: "application/pdf" as const,
          media: "iso_a4_210x297mm" as const,
          resolutionDpi: 300 as const,
          supportedFormats: ["application/pdf"],
        };
        const host = fakeHost({
          config: CONFIG,
          token: "a1.s",
          scan: async () => [{ ...ippOnly }],
          markPagePrinters: async (devices) =>
            devices.map((d) => ({ ...d, pagePrinter: true as const, office })),
        });
        const c = client({ pullJobs: windowOpen() });
        const agent = createAgent({ host, client: c });
        await agent.runOnce();
        await agent.runOnce();
        await agent.runOnce();
        expect(inventoryOf(c, 2).scanned).toStrictEqual([
          { ...ippOnly, pagePrinter: true, office },
        ]);
      });
    });

    it("reports the merged devices unchanged on a host without the classifier", async () => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: async () => [{ ...scannedHp }],
        probeNetwork: async () => [{ ...probedHp }],
      });
      expect(host.markPagePrinters).toBeUndefined();
      const c = client({ pullJobs: openWindowWithProbe() });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await agent.runOnce();
      await agent.runOnce();
      expect(inventoryOf(c, 2).scanned).toStrictEqual([scannedHp]);
      expect(host.logs.some((line) => line.includes("office-printer check failed"))).toBe(false);
    });
  });

  it("reports visible devices on every pull", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      visibleDevices: async () => [{ transport: "usb", localKey: "SN-1" }],
    });
    const c = client();
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    expect(inventoryOf(c, 0).visible).toEqual([{ transport: "usb", localKey: "SN-1" }]);
    expect(inventoryOf(c, 0).scanned).toEqual([]);
    expect(inventoryOf(c, 1).visible).toEqual([{ transport: "usb", localKey: "SN-1" }]);
  });

  it("scans only within a discovery window", async () => {
    const scanned = [{ transport: "bluetooth" as const, name: "BT-58", localKey: "AA:BB:CC" }];
    const scan = vi.fn(async () => scanned);
    const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
    // The discoveryUntil in each reply governs whether the NEXT tick scans. host.now() starts high
    // (>0), so a far-future instant opens the window and null (stored as 0) closes it.
    const pulls = vi
      .fn()
      .mockResolvedValueOnce(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
      )
      .mockResolvedValueOnce(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
      )
      .mockResolvedValue(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
      );
    const c = client({ pullJobs: pulls });
    const agent = createAgent({ host, client: c });
    await agent.runOnce(); // no prior window → no scan; this reply opens one
    expect(scan).not.toHaveBeenCalled();
    expect(inventoryOf(c, 0).scanned).toEqual([]);
    await agent.runOnce(); // prior window open → starts a pass; this reply closes the window
    expect(scan).toHaveBeenCalledTimes(1);
    await agent.runOnce(); // window closed → no further scan; carries the finished pass's results
    expect(scan).toHaveBeenCalledTimes(1);
    expect(inventoryOf(c, 2).scanned).toEqual(scanned);
    await agent.runOnce();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(inventoryOf(c, 3).scanned).toEqual([]);
  });

  it("a throwing discovery scan never blocks the job pull (isolated failure)", async () => {
    const scan = vi.fn(async () => {
      throw new Error("spawn bluetoothctl ENOENT");
    });
    const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
    const pulls = vi.fn(async () =>
      okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000_000_000 }),
    );
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    await agent.runOnce(); // opens the window (no prior window → no scan yet)
    await agent.runOnce(); // window open → scan throws, but the pull must still happen
    await agent.runOnce(); // window still open → scan throws again, pull still happens
    expect(scan).toHaveBeenCalledTimes(2);
    expect(pulls).toHaveBeenCalledTimes(3); // a scan error never suppresses a pull
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });

  it("logs a scan, address check or classification that throws a non-Error, and still pulls", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      scan: async () => {
        throw "no adapter";
      },
      probeNetwork: async () => {
        throw "no route";
      },
      markPagePrinters: async () => {
        throw "ipp refused";
      },
    });
    const pulls = vi.fn(async () =>
      okR<PullReply>({
        nodeId: "n1",
        servers: [],
        jobs: [],
        discoveryUntil: 10_000_000_000,
        networkProbes: [{ host: "10.0.0.1", port: 9100, expiresInMs: 30000 }],
      }),
    );
    // Without a network device on the list the classifier is never asked, so one probe must succeed
    // for its failure to be reached. The first tick neither scans nor probes an address: its pull
    // opens the window and delivers the address list. The second scans and probes, and both fail;
    // the third scans and fails again, then, with the address now answering, classifies and fails.
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    await agent.runOnce();
    await agent.runOnce();
    host.probeNetwork = async () => [{ transport: "network_tcp", host: "10.0.0.1", port: 9100 }];
    await agent.runOnce();
    expect(host.logs.filter((line) => line.startsWith("warn"))).toEqual([
      'warn scan failed {"error":"no adapter"}',
      'warn address probe failed {"error":"no route"}',
      'warn scan failed {"error":"no adapter"}',
      'warn office-printer check failed {"error":"ipp refused"}',
    ]);
    expect(pulls).toHaveBeenCalledTimes(3);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });

  describe("a discovery pass runs beside the job pull", () => {
    const bt = { transport: "bluetooth" as const, name: "BT-58", localKey: "AA:BB:CC" };
    const open = (jobs: WireJob[] = []) =>
      okR<PullReply>({ nodeId: "n1", servers: [], jobs, discoveryUntil: 10_000_000_000 });
    // Lets every tick and pass whose host calls have already resolved run to the end.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const never = () => new Promise<DiscoveredDevice[]>(() => {});

    it("pulls and delivers a job queued while a scan is still running", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn(() => pass.promise);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open())
        .mockResolvedValue(open([usbJob("during-scan")]));
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      await agent.runOnce(); // opens the window
      const during = agent.runOnce(); // starts a pass that has not finished
      await settle();
      expect(scan).toHaveBeenCalledTimes(1);
      expect(pulls).toHaveBeenCalledTimes(2);
      expect(c.report).toHaveBeenCalledWith(A, "a1.s", "during-scan", { status: "done" });
      pass.resolve([]);
      await during;
    });

    it("a tick that finds a pass still running pulls and starts no second one", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn(() => pass.promise);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const pulls = vi.fn(async () => open());
      const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
      const ticks = [agent.runOnce(), agent.runOnce(), agent.runOnce()];
      await settle();
      expect(pulls).toHaveBeenCalledTimes(3);
      expect(scan).toHaveBeenCalledTimes(1);
      pass.resolve([]);
      await Promise.all(ticks);
      await settle();
      await agent.runOnce(); // the pass has finished, so this tick starts the next one
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        "throws",
        async (): Promise<DiscoveredDevice[]> => {
          throw new Error("spawn bluetoothctl ENOENT");
        },
      ],
      ["never finishes", never],
    ])("a scan that %s never stops the job pulls", async (_, body) => {
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan: vi.fn(body) });
      const pulls = vi.fn(async () => open([usbJob("keeps-printing")]));
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      const ticks = [agent.runOnce(), agent.runOnce(), agent.runOnce(), agent.runOnce()];
      await settle();
      expect(pulls).toHaveBeenCalledTimes(4);
      expect(c.report).toHaveBeenCalledTimes(4);
      expect(host.statuses.at(-1)?.phase).toBe("running");
      await Promise.all(ticks);
    });

    it("reports a finished pass's devices on the next pull, and only once", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn().mockReturnValueOnce(pass.promise).mockImplementation(never);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const c = client({ pullJobs: vi.fn(async () => open()) });
      const agent = createAgent({ host, client: c });
      await agent.runOnce(); // opens the window
      const starting = agent.runOnce(); // starts the pass
      await settle();
      pass.resolve([bt]);
      await starting;
      await settle();
      expect(inventoryOf(c, 1).scanned).toEqual([]);
      await agent.runOnce();
      expect(inventoryOf(c, 2).scanned).toEqual([bt]);
      await agent.runOnce();
      expect(inventoryOf(c, 3).scanned).toEqual([]);
    });

    it("keeps a finished pass's devices through a failed pull and sends them on the next pull that succeeds", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn().mockReturnValueOnce(pass.promise).mockImplementation(never);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const closed = okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null });
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(closed)
        .mockResolvedValueOnce(failR({ kind: "unreachable", detail: "network down" }))
        .mockResolvedValue(closed);
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      await agent.runOnce(); // opens the window
      await agent.runOnce(); // starts the pass; this reply closes the window
      pass.resolve([bt]);
      await settle();
      await agent.runOnce(); // carries the devices, and the pull fails
      await agent.runOnce();
      await agent.runOnce();
      expect(pulls.mock.calls.map((call) => call[2].scanned)).toEqual([[], [], [bt], [bt], []]);
      expect(scan).toHaveBeenCalledTimes(1);
    });

    it("keeps the devices of a pass that finishes while a successful pull is carrying an older pass's", async () => {
      const first = deferred<DiscoveredDevice[]>();
      const second = deferred<DiscoveredDevice[]>();
      const scan = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockImplementation(never);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const inFlight = deferred<Result<PullReply>>();
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(open())
        .mockReturnValueOnce(inFlight.promise)
        .mockResolvedValue(open());
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      const usb = { transport: "usb" as const, name: "USB-80", localKey: "SN-9" };
      await agent.runOnce(); // opens the window
      await agent.runOnce(); // starts the first pass
      first.resolve([bt]);
      await settle();
      const carrying = agent.runOnce(); // carries the first pass's devices and starts the second
      await settle();
      expect(scan).toHaveBeenCalledTimes(2);
      second.resolve([usb]);
      await settle();
      inFlight.resolve(open());
      await carrying;
      await agent.runOnce();
      expect(pulls.mock.calls.map((call) => call[2].scanned)).toEqual([[], [], [bt], [usb]]);
    });

    it("a setup reset drops a running pass's devices, and a new window scans once that pass ends", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn().mockReturnValueOnce(pass.promise).mockImplementation(never);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(failR({ kind: "unauthorized" }))
        .mockResolvedValue(open());
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      await agent.runOnce(); // opens the window
      const halting = agent.runOnce(); // starts the pass; the pull is refused, so the agent halts
      await settle();
      expect(pulls).toHaveBeenCalledTimes(2);
      await halting;
      expect(await agent.configure({ serverUrl: A, name: "kitchen-pi" })).toBe(true);
      await agent.runOnce(); // joins → pending
      await agent.runOnce(); // approved → pulls, and this reply opens a new window
      await agent.runOnce(); // the old pass is still running, so no second one starts
      expect(scan).toHaveBeenCalledTimes(1);
      pass.resolve([bt]);
      await settle();
      await agent.runOnce(); // the old pass ended: its devices are dropped and a new pass starts
      expect(pulls.mock.calls.slice(2).map((call) => call[2].scanned)).toEqual([[], [], []]);
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it("a setup reset drops a finished pass's devices that no pull has carried yet", async () => {
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan: async () => [bt] });
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open())
        .mockResolvedValueOnce(failR({ kind: "unauthorized" }))
        .mockResolvedValue(
          okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
        );
      const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
      await agent.runOnce(); // opens the window
      await agent.runOnce(); // starts the pass; the pull is refused, so the agent halts
      await settle(); // the pass finishes while the agent is halted
      expect(await agent.configure({ serverUrl: A, name: "kitchen-pi" })).toBe(true);
      await agent.runOnce(); // joins → pending
      await agent.runOnce(); // approved → pulls
      expect(pulls.mock.calls[2]![2].scanned).toEqual([]);
    });

    it("a finished pass wakes a sleeping loop so its devices go out at once", async () => {
      const pass = deferred<DiscoveredDevice[]>();
      const scan = vi.fn().mockReturnValueOnce(pass.promise).mockImplementation(never);
      const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
      host.sleep = () => new Promise(() => {});
      // The first reply carries a job, so the loop re-polls at once and that tick starts the pass;
      // after the second, empty, reply it sleeps for good unless something wakes it.
      const pulls = vi
        .fn()
        .mockResolvedValueOnce(open([usbJob("opens")]))
        .mockResolvedValue(open());
      const c = client({ pullJobs: pulls });
      const agent = createAgent({ host, client: c });
      const loop = agent.start();
      await settle();
      expect(pulls).toHaveBeenCalledTimes(2);
      pass.resolve([bt]);
      await settle();
      expect(pulls).toHaveBeenCalledTimes(3);
      expect(inventoryOf(c, 2).scanned).toEqual([bt]);
      agent.stop();
      await loop;
    });

    it("logs a pass that rejects with a value String() cannot convert", async () => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: () => Promise.reject(Object.create(null) as object),
      });
      const agent = createAgent({ host, client: client({ pullJobs: vi.fn(async () => open()) }) });
      await agent.runOnce(); // opens the window
      await agent.runOnce(); // starts the pass
      await settle();
      expect(host.logs).toContain('warn scan failed {"error":"unstringifiable rejection"}');
    });

    it("contains a clock failure when a discovery pass starts", async () => {
      let reads = 0;
      const scan = vi.fn(async () => [bt]);
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan,
        now: () => {
          reads += 1;
          if (reads === 4) throw new Error("clock boom");
          return 1_000;
        },
      });
      const agent = createAgent({ host, client: client({ pullJobs: vi.fn(async () => open()) }) });
      await agent.runOnce();
      await agent.runOnce();
      expect(host.logs).toContain('warn scan failed {"error":"clock boom"}');
      expect(scan).not.toHaveBeenCalled();
    });

    it("a logger that throws while a pass fails neither escapes nor stops the pulls", async () => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        scan: async () => {
          throw new Error("no adapter");
        },
      });
      host.log.warn = () => {
        throw new Error("log sink closed");
      };
      const pulls = vi.fn(async () => open());
      const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
      await agent.runOnce();
      await agent.runOnce();
      await settle();
      await agent.runOnce();
      await settle();
      expect(pulls).toHaveBeenCalledTimes(3);
      expect(host.statuses.at(-1)?.phase).toBe("running");
    });
  });

  it("resolves a usb job before sending", async () => {
    const resolved: PrinterTarget = {
      id: "p1",
      transport: "usb",
      host: null,
      port: null,
      devicePath: "/tmp/x",
    };
    const sent: PrinterTarget[] = [];
    const transport = {
      send: vi.fn(async (t: PrinterTarget) => {
        sent.push(t);
      }),
    };
    const resolve = vi.fn(async () => resolved);
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport, resolve });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [usbJob("j1")], discoveryUntil: null }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([resolved]); // the transport received exactly the resolved target
    expect(c.report).toHaveBeenCalledWith(A, "a1.s", "j1", { status: "done" });
  });

  it("marks a job failed when resolve throws (device gone), and the loop continues", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("device gone");
    });
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport: sink, resolve });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({
          nodeId: "n1",
          servers: [],
          jobs: [usbJob("j1"), usbJob("j2")],
          discoveryUntil: null,
        }),
      ),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(sink.written).toEqual([]); // a failed resolve never reaches the transport
    expect(c.report).toHaveBeenNthCalledWith(1, A, "a1.s", "j1", {
      status: "failed",
      error: "device gone",
    });
    expect(c.report).toHaveBeenNthCalledWith(2, A, "a1.s", "j2", {
      status: "failed",
      error: "device gone",
    }); // the loop went on to the second job
    expect(host.statuses.at(-1)?.phase).toBe("running");
    expect(host.statuses.at(-1)?.lastError).toBe("device gone");
  });
});

describe("createAgent — start/stop and logging", () => {
  it("start loops runOnce, sleeping the interval after an empty pull and not at all after a batch", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const pulls = vi
      .fn()
      .mockResolvedValueOnce(
        okR<PullReply>({
          nodeId: "n1",
          servers: [],
          jobs: [
            {
              id: "j1",
              printerId: "p1",
              transport: "network_tcp",
              host: "h",
              port: 1,
              localKey: null,
              payload: new Uint8Array(),
            },
          ],
          discoveryUntil: null,
        }),
      )
      .mockResolvedValue(
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null }),
      );
    const agent = createAgent({ host, client: client({ pullJobs: pulls }), intervalMs: 50 });
    const originalSleep = host.sleep;
    host.sleep = async (ms) => {
      await originalSleep(ms);
      if (host.sleeps.length >= 2) agent.stop();
    };
    await agent.start();
    expect(host.sleeps).toEqual([50, 50]); // tick 1 had a batch → no sleep; ticks 2 and 3 slept
    expect(pulls).toHaveBeenCalledTimes(3);
  });

  it("stop during a tick ends start without sleeping", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const pulls = vi.fn(async () => {
      agent.stop();
      return okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null });
    });
    const agent = createAgent({ host, client: client({ pullJobs: pulls }), intervalMs: 50 });
    await agent.start();
    expect(pulls).toHaveBeenCalledTimes(1);
    expect(host.sleeps).toEqual([]);
  });

  it("delivers a fast scan without starting passes back to back", async () => {
    const device = { transport: "usb" as const, name: "USB-80", localKey: "SN-9" };
    const scan = vi.fn(async () => [device]);
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      scan,
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    const sent: AgentInventory[] = [];
    const pulls = vi.fn(async (_url: string, _token: string, inventory: AgentInventory) => {
      sent.push(inventory);
      if (pulls.mock.calls.length > 10) agent.stop();
      return okR<PullReply>({
        nodeId: "n1",
        servers: [],
        jobs: [],
        discoveryUntil: Date.now() + 10_000,
      });
    });
    const c = client({ pullJobs: pulls });
    const agent = createAgent({ host, client: c });
    await agent.runOnce(); // opens discovery before the timed loop begins
    const loop = agent.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(pulls.mock.calls.length - 1).toBeLessThanOrEqual(2);
      expect(scan).toHaveBeenCalledTimes(1);
      expect(
        sent.some((inventory) => inventory.scanned.some((item) => item.localKey === "SN-9")),
      ).toBe(true);
    } finally {
      agent.stop();
      await loop;
    }
  });

  it("starts another empty scan at the next polling interval", async () => {
    let clock = 1_000;
    const sleeps: ReturnType<typeof deferred<void>>[] = [];
    const scan = vi.fn(async () => {
      clock += 20;
      return [];
    });
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      scan,
      now: () => clock,
      sleep: () => {
        const pause = deferred();
        sleeps.push(pause);
        return pause.promise;
      },
    });
    const pulls = vi.fn(async () =>
      okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: 10_000 }),
    );
    const agent = createAgent({ host, client: client({ pullJobs: pulls }), intervalMs: 50 });
    await agent.runOnce();
    const loop = agent.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scan).toHaveBeenCalledTimes(1);
      clock = 1_050;
      sleeps[0]!.resolve(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scan).toHaveBeenCalledTimes(2);
    } finally {
      agent.stop();
      await loop;
    }
  });

  it("logs on a phase change, not on every tick", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const agent = createAgent({ host, client: client() });
    await agent.runOnce();
    await agent.runOnce();
    await agent.runOnce();
    expect(host.logs.filter((l) => l.includes("phase")).length).toBe(1);
  });

  it("never throws: a client that throws becomes an unreachable status", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      probeNode: vi.fn(async () => {
        throw new Error("bug");
      }),
    });
    await expect(createAgent({ host, client: c }).runOnce()).resolves.toBeUndefined();
    expect(host.statuses.at(-1)?.phase).toBe("unreachable");
  });

  it("a client that throws a non-Error reports that value as the error, and logs it", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      probeNode: vi.fn(async () => {
        throw "socket hang up";
      }),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(host.statuses.at(-1)).toMatchObject({
      phase: "unreachable",
      lastError: "socket hang up",
    });
    expect(host.logs).toContain('error tick failed {"error":"socket hang up"}');
  });
});

describe("createAgent — Bluetooth commands", () => {
  const MAC = "5A:4A:45:D4:FB:BB";
  const MAC2 = "66:22:B3:9E:5C:01";
  const PIN = "4821";
  const WITHHELD = "pairing failed; the detail was withheld because it contained the PIN";
  const job = (id: string): WireJob => ({
    id,
    printerId: "p1",
    transport: "network_tcp",
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    payload: new Uint8Array([7]),
  });
  const reply = (over: Partial<PullReply> = {}): Result<PullReply> =>
    okR<PullReply>({ nodeId: "n1", servers: [], jobs: [], discoveryUntil: null, ...over });
  const pair = (id: string, pin?: string): BluetoothCommand => ({
    id,
    kind: "pair",
    address: MAC,
    ...(pin === undefined ? {} : { pin }),
  });
  const forget = (id: string): BluetoothCommand => ({ id, kind: "forget", address: MAC2 });
  const sentOn = (c: AgentClient, pull: number) =>
    (c.pullJobs as ReturnType<typeof vi.fn>).mock.calls[pull]![2] as AgentInventory;
  const outcomesOn = (c: AgentClient, pull: number) => sentOn(c, pull).bluetoothOutcomes;
  const scripted = (...replies: Result<PullReply>[]) => {
    const pulls = vi.fn(async () => reply());
    for (const r of replies) pulls.mockResolvedValueOnce(r);
    return pulls;
  };
  // Lets the background command worker finish whatever its host calls have already resolved.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** A host.pair whose every call waits until the test resolves it. */
  function heldPair() {
    const pending: ((result: { ok: boolean; error?: string }) => void)[] = [];
    let running = 0;
    let most = 0;
    const fn = vi.fn<Host["pair"]>(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          running += 1;
          most = Math.max(most, running);
          pending.push((result) => {
            running -= 1;
            resolve(result);
          });
        }),
    );
    return {
      fn,
      release: (result: { ok: boolean; error?: string } = { ok: true }) => pending.shift()!(result),
      mostAtOnce: () => most,
    };
  }

  it("sends the paired Bluetooth devices apart from the visible ones, listing them first, once per pull", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      visibleDevices: async () => [{ transport: "usb", localKey: "SN-1" }],
      pairedBluetooth: async () => [{ localKey: MAC, name: "BT-58" }],
    });
    const c = client();
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    for (const pull of [0, 1]) {
      expect(sentOn(c, pull).visible).toStrictEqual([{ transport: "usb", localKey: "SN-1" }]);
      expect(sentOn(c, pull).pairedBluetooth).toStrictEqual([{ localKey: MAC, name: "BT-58" }]);
    }
    expect(host.calls).toStrictEqual([
      "pairedBluetooth",
      "visibleDevices",
      "pairedBluetooth",
      "visibleDevices",
    ]);
  });

  it.each([
    [new Error("bluetoothctl: not found"), "bluetoothctl: not found"],
    ["no adapter", "no adapter"],
  ])(
    "a paired listing that throws (%s) is logged and sent as none, and the reply's job still prints",
    async (thrown, logged) => {
      const sink = new FakeSink();
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        transport: sink,
        pairedBluetooth: async () => {
          throw thrown;
        },
      });
      const c = client({ pullJobs: scripted(reply({ jobs: [job("j1")] })) });
      await createAgent({ host, client: c }).runOnce();
      expect(sentOn(c, 0).pairedBluetooth).toStrictEqual([]);
      expect(host.logs).toContain(
        `warn paired bluetooth listing failed ${JSON.stringify({ error: logged })}`,
      );
      expect(sink.written).toHaveLength(1);
      expect(c.report).toHaveBeenCalledWith(A, "a1.s", "j1", { status: "done" });
    },
  );

  it("a paired listing that throws synchronously is still sent as none", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    host.pairedBluetooth = () => {
      throw new Error("sync");
    };
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    expect(sentOn(c, 0).pairedBluetooth).toStrictEqual([]);
    expect(host.statuses.at(-1)?.phase).toBe("running");
  });

  it("logs a paired listing failure once while it repeats, and again when it changes or returns", async () => {
    const results: (() => Promise<{ localKey: string }[]>)[] = [
      async () => Promise.reject(new Error("no adapter")),
      async () => Promise.reject(new Error("no adapter")),
      async () => Promise.reject(new Error("bluetoothd not running")),
      async () => [],
      async () => Promise.reject(new Error("bluetoothd not running")),
    ];
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      pairedBluetooth: () => results.shift()!(),
    });
    const agent = createAgent({ host, client: client() });
    for (let i = 0; i < 5; i++) await agent.runOnce();
    expect(
      host.logs.filter((line) => line.includes("paired bluetooth listing failed")),
    ).toStrictEqual([
      `warn paired bluetooth listing failed {"error":"no adapter"}`,
      `warn paired bluetooth listing failed {"error":"bluetoothd not running"}`,
      `warn paired bluetooth listing failed {"error":"bluetoothd not running"}`,
    ]);
  });

  it("Pair and Forget reach the matching host method, and their outcomes ride the next pull only", async () => {
    const pairFn = vi.fn(async () => ({ ok: true, localKey: MAC }));
    const forgetFn = vi.fn(async () => ({ ok: true }));
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      pair: pairFn,
      forgetBluetooth: forgetFn,
    });
    const c = client({
      pullJobs: scripted(reply({ bluetoothCommands: [pair("c1", PIN), forget("c2")] })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    expect(pairFn).toHaveBeenCalledWith(MAC, PIN);
    expect(forgetFn).toHaveBeenCalledWith(MAC2);
    expect(outcomesOn(c, 0)).toStrictEqual([]);
    await agent.runOnce();
    expect(outcomesOn(c, 1)).toStrictEqual([
      { id: "c1", ok: true },
      { id: "c2", ok: true },
    ]);
    await agent.runOnce();
    expect(outcomesOn(c, 2)).toStrictEqual([]);
  });

  it("a refusal and a throw both become failed outcomes, and neither stops the jobs or the next command", async () => {
    const sink = new FakeSink();
    const pairFn = vi.fn(async () => ({ ok: false, error: "pairing timed out" }));
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      transport: sink,
      pair: pairFn,
      forgetBluetooth: async () => {
        throw new Error("org.bluez.Error.NotReady");
      },
    });
    const c = client({
      pullJobs: scripted(
        reply({ jobs: [job("j1")], bluetoothCommands: [forget("c1"), pair("c2"), forget("c3")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    expect(sink.written).toHaveLength(1);
    expect(pairFn).toHaveBeenCalledTimes(1);
    expect(outcomesOn(c, 1)).toStrictEqual([
      { id: "c1", ok: false, error: "org.bluez.Error.NotReady" },
      { id: "c2", ok: false, error: "pairing timed out" },
      { id: "c3", ok: false, error: "org.bluez.Error.NotReady" },
    ]);
    expect(host.logs).toContain(
      `warn bluetooth command failed ${JSON.stringify({ id: "c2", kind: "pair", address: MAC, error: "pairing timed out" })}`,
    );
  });

  it("an outcome's error is always a string or absent, whatever the host produced", async () => {
    const unprintable = Object.create(null) as object;
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const results: (() => Promise<unknown>)[] = [
      async () => {
        throw "busy";
      },
      async () => {
        throw unprintable;
      },
      async () => ({ ok: false }),
      async () => ({ ok: false, error: new Error("wrapped") }),
      async () => undefined,
      async () => ({ ok: "yes" }),
    ];
    host.forgetBluetooth = vi.fn(() => results.shift()!()) as Host["forgetBluetooth"];
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: ["c1", "c2", "c3", "c4", "c5", "c6"].map(forget) }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    expect(outcomesOn(c, 1)).toStrictEqual([
      { id: "c1", ok: false, error: "busy" },
      { id: "c2", ok: false, error: "unstringifiable rejection" },
      { id: "c3", ok: false },
      { id: "c4", ok: false, error: "wrapped" },
      { id: "c5", ok: false, error: expect.any(String) },
      { id: "c6", ok: false },
    ]);
  });

  it.each([
    // A PIN that is also a byte of the address, the printer's name ending in it, and a colon.
    ["45", `Failed to pair: org.bluez.Error.AuthenticationFailed Device ${MAC}`],
    ["1234", "Name: TM-P20II_001234\nFailed to pair"],
    [":", `Device ${MAC} not available`],
    [PIN, `bluetoothctl echoed passkey ${PIN} and failed`],
  ])(
    "withholds the whole error, never part of it, when it contains the PIN %j",
    async (pin, text) => {
      const host = fakeHost({
        config: CONFIG,
        token: "a1.s",
        pair: vi
          .fn()
          .mockRejectedValueOnce(new Error(text))
          .mockResolvedValueOnce({ ok: false, error: text }),
      });
      const c = client({
        pullJobs: scripted(reply({ bluetoothCommands: [pair("c1", pin), pair("c2", pin)] })),
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      await agent.runOnce();
      expect(outcomesOn(c, 1)).toStrictEqual([
        { id: "c1", ok: false, error: WITHHELD },
        { id: "c2", ok: false, error: WITHHELD },
      ]);
      const failures = host.logs.filter((line) => line.includes("bluetooth command failed"));
      expect(failures).toHaveLength(2);
      for (const line of failures) expect(line).toContain(WITHHELD);
      expect(host.logs.join("\n")).not.toContain(text);
    },
  );

  it("keeps an error that does not contain the PIN of the command that produced it", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      pair: async () => ({ ok: false, error: "pairing timed out" }),
    });
    const c = client({ pullJobs: scripted(reply({ bluetoothCommands: [pair("c1", PIN)] })) });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    expect(outcomesOn(c, 1)).toStrictEqual([{ id: "c1", ok: false, error: "pairing timed out" }]);
  });

  it("delivers and reports the reply's print jobs before running its commands", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: async () => ({ ok: true }) });
    host.transport = {
      send: async () => {
        host.calls.push("send");
      },
    };
    const c = client({
      pullJobs: scripted(reply({ jobs: [job("j1")], bluetoothCommands: [pair("c1")] })),
      report: vi.fn(async () => {
        host.calls.push("report");
        return okR(undefined);
      }),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(host.calls.filter((call) => ["send", "report", "pair"].includes(call))).toStrictEqual([
      "send",
      "report",
      "pair",
    ]);
  });

  it("pulls and prints a job that arrives while a Pair is still running", async () => {
    const held = heldPair();
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport: sink, pair: held.fn });
    const c = client({
      pullJobs: scripted(reply({ bluetoothCommands: [pair("c1")] }), reply({ jobs: [job("j1")] })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    expect(held.fn).toHaveBeenCalledTimes(1);
    await agent.runOnce();
    expect(sink.written).toHaveLength(1);
    expect(c.report).toHaveBeenCalledWith(A, "a1.s", "j1", { status: "done" });
    expect(outcomesOn(c, 1)).toStrictEqual([]);
    held.release();
    await settle();
    await agent.runOnce();
    expect(outcomesOn(c, 2)).toStrictEqual([{ id: "c1", ok: true }]);
  });

  it("runs a reply's commands one after the other, in the order they came, never two at once", async () => {
    const MAC3 = "00:11:22:33:44:55";
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    const c = client({
      pullJobs: scripted(
        reply({
          bluetoothCommands: [
            { ...pair("c1"), address: MAC },
            { ...pair("c2"), address: MAC2 },
            { ...pair("c3"), address: MAC3 },
          ],
        }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    const started = () => held.fn.mock.calls.map(([mac]) => mac);
    expect(started()).toStrictEqual([MAC]);
    held.release();
    await settle();
    expect(started()).toStrictEqual([MAC, MAC2]);
    held.release({ ok: false, error: "pairing timed out" });
    await settle();
    expect(started()).toStrictEqual([MAC, MAC2, MAC3]);
    held.release();
    await settle();
    await agent.runOnce();
    expect(held.mostAtOnce()).toBe(1);
    expect(outcomesOn(c, 1)).toStrictEqual([
      { id: "c1", ok: true },
      { id: "c2", ok: false, error: "pairing timed out" },
      { id: "c3", ok: true },
    ]);
  });

  it("a command from a later pull waits for the one still running", async () => {
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [{ ...pair("c1"), address: MAC }] }),
        reply({ bluetoothCommands: [{ ...pair("c2"), address: MAC2 }] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    await settle();
    expect(held.fn.mock.calls.map(([mac]) => mac)).toStrictEqual([MAC]);
    held.release();
    await settle();
    expect(held.fn.mock.calls.map(([mac]) => mac)).toStrictEqual([MAC, MAC2]);
    held.release();
    await settle();
    expect(held.mostAtOnce()).toBe(1);
  });

  it("counts the running command toward the eight", async () => {
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    const ids = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: ids.map((id) => pair(id)) }),
        reply({ bluetoothCommands: [pair("c9")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce(); // c1 running and c2..c8 queued: no room for c9
    for (let i = 0; i < 8; i++) {
      held.release();
      await settle();
    }
    expect(held.fn).toHaveBeenCalledTimes(8);
  });

  it("counts outcomes that finished during a pull as held, so the outcomes never exceed eight", async () => {
    const pending: (() => void)[] = [];
    const forgetFn = vi.fn(
      () => new Promise<{ ok: boolean }>((resolve) => pending.push(() => resolve({ ok: true }))),
    );
    const host = fakeHost({ config: CONFIG, token: "a1.s", forgetBluetooth: forgetFn });
    const ids = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);
    const pulls = scripted(reply({ bluetoothCommands: ids.map(forget) }));
    // The second pull's reply arrives only after all eight finished, so their outcomes are queued
    // but were not in the pull that is carrying the ninth command.
    pulls.mockImplementationOnce(async () => {
      while (pending.length > 0) {
        pending.shift()!();
        await settle();
      }
      return reply({ bluetoothCommands: [forget("c9")] });
    });
    pulls.mockResolvedValueOnce(reply({ bluetoothCommands: [forget("c9")] }));
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    const c = { pullJobs: pulls } as unknown as AgentClient;
    await agent.runOnce();
    await agent.runOnce();
    await settle();
    expect(forgetFn).toHaveBeenCalledTimes(8);
    await agent.runOnce();
    expect(outcomesOn(c, 2).map((o) => o.id)).toStrictEqual(ids);
    await settle();
    expect(forgetFn).toHaveBeenCalledTimes(9);
  });

  it("does not run a command again when its id comes back while it is still running", async () => {
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        reply({ bluetoothCommands: [pair("c1")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce();
    held.release();
    await settle();
    expect(held.fn).toHaveBeenCalledTimes(1);
  });

  it("runs a command id it has already run only once, and reports it once", async () => {
    const pairFn = vi.fn(async () => ({ ok: true }));
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: pairFn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        reply({ bluetoothCommands: [pair("c1")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    for (let i = 0; i < 3; i++) {
      await agent.runOnce();
      await settle();
    }
    expect(pairFn).toHaveBeenCalledTimes(1);
    expect(outcomesOn(c, 1)).toStrictEqual([{ id: "c1", ok: true }]);
    expect(outcomesOn(c, 2)).toStrictEqual([]);
  });

  it("keeps an outcome through a failed pull and drops it only after a successful pull carried it", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: async () => ({ ok: true }) });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        failR({ kind: "unreachable", detail: "status 503" }),
        failR({ kind: "bad_reply", detail: "not json" }),
      ),
    });
    const agent = createAgent({ host, client: c });
    for (let i = 0; i < 5; i++) {
      await agent.runOnce();
      await settle();
    }
    expect(outcomesOn(c, 1)).toStrictEqual([{ id: "c1", ok: true }]);
    expect(outcomesOn(c, 2)).toStrictEqual([{ id: "c1", ok: true }]);
    expect(outcomesOn(c, 3)).toStrictEqual([{ id: "c1", ok: true }]);
    expect(outcomesOn(c, 4)).toStrictEqual([]);
  });

  it("after a lost reply, resends the outcome but does not run the resent command again", async () => {
    const pairFn = vi.fn(async () => ({ ok: false, error: "pairing timed out" }));
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: pairFn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        // The server stored the outcome, but its reply never arrived.
        failR({ kind: "unreachable", detail: "timeout" }),
        // A server that had NOT stored it would send the command again.
        reply({ bluetoothCommands: [pair("c1")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    for (let i = 0; i < 4; i++) {
      await agent.runOnce();
      await settle();
    }
    const failed = { id: "c1", ok: false, error: "pairing timed out" };
    expect(outcomesOn(c, 1)).toStrictEqual([failed]);
    expect(outcomesOn(c, 2)).toStrictEqual([failed]);
    expect(outcomesOn(c, 3)).toStrictEqual([]);
    expect(pairFn).toHaveBeenCalledTimes(1);
  });

  it("holds at most eight commands between arrival and a delivered outcome; a ninth waits to be sent again", async () => {
    const forgetFn = vi.fn(async () => ({ ok: true }));
    const host = fakeHost({ config: CONFIG, token: "a1.s", forgetBluetooth: forgetFn });
    const ids = Array.from({ length: 9 }, (_, i) => `c${i + 1}`);
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: ids.map(forget) }),
        reply({ bluetoothCommands: [forget("c9")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    expect(forgetFn).toHaveBeenCalledTimes(8);
    // This pull delivers c1..c8, which frees the room the resent c9 is then taken into.
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    expect(outcomesOn(c, 1).map((o) => o.id)).toStrictEqual(ids.slice(0, 8));
    expect(outcomesOn(c, 2)).toStrictEqual([{ id: "c9", ok: true }]);
    expect(forgetFn).toHaveBeenCalledTimes(9);
  });

  it("remembers the last eight command ids: a ninth forgets the oldest, which would then run again", async () => {
    const forgetFn = vi.fn(async () => ({ ok: true }));
    const host = fakeHost({ config: CONFIG, token: "a1.s", forgetBluetooth: forgetFn });
    const ids = Array.from({ length: 8 }, (_, i) => `c${i + 1}`);
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: ids.map(forget) }),
        reply(),
        reply({ bluetoothCommands: [forget("c9")] }),
        reply({ bluetoothCommands: [forget("c2"), forget("c1")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    for (let i = 0; i < 5; i++) {
      await agent.runOnce();
      await settle();
    }
    // c2 is still remembered; c1 was forgotten when c9 arrived, so it runs a second time.
    expect(forgetFn).toHaveBeenCalledTimes(10);
    expect(outcomesOn(c, 4)).toStrictEqual([{ id: "c1", ok: true }]);
  });

  it("wakes a sleeping loop to send an outcome as soon as its command finishes", async () => {
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    host.sleep = () => new Promise(() => {});
    const pulls = scripted(reply({ bluetoothCommands: [pair("c1")] }));
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    const loop = agent.start();
    await settle();
    expect(pulls).toHaveBeenCalledTimes(1);
    held.release();
    await settle();
    expect(pulls).toHaveBeenCalledTimes(2);
    expect(outcomesOn({ pullJobs: pulls } as unknown as AgentClient, 1)).toStrictEqual([
      { id: "c1", ok: true },
    ]);
    agent.stop();
    await loop;
  });

  it("setup controls do not wait for a running Pair, and a reset drops its outcome", async () => {
    const held = heldPair();
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: held.fn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1"), pair("c2")] }),
        failR({ kind: "unreachable", detail: "gone" }),
        failR({ kind: "unauthorized" }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await agent.runOnce(); // out of touch
    expect(await agent.beginNetworkReset()).toBe(true);
    expect(await agent.cancelNetworkReset()).toBe(true);
    await agent.runOnce(); // unauthorized → halted, token cleared
    expect(await agent.configure({ serverUrl: A, name: "kitchen-pi" })).toBe(true);
    held.release();
    await settle();
    // c2 was queued behind the running c1 and the reset dropped it, so it never starts.
    expect(held.fn).toHaveBeenCalledTimes(1);
    await agent.runOnce(); // joins → pending
    await agent.runOnce(); // approved → pulls
    expect(outcomesOn(c, 3)).toStrictEqual([]);
  });

  it("forgets queued outcomes and remembered ids when setup starts the agent over", async () => {
    const pairFn = vi.fn(async () => ({ ok: true }));
    const host = fakeHost({ config: CONFIG, token: "a1.s", pair: pairFn });
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        failR({ kind: "unauthorized" }),
        reply({ bluetoothCommands: [pair("c1")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    expect(outcomesOn(c, 1)).toStrictEqual([{ id: "c1", ok: true }]);
    expect(await agent.configure({ serverUrl: A, name: "kitchen-pi" })).toBe(true);
    await agent.runOnce(); // joins → pending
    await agent.runOnce(); // approved → pulls
    await settle();
    expect(outcomesOn(c, 2)).toStrictEqual([]);
    expect(pairFn).toHaveBeenCalledTimes(2);
  });

  it("a logger that throws inside the command worker neither escapes nor stops later commands", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      pair: async () => ({ ok: false, error: "pairing timed out" }),
    });
    host.log.warn = () => {
      throw new Error("log sink closed");
    };
    const c = client({
      pullJobs: scripted(
        reply({ bluetoothCommands: [pair("c1")] }),
        reply({ bluetoothCommands: [pair("c2")] }),
      ),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    await settle();
    expect(host.calls.filter((call) => call === "pair")).toHaveLength(2);
  });
});

describe("createAgent — A4 page jobs", () => {
  const PAGE_JOB: PageJob = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    generation: 2,
    token: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    printer: {
      id: "p-office",
      host: "192.168.20.40",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
    },
  };
  const TARGET = { host: "192.168.20.40", port: 631, resourcePath: "/ipp/print" };
  const SENT: PagePrintOutcome = { status: "sent" };
  const UNCERTAIN_OUTCOME: PagePrintOutcome = { status: "unknown", failureCode: "timeout" };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const receipt = (id: string): WireJob => ({
    id,
    printerId: "p-receipt",
    transport: "usb",
    host: null,
    port: null,
    localKey: "SN-1",
    payload: new Uint8Array([7]),
  });
  const pull = (jobs: WireJob[] = []) =>
    okR<PullReply>({ nodeId: "n1", servers: [], jobs, discoveryUntil: null });

  /** Renewal waits are held until the test releases them; any other sleep never ends. */
  function pageHost(printPage: Host["printPage"], extra: Parameters<typeof fakeHost>[0] = {}) {
    const renewals: ReturnType<typeof deferred<void>>[] = [];
    const others: { ms: number; wait: ReturnType<typeof deferred<void>> }[] = [];
    const sleeps: number[] = [];
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      sleep: (ms) => {
        sleeps.push(ms);
        const wait = deferred();
        if (ms === PAGE_RENEW_INTERVAL_MS) renewals.push(wait);
        else others.push({ ms, wait });
        return wait.promise;
      },
      ...(printPage === undefined ? {} : { printPage }),
      ...extra,
    });
    return { host, renewals, others, sleeps };
  }

  it("a host without printPage claims nothing", async () => {
    const { host } = pageHost(undefined);
    const c = client();
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(c.pullJobs).toHaveBeenCalledTimes(1);
    expect(c.claimPageJob).not.toHaveBeenCalled();
  });

  it("claims after a pull, fetches the claimed pages, prints them and reports the outcome", async () => {
    const printPage = vi.fn(async () => SENT);
    const { host } = pageHost(printPage);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(c.claimPageJob).toHaveBeenCalledWith(A, "a1.s");
    expect(c.fetchPageDocument).toHaveBeenCalledWith(A, "a1.s", PAGE_JOB);
    expect(printPage).toHaveBeenCalledWith(
      TARGET,
      new Uint8Array([0x25, 0x50]),
      "application/pdf",
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "sent",
    });
    // The next job is claimed as soon as this one is reported.
    const [reported] = vi.mocked(c.reportPageJob).mock.invocationCallOrder;
    expect(vi.mocked(c.claimPageJob).mock.invocationCallOrder.at(-1)).toBeGreaterThan(reported!);
  });

  it("a receipt job pulled during a long A4 job prints at once, and the pull still claims", async () => {
    const printing = deferred<PagePrintOutcome>();
    const printPage = vi.fn(() => printing.promise);
    const sink = new FakeSink();
    const { host } = pageHost(printPage, { transport: sink });
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      pullJobs: vi
        .fn()
        .mockResolvedValueOnce(pull())
        .mockResolvedValue(pull([receipt("r1")])),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    expect(printPage).toHaveBeenCalledTimes(1);
    const claimsBefore = vi.mocked(c.claimPageJob).mock.calls.length;

    await agent.runOnce();
    expect(sink.written).toEqual([{ printerId: "p-receipt", bytes: new Uint8Array([7]) }]);
    expect(c.report).toHaveBeenCalledWith(A, "a1.s", "r1", { status: "done" });
    expect(c.claimPageJob).toHaveBeenCalledTimes(claimsBefore + 1);
    expect(printPage).toHaveBeenCalledTimes(1);
    expect(c.reportPageJob).not.toHaveBeenCalled();

    printing.resolve(SENT);
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledTimes(1);
  });

  it("renews the claim every 20 seconds while the job is out, and stops when it ends", async () => {
    const printing = deferred<PagePrintOutcome>();
    const { host, renewals, sleeps } = pageHost(() => printing.promise);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(PAGE_RENEW_INTERVAL_MS).toBe(20_000);
    expect(sleeps).toEqual([20_000]);
    expect(c.renewPageJob).not.toHaveBeenCalled();

    renewals[0]!.resolve();
    await settle();
    expect(c.renewPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, null);
    renewals[1]!.resolve();
    await settle();
    expect(c.renewPageJob).toHaveBeenCalledTimes(2);

    printing.resolve(SENT);
    await settle();
    renewals[2]!.resolve();
    await settle();
    expect(c.renewPageJob).toHaveBeenCalledTimes(2);
    expect(renewals).toHaveLength(3);
  });

  it("keeps renewing past a renewal that did not get through", async () => {
    const printing = deferred<PagePrintOutcome>();
    const { host, renewals } = pageHost(() => printing.promise);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      renewPageJob: renewer([failR({ kind: "unreachable", detail: "ECONNRESET" })]),
    });
    let signal: AbortSignal | undefined;
    host.printPage = (_target, _bytes, _format, given) => {
      signal = given;
      return printing.promise;
    };
    await createAgent({ host, client: c }).runOnce();
    await settle();
    renewals[0]!.resolve();
    await settle();
    expect(signal!.aborted).toBe(false);
    renewals[1]!.resolve();
    await settle();
    expect(c.renewPageJob).toHaveBeenCalledTimes(2);
    printing.resolve(SENT);
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledWith(A, "a1.s", PAGE_JOB, { status: "sent" });
  });

  it("a lost renewal stops the polling and still reports the outcome once", async () => {
    const printing = deferred<PagePrintOutcome>();
    let signal: AbortSignal | undefined;
    const { host, renewals } = pageHost((_target, _bytes, _format, given) => {
      signal = given;
      given.addEventListener("abort", () =>
        printing.resolve({ status: "unknown", failureCode: "timeout" }),
      );
      return printing.promise;
    });
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      renewPageJob: renewer([failR({ kind: "claim_lost" })]),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(signal!.aborted).toBe(false);
    renewals[0]!.resolve();
    await settle();
    expect(signal!.aborted).toBe(true);
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "unknown",
      failureCode: "timeout",
    });
    expect(renewals).toHaveLength(1);
  });

  it("a claim lost while the pages are fetched prints nothing and reports that nothing was sent", async () => {
    const fetching = deferred<Result<Uint8Array>>();
    const printPage = vi.fn(async () => SENT);
    const { host, renewals } = pageHost(printPage);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      fetchPageDocument: vi.fn(() => fetching.promise),
      renewPageJob: renewer([failR({ kind: "claim_lost" })]),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    renewals[0]!.resolve();
    await settle();
    fetching.resolve(okR(new Uint8Array([1])));
    await settle();
    expect(printPage).not.toHaveBeenCalled();
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "failed",
      failureCode: "document_unavailable",
    });
  });

  it.each([
    failR({ kind: "unreachable", detail: "timed out" }),
    failR({ kind: "claim_lost" }),
    failR({ kind: "bad_reply", detail: "status 400" }),
  ])("a failed fetch prints nothing and reports failed (%j)", async (fetched) => {
    const printPage = vi.fn(async () => SENT);
    const { host } = pageHost(printPage);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      fetchPageDocument: vi.fn(async () => fetched),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(printPage).not.toHaveBeenCalled();
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "failed",
      failureCode: "document_unavailable",
    });
  });

  it("a printPage that throws reports an uncertain outcome, never a resend", async () => {
    const printPage = vi.fn(async () => {
      throw new Error("socket closed");
    });
    const { host } = pageHost(printPage);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(printPage).toHaveBeenCalledTimes(1);
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "unknown",
      failureCode: "timeout",
    });
  });

  it.each([
    failR({ kind: "unreachable", detail: "ECONNRESET" }),
    failR({ kind: "rate_limited" }),
    failR({ kind: "pairing_closed" }),
  ])(
    "a report that does not get through (%j) is retried on the next tick with the same claim, and claiming goes on",
    async (dropped) => {
      const printPage = vi.fn(async (): Promise<PagePrintOutcome> => ({
        status: "unknown",
        failureCode: "printer_aborted",
      }));
      const { host } = pageHost(printPage);
      const reportPageJob = vi
        .fn()
        .mockResolvedValueOnce(dropped)
        .mockResolvedValueOnce(dropped)
        .mockResolvedValue(okR(undefined));
      const c = client({
        claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
        reportPageJob,
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      expect(host.logs.some((l) => l.includes("page job report dropped"))).toBe(true);
      const claimsBefore = vi.mocked(c.claimPageJob).mock.calls.length;

      await agent.runOnce();
      await settle();
      expect(reportPageJob).toHaveBeenCalledTimes(2);
      expect(c.claimPageJob).toHaveBeenCalledTimes(claimsBefore + 1);

      await agent.runOnce();
      await settle();
      const expected: PageJobOutcome = { status: "unknown", failureCode: "printer_aborted" };
      expect(reportPageJob.mock.calls).toEqual([
        [A, "a1.s", PAGE_JOB, expected],
        [A, "a1.s", PAGE_JOB, expected],
        [A, "a1.s", PAGE_JOB, expected],
      ]);
      expect(printPage).toHaveBeenCalledTimes(1);
      expect(c.claimPageJob).toHaveBeenCalledTimes(claimsBefore + 2);
    },
  );

  it.each([
    failR({ kind: "claim_lost" }),
    failR({ kind: "bad_reply", detail: "status 400" }),
    failR({ kind: "unauthorized" }),
  ])("a report the server answers (%j) is final and never sent again", async (answer) => {
    const { host } = pageHost(vi.fn(async () => SENT));
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      reportPageJob: vi.fn(async () => answer),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    await agent.runOnce();
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledTimes(1);
    // The first pull claims the job and then the server's none, the job's end claims again, and
    // the second pull once more.
    expect(c.claimPageJob).toHaveBeenCalledTimes(4);
    expect(host.logs.some((l) => l.includes("page job report refused"))).toBe(true);
  });

  it("claims nothing after a failed pull", async () => {
    const { host } = pageHost(vi.fn(async () => SENT));
    const c = client({ pullJobs: vi.fn(async () => failR({ kind: "unreachable", detail: "x" })) });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(c.claimPageJob).not.toHaveBeenCalled();
  });

  it("a failed claim waits for the next pull", async () => {
    const { host } = pageHost(vi.fn(async () => SENT));
    const c = client({
      claimPageJob: vi.fn(async () => failR({ kind: "unreachable", detail: "x" })),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    expect(c.claimPageJob).toHaveBeenCalledTimes(1);
    await agent.runOnce();
    await settle();
    expect(c.claimPageJob).toHaveBeenCalledTimes(2);
  });

  it("still prints and reports when the host's renewal wait rejects", async () => {
    const printing = deferred<PagePrintOutcome>();
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      printPage: () => printing.promise,
      sleep: async () => {
        throw new Error("no timers");
      },
    });
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    printing.resolve(SENT);
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "sent",
    });
    expect(host.logs).toContain(
      `warn page job renewal stopped {"job":"${PAGE_JOB.id}","error":"no timers"}`,
    );
  });

  it("still reports when the renewal wait rejects and logging that throws too", async () => {
    const host = fakeHost({
      config: CONFIG,
      token: "a1.s",
      printPage: async () => SENT,
      sleep: async () => {
        throw new Error("no timers");
      },
    });
    host.log.warn = () => {
      throw new Error("log closed");
    };
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "sent",
    });
  });

  it("waits at most 5 seconds for a renewal still out when the job ends, then reports", async () => {
    const printing = deferred<PagePrintOutcome>();
    const { host, renewals, others } = pageHost(() => printing.promise);
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      renewPageJob: vi.fn(() => new Promise<never>(() => {})),
    });
    await createAgent({ host, client: c }).runOnce();
    await settle();
    renewals[0]!.resolve();
    await settle();
    expect(c.renewPageJob).toHaveBeenCalledTimes(1);
    printing.resolve(SENT);
    await settle();
    expect(c.reportPageJob).not.toHaveBeenCalled();
    expect(PAGE_RENEW_SETTLE_MS).toBe(5_000);
    expect(others.map(({ ms }) => ms)).toEqual([5_000]);
    others[0]!.wait.resolve();
    await settle();
    expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(A, "a1.s", PAGE_JOB, {
      status: "sent",
    });
  });

  it("gives up resending a report two leases after the claim was last known alive, claiming meanwhile", async () => {
    let clock = 1_000;
    const printing = deferred<PagePrintOutcome>();
    const { host, renewals } = pageHost(() => printing.promise, { now: () => clock });
    const reportPageJob = vi.fn(async () => failR({ kind: "unreachable", detail: "status 503" }));
    const c = client({
      claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      reportPageJob,
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    // A renewal that got through at 50 s moves the bound on.
    clock = 50_000;
    renewals[0]!.resolve();
    await settle();
    printing.resolve(SENT);
    await settle();
    expect(reportPageJob).toHaveBeenCalledTimes(1);

    expect(PAGE_REPORT_GIVE_UP_MS).toBe(120_000);
    clock = 1_000 + PAGE_REPORT_GIVE_UP_MS + 1;
    await agent.runOnce();
    await settle();
    clock = 50_000 + PAGE_REPORT_GIVE_UP_MS;
    await agent.runOnce();
    await settle();
    expect(reportPageJob).toHaveBeenCalledTimes(3);
    const claimsBefore = vi.mocked(c.claimPageJob).mock.calls.length;

    clock += 1;
    await agent.runOnce();
    await settle();
    expect(reportPageJob).toHaveBeenCalledTimes(3);
    expect(host.logs).toContain(`warn page job report abandoned {"delivery":"${PAGE_JOB.id}"}`);
    expect(c.claimPageJob).toHaveBeenCalledTimes(claimsBefore + 1);
  });

  it("logs a runner that throws and claims again on the next pull", async () => {
    const { host } = pageHost(vi.fn(async () => SENT));
    const c = client({
      claimPageJob: vi
        .fn()
        .mockRejectedValueOnce(new Error("client bug"))
        .mockResolvedValue(okR(null)),
    });
    const agent = createAgent({ host, client: c });
    await agent.runOnce();
    await settle();
    expect(host.logs).toContain('error page job runner failed {"error":"client bug"}');
    await agent.runOnce();
    await settle();
    expect(c.claimPageJob).toHaveBeenCalledTimes(2);
  });

  describe("one job per printer, side by side", () => {
    const JOB_Y: PageJob = {
      ...PAGE_JOB,
      id: "9b2d1c4e-5f6a-4b7c-8d9e-0a1b2c3d4e5f",
      token: "3e7a9c1b-2d4f-4a6b-8c0d-1e2f3a4b5c6d",
      printer: { ...PAGE_JOB.printer, id: "p-office-2", host: "192.168.20.41" },
    };
    const TARGET_Y = { ...TARGET, host: "192.168.20.41" };

    /** The server's due jobs, handed out oldest first; an empty queue answers 204. */
    function serverQueue(...jobs: PageJob[]) {
      const due = [...jobs];
      const claimPageJob = vi.fn(async (): Promise<Result<PageJob | null>> =>
        okR(due.shift() ?? null),
      );
      return { due, claimPageJob };
    }

    /** Printers by host: each print waits on its own outcome until the test settles it. */
    function printers() {
      const outcomes = new Map<string, ReturnType<typeof deferred<PagePrintOutcome>>>();
      const printPage = vi.fn((target: { host: string }) => {
        const outcome = deferred<PagePrintOutcome>();
        outcomes.set(target.host, outcome);
        return outcome.promise;
      });
      return { printPage, finish: (host: string) => outcomes.get(host)!.resolve(SENT) };
    }

    const reportedIds = (reportPageJob: AgentClient["reportPageJob"]) =>
      vi.mocked(reportPageJob).mock.calls.map(([, , job]) => job.id);

    it("prints and reports a job on another printer while a long job on the first is out", async () => {
      const { printPage, finish } = printers();
      const { host } = pageHost(printPage);
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const c = client({ claimPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      expect(printPage).toHaveBeenCalledTimes(1);

      due.push(JOB_Y);
      await agent.runOnce();
      await settle();
      expect(printPage).toHaveBeenLastCalledWith(
        TARGET_Y,
        new Uint8Array([0x25, 0x50]),
        "application/pdf",
        expect.any(AbortSignal),
        expect.any(Function),
      );
      finish(TARGET_Y.host);
      await settle();
      expect(reportedIds(c.reportPageJob)).toEqual([JOB_Y.id]);

      finish(TARGET.host);
      await settle();
      expect(reportedIds(c.reportPageJob)).toEqual([JOB_Y.id, PAGE_JOB.id]);
    });

    it("starts each claimed job without waiting for it, and claims until the server has none", async () => {
      const { printPage } = printers();
      const { host } = pageHost(printPage);
      const { claimPageJob } = serverQueue(PAGE_JOB, JOB_Y);
      const c = client({ claimPageJob });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      expect(printPage.mock.calls.map(([target]) => target)).toEqual([TARGET, TARGET_Y]);
      expect(claimPageJob).toHaveBeenCalledTimes(3);
      expect(c.reportPageJob).not.toHaveBeenCalled();
    });

    it("prints a receipt at once while jobs on two printers are out", async () => {
      const { printPage } = printers();
      const sink = new FakeSink();
      const { host } = pageHost(printPage, { transport: sink });
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const c = client({
        claimPageJob,
        pullJobs: vi
          .fn()
          .mockResolvedValueOnce(pull())
          .mockResolvedValueOnce(pull([receipt("r1")]))
          .mockResolvedValue(pull([receipt("r2")])),
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      due.push(JOB_Y);
      await agent.runOnce();
      await settle();
      expect(printPage).toHaveBeenCalledTimes(2);
      await agent.runOnce();
      expect(sink.written.map(({ bytes }) => bytes)).toEqual([
        new Uint8Array([7]),
        new Uint8Array([7]),
      ]);
      expect(vi.mocked(c.report).mock.calls.map(([, , id]) => id)).toEqual(["r1", "r2"]);
      expect(c.reportPageJob).not.toHaveBeenCalled();
    });

    it("keeps claiming and printing on another printer while a report is unsent", async () => {
      const { printPage, finish } = printers();
      const { host } = pageHost(printPage);
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const reportPageJob = vi.fn(async (_url: string, _token: string, job: PageJob) =>
        job.id === PAGE_JOB.id
          ? failR({ kind: "unreachable", detail: "ECONNRESET" })
          : okR(undefined),
      );
      const c = client({ claimPageJob, reportPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      finish(TARGET.host);
      await settle();
      expect(reportedIds(reportPageJob)).toEqual([PAGE_JOB.id]);

      due.push(JOB_Y);
      await agent.runOnce();
      await settle();
      expect(printPage).toHaveBeenCalledTimes(2);
      finish(TARGET_Y.host);
      await settle();
      expect(reportedIds(reportPageJob)).toEqual([PAGE_JOB.id, PAGE_JOB.id, JOB_Y.id]);
    });

    it("keeps each unsent report, resends each on the next pull with its own claim, and drops each at its own give-up time", async () => {
      let clock = 1_000;
      const { printPage, finish } = printers();
      const { host } = pageHost(printPage, { now: () => clock });
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const reportPageJob = vi.fn(async () => failR({ kind: "unreachable", detail: "status 503" }));
      const c = client({ claimPageJob, reportPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      finish(TARGET.host);
      await settle();

      clock = 30_000;
      due.push(JOB_Y);
      await agent.runOnce();
      await settle();
      finish(TARGET_Y.host);
      await settle();
      expect(reportedIds(reportPageJob)).toEqual([PAGE_JOB.id, PAGE_JOB.id, JOB_Y.id]);

      clock = 1_000 + PAGE_REPORT_GIVE_UP_MS;
      await agent.runOnce();
      await settle();
      expect(reportedIds(reportPageJob).slice(3)).toEqual([PAGE_JOB.id, JOB_Y.id]);
      // Each resend carries its own job's claim token.
      expect(
        vi
          .mocked(c.reportPageJob)
          .mock.calls.slice(3)
          .map(([, , job]) => job),
      ).toEqual([PAGE_JOB, JOB_Y]);

      clock = 1_000 + PAGE_REPORT_GIVE_UP_MS + 1;
      await agent.runOnce();
      await settle();
      expect(reportedIds(reportPageJob).slice(5)).toEqual([JOB_Y.id]);
      expect(host.logs).toContain(`warn page job report abandoned {"delivery":"${PAGE_JOB.id}"}`);

      clock = 30_000 + PAGE_REPORT_GIVE_UP_MS + 1;
      await agent.runOnce();
      await settle();
      expect(reportedIds(reportPageJob)).toHaveLength(6);
      expect(host.logs).toContain(`warn page job report abandoned {"delivery":"${JOB_Y.id}"}`);
    });

    it("gives up each kept report by its own last-alive time, not by its place in the list", async () => {
      let clock = 1_000;
      const { printPage, finish } = printers();
      const { host, renewals } = pageHost(printPage, { now: () => clock });
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const reportPageJob = vi.fn(async () => failR({ kind: "unreachable", detail: "status 503" }));
      const c = client({ claimPageJob, reportPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      clock = 5_000;
      due.push(JOB_Y);
      await agent.runOnce();
      await settle();
      // Only the first printer's job renews, so its claim is known alive later than the second's.
      clock = 50_000;
      renewals[0]!.resolve();
      await settle();
      finish(TARGET.host);
      await settle();
      finish(TARGET_Y.host);
      await settle();
      expect(reportedIds(c.reportPageJob)).toEqual([PAGE_JOB.id, JOB_Y.id]);

      clock = 5_000 + PAGE_REPORT_GIVE_UP_MS + 1;
      await agent.runOnce();
      await settle();
      expect(reportedIds(c.reportPageJob).slice(2)).toEqual([PAGE_JOB.id]);
      expect(host.logs).toContain(`warn page job report abandoned {"delivery":"${JOB_Y.id}"}`);
      expect(host.logs).not.toContain(
        `warn page job report abandoned {"delivery":"${PAGE_JOB.id}"}`,
      );
    });

    it("never runs two claim loops for two pulls in a row", async () => {
      const answer = deferred<Result<PageJob | null>>();
      const claimPageJob = vi.fn(() => answer.promise);
      const { host } = pageHost(vi.fn(async () => SENT));
      const c = client({ claimPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await agent.runOnce();
      await settle();
      expect(c.pullJobs).toHaveBeenCalledTimes(2);
      expect(claimPageJob).toHaveBeenCalledTimes(1);
      answer.resolve(okR(null));
      await settle();
      expect(claimPageJob).toHaveBeenCalledTimes(1);
    });

    it("a finished job's report wakes the claim loop, without a pull", async () => {
      const { printPage, finish } = printers();
      const { host } = pageHost(printPage);
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const c = client({ claimPageJob });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      due.push(JOB_Y);
      finish(TARGET.host);
      await settle();
      expect(c.pullJobs).toHaveBeenCalledTimes(1);
      expect(printPage.mock.calls.map(([target]) => target)).toEqual([TARGET, TARGET_Y]);
      const [reported] = vi.mocked(c.reportPageJob).mock.invocationCallOrder;
      expect(claimPageJob.mock.invocationCallOrder.at(-1)).toBeGreaterThan(reported!);
    });

    it("claims once more when a job ends while a claim loop is still waiting on the server", async () => {
      const { printPage, finish } = printers();
      const { host } = pageHost(printPage);
      const due: PageJob[] = [PAGE_JOB];
      const held = deferred();
      let holdNext = false;
      const claimPageJob = vi.fn(async (): Promise<Result<PageJob | null>> => {
        if (holdNext) {
          holdNext = false;
          await held.promise;
          return okR(null);
        }
        return okR(due.shift() ?? null);
      });
      const c = client({ claimPageJob });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      holdNext = true;
      await agent.runOnce();
      await settle();
      // The server answered this claim before the job's report freed the printer.
      finish(TARGET.host);
      await settle();
      due.push(JOB_Y);
      held.resolve();
      await settle();
      expect(printPage.mock.calls.map(([target]) => target)).toEqual([TARGET, TARGET_Y]);
    });

    it("logs a job that throws, and still claims again", async () => {
      const { host } = pageHost(vi.fn(async () => SENT));
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const fetchPageDocument = vi
        .fn()
        .mockImplementationOnce(async () => {
          due.push(JOB_Y);
          throw new Error("client bug");
        })
        .mockResolvedValue(okR(new Uint8Array([1])));
      const c = client({ claimPageJob, fetchPageDocument });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      expect(host.logs).toContain(
        `error page job failed {"job":"${PAGE_JOB.id}","error":"client bug"}`,
      );
      expect(reportedIds(c.reportPageJob)).toEqual([JOB_Y.id]);
    });

    it("a job whose failure log throws still frees the claim loop", async () => {
      const { host } = pageHost(vi.fn(async () => SENT));
      host.log.error = () => {
        throw new Error("log closed");
      };
      const { due, claimPageJob } = serverQueue(PAGE_JOB);
      const fetchPageDocument = vi
        .fn()
        .mockImplementationOnce(async () => {
          due.push(JOB_Y);
          throw new Error("client bug");
        })
        .mockResolvedValue(okR(new Uint8Array([1])));
      const c = client({ claimPageJob, fetchPageDocument });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      expect(reportedIds(c.reportPageJob)).toEqual([JOB_Y.id]);
    });
  });

  describe("the printer's hold rides each renewal", () => {
    type OnHold = (hold: PageHold | null) => void;

    /** One held print per printer host: the test reports holds through it and settles it. */
    function holdingPrinters() {
      const jobs = new Map<
        string,
        {
          onHold: OnHold;
          signal: AbortSignal;
          outcome: ReturnType<typeof deferred<PagePrintOutcome>>;
        }
      >();
      const printPage = vi.fn(
        (
          target: { host: string },
          _bytes: Uint8Array,
          _format: string,
          signal: AbortSignal,
          onHold?: OnHold,
        ) => {
          const outcome = deferred<PagePrintOutcome>();
          jobs.set(target.host, { onHold: (hold) => onHold?.(hold), signal, outcome });
          return outcome.promise;
        },
      );
      return { printPage, job: (host: string) => jobs.get(host)! };
    }

    const renewedHolds = (c: AgentClient) =>
      vi.mocked(c.renewPageJob).mock.calls.map(([, , job, hold]) => [job.id, hold]);

    it("carries the last hold the printer reported in the next renewal, and null once it clears", async () => {
      const { printPage, job } = holdingPrinters();
      const { host, renewals } = pageHost(printPage);
      const c = client({
        claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
      });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      renewals[0]!.resolve();
      await settle();
      expect(renewedHolds(c)).toEqual([[PAGE_JOB.id, null]]);

      job(TARGET.host).onHold("paper_out");
      await settle();
      // A change in the hold sends nothing of its own: the next renewal carries it.
      expect(c.renewPageJob).toHaveBeenCalledTimes(1);
      renewals[1]!.resolve();
      await settle();
      expect(renewedHolds(c)).toEqual([
        [PAGE_JOB.id, null],
        [PAGE_JOB.id, "paper_out"],
      ]);

      job(TARGET.host).onHold(null);
      renewals[2]!.resolve();
      await settle();
      expect(renewedHolds(c).at(-1)).toEqual([PAGE_JOB.id, null]);
    });

    it("carries each job's own hold when two printers hold two jobs", async () => {
      const JOB_Y: PageJob = {
        ...PAGE_JOB,
        id: "9b2d1c4e-5f6a-4b7c-8d9e-0a1b2c3d4e5f",
        token: "3e7a9c1b-2d4f-4a6b-8c0d-1e2f3a4b5c6d",
        printer: { ...PAGE_JOB.printer, id: "p-office-2", host: "192.168.20.41" },
      };
      const { printPage, job } = holdingPrinters();
      const { host, renewals } = pageHost(printPage);
      const c = client({
        claimPageJob: vi
          .fn()
          .mockResolvedValueOnce(okR(PAGE_JOB))
          .mockResolvedValueOnce(okR(JOB_Y))
          .mockResolvedValue(okR(null)),
      });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      expect(printPage).toHaveBeenCalledTimes(2);
      job(TARGET.host).onHold("paper_out");
      job(JOB_Y.printer.host).onHold("paper_jam");
      for (const wait of renewals.splice(0)) wait.resolve();
      await settle();
      expect(renewedHolds(c)).toEqual(
        expect.arrayContaining([
          [PAGE_JOB.id, "paper_out"],
          [JOB_Y.id, "paper_jam"],
        ]),
      );
      expect(c.renewPageJob).toHaveBeenCalledTimes(2);

      job(JOB_Y.printer.host).onHold(null);
      for (const wait of renewals.splice(0)) wait.resolve();
      await settle();
      expect(renewedHolds(c).slice(2)).toEqual(
        expect.arrayContaining([
          [PAGE_JOB.id, "paper_out"],
          [JOB_Y.id, null],
        ]),
      );
      expect(c.renewPageJob).toHaveBeenCalledTimes(4);
    });

    it("a job held past the report give-up time, renewed meanwhile, still has its unsent report resent, not abandoned", async () => {
      let clock = 1_000;
      const { printPage, job } = holdingPrinters();
      const { host, renewals } = pageHost(printPage, { now: () => clock });
      const reportPageJob = vi
        .fn<AgentClient["reportPageJob"]>()
        .mockResolvedValueOnce(failR({ kind: "unreachable", detail: "status 503" }))
        .mockResolvedValue(okR(undefined));
      const c = client({
        claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
        renewPageJob: renewer([], 20),
        reportPageJob,
      });
      const agent = createAgent({ host, client: c });
      await agent.runOnce();
      await settle();
      job(TARGET.host).onHold("paper_out");
      const renewalsHeld = PAGE_REPORT_GIVE_UP_MS / PAGE_RENEW_INTERVAL_MS + 2;
      for (let i = 0; i < renewalsHeld; i += 1) {
        clock += PAGE_RENEW_INTERVAL_MS;
        renewals[i]!.resolve();
        await settle();
      }
      // Counted from the claim, the give-up time has passed; counted from the last renewal, it has not.
      expect(clock - 1_000).toBeGreaterThan(PAGE_REPORT_GIVE_UP_MS);
      expect(renewedHolds(c)).toEqual(
        Array.from({ length: renewalsHeld }, () => [PAGE_JOB.id, "paper_out"]),
      );
      expect(job(TARGET.host).signal.aborted).toBe(false);
      expect(reportPageJob).not.toHaveBeenCalled();

      job(TARGET.host).onHold(null);
      job(TARGET.host).outcome.resolve(SENT);
      await settle();
      expect(reportPageJob).toHaveBeenCalledTimes(1);

      await agent.runOnce();
      await settle();
      expect(reportPageJob).toHaveBeenCalledTimes(2);
      expect(reportPageJob).toHaveBeenLastCalledWith(A, "a1.s", PAGE_JOB, { status: "sent" });
      expect(host.logs.filter((line) => line.includes("abandoned"))).toEqual([]);

      await agent.runOnce();
      await settle();
      expect(reportPageJob).toHaveBeenCalledTimes(2);
    });

    it("a claim lost while the printer holds the job stops following it and reports once", async () => {
      const { printPage, job } = holdingPrinters();
      const { host, renewals } = pageHost(printPage);
      const c = client({
        claimPageJob: vi.fn().mockResolvedValueOnce(okR(PAGE_JOB)).mockResolvedValue(okR(null)),
        renewPageJob: renewer([okR(undefined), failR({ kind: "claim_lost" })]),
      });
      await createAgent({ host, client: c }).runOnce();
      await settle();
      job(TARGET.host).onHold("paper_out");
      job(TARGET.host).signal.addEventListener("abort", () =>
        job(TARGET.host).outcome.resolve(UNCERTAIN_OUTCOME),
      );
      renewals[0]!.resolve();
      await settle();
      expect(job(TARGET.host).signal.aborted).toBe(false);
      renewals[1]!.resolve();
      await settle();
      expect(renewedHolds(c)).toEqual([
        [PAGE_JOB.id, "paper_out"],
        [PAGE_JOB.id, "paper_out"],
      ]);
      expect(job(TARGET.host).signal.aborted).toBe(true);
      expect(c.reportPageJob).toHaveBeenCalledExactlyOnceWith(
        A,
        "a1.s",
        PAGE_JOB,
        UNCERTAIN_OUTCOME,
      );
      expect(renewals).toHaveLength(2);
    });
  });
});
