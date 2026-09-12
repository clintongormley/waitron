import { describe, expect, it, vi } from "vitest";
import { createAgent } from "./agent.js";
import type { AgentClient, Failure, JoinStatus, NodeProbe, PullReply, Result } from "./client.js";
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
      host: "printer-box.local",
    });
  });

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
    // Proves the placement: the block sits BEFORE the router probe and its `anyAccepting` gate (spec
    // §2). A self-enrol that only ran after that gate would be coupled to config.serverUrl being an
    // accepting primary — so here the probe reports none AND is never reached, yet the token is stored.
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
    await agent.runOnce(); // prior window open → scans and includes the results; this reply closes it
    expect(scan).toHaveBeenCalledTimes(1);
    expect(inventoryOf(c, 1).scanned).toEqual(scanned);
    await agent.runOnce(); // window closed → no further scan
    expect(scan).toHaveBeenCalledTimes(1);
    expect(inventoryOf(c, 2).scanned).toEqual([]);
  });

  it("a throwing discovery scan never blocks the job pull (isolated failure)", async () => {
    // The real box has no Bluetooth adapter, so scan(["bluetooth"]) throws `spawn bluetoothctl ENOENT`.
    // A scan failure inside an open window must be isolated: the tick still pulls jobs every time.
    const scan = vi.fn(async () => {
      throw new Error("spawn bluetoothctl ENOENT");
    });
    const host = fakeHost({ config: CONFIG, token: "a1.s", scan });
    // Every reply keeps the discovery window open (far-future instant), so ticks 2 and 3 both scan.
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
});
