import { expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { PermissionContinuation } from "./permission-continuation.js";
import { createSessionEpoch, createSessionSignals } from "./session-signals.js";

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const epoch = createSessionEpoch();
  let identity = { authenticated: true, permissions: ["fiscal.view"] };
  const session = held<typeof identity>();
  const continuation = new PermissionContinuation({
    epoch: () => epoch,
    identity: () => identity,
    prepare: async () => true,
    open() {},
    close() {},
    suspend() {},
    changed() {},
    reconcile: async () => {
      identity = await session.promise;
    },
  });
  return { epoch, session, continuation };
}

it("a request sent during sign-in cannot count as activity after the new cookie completes", async () => {
  const { epoch, session, continuation } = fixture();
  const outcome = continuation.signIn({
    permission: "system.manage",
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(continuation.open).toBe(true));
  const target = new EventTarget();
  const activities: unknown[] = [];
  target.addEventListener("waitron-session-active", (event) =>
    activities.push((event as CustomEvent).detail),
  );
  const signals = createSessionSignals({ target, sessionGeneration: () => epoch.current() });
  const reply = held<Response>();
  const request = createRequest({
    sessionGeneration: () => epoch.current(),
    fetchImpl: () => reply.promise,
    onSuccess: signals.reportActivity,
  });
  const pending = request("/during-sign-in", "GET");
  continuation.complete();
  session.resolve({ authenticated: true, permissions: ["system.manage"] });
  await expect(outcome).resolves.toBe("signed-in");
  reply.resolve(
    new Response('{"value":"old-account-read"}', {
      headers: { "content-type": "application/json" },
    }),
  );
  await expect(pending).resolves.toEqual({ value: "old-account-read" });
  expect(activities).toEqual([]);
  continuation.disconnect();
});

it.each([false, true])(
  "completion reports the fresh authenticated state rather than the old signed-in state (%s)",
  async (authenticated) => {
    const { session, continuation } = fixture();
    const outcome = continuation.signIn({
      permission: "system.manage",
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(continuation.open).toBe(true));
    continuation.complete();
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    session.resolve({ authenticated, permissions: authenticated ? ["system.manage"] : [] });
    await expect(outcome).resolves.toBe(authenticated ? "signed-in" : "stopped");
    expect(continuation.snapshot().authenticated).toBe(authenticated);
    continuation.disconnect();
  },
);
