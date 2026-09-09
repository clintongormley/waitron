import { describe, expect, it, vi } from "vitest";
import { createAgent } from "./agent.js";
import type { AgentClient, Failure, JoinStatus, NodeProbe, PullReply, Result } from "./client.js";
import { fakeHost } from "./testing/fake-host.js";
import { FakeSink } from "./transport.js";

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
    joinStatus: vi.fn(async () => okR<JoinStatus>("approved")),
    pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] })),
    report: vi.fn(async () => okR(undefined)),
    ...over,
  };
}

describe("createAgent — phases", () => {
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

describe("createAgent — push and report", () => {
  const job = (id: string) => ({
    id,
    printerId: "p1",
    transport: "network_tcp" as const,
    host: "10.0.0.9",
    port: 9100,
    usbPath: null,
    payload: new Uint8Array([7, 7]),
  });

  it("sends each job's bytes through the transport, in order, and reports done", async () => {
    const sink = new FakeSink();
    const host = fakeHost({ config: CONFIG, token: "a1.s", transport: sink });
    const c = client({
      pullJobs: vi.fn(async () =>
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] }),
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
        okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1"), job("j2")] }),
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
      .mockResolvedValueOnce(okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")] }))
      .mockResolvedValue(okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] }));
    const agent = createAgent({ host, client: client({ pullJobs: pulls }) });
    await agent.runOnce();
    expect(host.statuses.at(-1)?.lastError).toBe("no route"); // failed send stays visible
    await agent.runOnce();
    expect(host.statuses.at(-1)?.lastError).toBeUndefined(); // clean tick clears it
  });

  it("a report that cannot be delivered is logged and dropped (the lease reclaims)", async () => {
    const host = fakeHost({ config: CONFIG, token: "a1.s" });
    const c = client({
      pullJobs: vi.fn(async () => okR<PullReply>({ nodeId: "n1", servers: [], jobs: [job("j1")] })),
      report: vi.fn(async () => failR({ kind: "unreachable", detail: "gone" })),
    });
    await createAgent({ host, client: c }).runOnce();
    expect(c.report).toHaveBeenCalledTimes(1);
    expect(host.logs.some((l) => l.includes("report") && l.includes("j1"))).toBe(true);
    expect(host.statuses.at(-1)?.phase).toBe("running");
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
              usbPath: null,
              payload: new Uint8Array(),
            },
          ],
        }),
      )
      .mockResolvedValue(okR<PullReply>({ nodeId: "n1", servers: [], jobs: [] }));
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
