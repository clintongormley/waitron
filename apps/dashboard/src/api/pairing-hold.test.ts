import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "./client.js";
import { PairingHold } from "./pairing-hold.js";

afterEach(() => vi.useRealTimers());

function fakeApi(over: Partial<DashboardApi> = {}) {
  const api = {
    takePairingHold: vi.fn().mockResolvedValue({ holdId: "h1", openUntil: "x" }),
    renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "y" }),
    releasePairingHold: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as DashboardApi;
  (api as { background: DashboardApi }).background = api;
  return api;
}

describe("PairingHold", () => {
  it("takes a hold, renews it every minute, and releases it on stop", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const changes: string[] = [];
    const hold = new PairingHold(
      () => api,
      (s) => changes.push(s),
      60_000,
    );
    await hold.start();
    expect(hold.holdId).toBe("h1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.renewPairingHold).toHaveBeenCalledWith("h1");
    hold.stop();
    expect(api.releasePairingHold).toHaveBeenCalledWith("h1");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(changes).toEqual(["held", "idle"]);
  });

  it("a stop given a promise releases the hold only once that promise settles, only once, and renews nothing meanwhile", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const changes: string[] = [];
    const hold = new PairingHold(
      () => api,
      (s) => changes.push(s),
      60_000,
    );
    await hold.start();
    let settle!: () => void;
    hold.stop(new Promise<void>((r) => (settle = r)));
    expect(hold.holdId).toBeNull();
    expect(changes).toEqual(["held", "idle"]);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(api.releasePairingHold).not.toHaveBeenCalled();
    expect(api.renewPairingHold).not.toHaveBeenCalled();
    settle();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1");
  });

  it("a stop given a promise releases the hold once that promise is refused", async () => {
    const api = fakeApi();
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    let refuse!: (error: unknown) => void;
    hold.stop(new Promise<void>((_, r) => (refuse = r)));
    expect(api.releasePairingHold).not.toHaveBeenCalled();
    refuse({ code: "connection.failed" });
    await vi.waitFor(() => expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1"));
  });

  it("a start after a stop given a promise leaves the handed-over hold alone", async () => {
    vi.useFakeTimers();
    const take = vi
      .fn()
      .mockResolvedValueOnce({ holdId: "h1", openUntil: "x" })
      .mockResolvedValueOnce({ holdId: "h2", openUntil: "x" });
    const api = fakeApi({ takePairingHold: take });
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    let settle!: () => void;
    hold.stop(new Promise<void>((r) => (settle = r)));
    await hold.start();
    expect(hold.holdId).toBe("h2");
    expect(api.releasePairingHold).not.toHaveBeenCalled();
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1");
    hold.stop();
    expect(api.releasePairingHold).toHaveBeenLastCalledWith("h2");
    expect(api.releasePairingHold).toHaveBeenCalledTimes(2);
  });

  it("reports a lapsed hold and stops renewing", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      renewPairingHold: vi.fn().mockRejectedValue({ code: "device.pairing_hold_lapsed" }),
    });
    const changes: string[] = [];
    const hold = new PairingHold(
      () => api,
      (s) => changes.push(s),
      60_000,
    );
    await hold.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(hold.status).toBe("lapsed");
    expect(hold.holdId).toBeNull();
  });

  it("stops renewing after a 401", async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      renewPairingHold: vi.fn().mockRejectedValue({ code: "management_session.expired" }),
    });
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.renewPairingHold).toHaveBeenCalledTimes(1);
    expect(hold.status).toBe("failed");
  });

  it("keeps renewing after a transient failure", async () => {
    vi.useFakeTimers();
    const renew = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue({ openUntil: "y" });
    const api = fakeApi({ renewPairingHold: renew });
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(hold.status).toBe("held");
  });

  it("releases a hold whose take answers after stop", async () => {
    let resolve!: (v: { holdId: string; openUntil: string }) => void;
    const api = fakeApi({
      takePairingHold: vi.fn(
        () => new Promise<{ holdId: string; openUntil: string }>((r) => (resolve = r)),
      ),
    });
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    const started = hold.start();
    hold.stop();
    resolve({ holdId: "late", openUntil: "x" });
    await started;
    expect(api.releasePairingHold).toHaveBeenCalledWith("late");
    expect(hold.holdId).toBeNull();
  });

  it("a second start after the first finished releases the first hold", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce({ holdId: "h1", openUntil: "x" })
      .mockResolvedValueOnce({ holdId: "h2", openUntil: "x" });
    const api = fakeApi({ takePairingHold: take });
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    await hold.start();
    expect(api.releasePairingHold).toHaveBeenCalledWith("h1");
    expect(hold.holdId).toBe("h2");
  });

  it("reports a refused take as failed with its code", async () => {
    const api = fakeApi({
      takePairingHold: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const seen: [string, string | null][] = [];
    const hold = new PairingHold(
      () => api,
      (s, e) => seen.push([s, e]),
      60_000,
    );
    await hold.start();
    expect(seen).toEqual([["failed", "authorization.not_permitted"]]);
  });

  it("hands the taken hold's lapse to the screen with the held status, and none with idle", async () => {
    const api = fakeApi({
      takePairingHold: vi
        .fn()
        .mockResolvedValue({ holdId: "h1", openUntil: "2026-09-08T10:20:00.000Z" }),
    });
    const seen: [string, string | null, string | null][] = [];
    const hold = new PairingHold(
      () => api,
      (s, e, until) => seen.push([s, e, until]),
      60_000,
    );
    await hold.start();
    hold.stop();
    expect(seen).toEqual([
      ["held", null, "2026-09-08T10:20:00.000Z"],
      ["idle", null, null],
    ]);
  });

  it("renews through the client itself when the client has no background twin", async () => {
    vi.useFakeTimers();
    const api = {
      takePairingHold: vi.fn().mockResolvedValue({ holdId: "h1", openUntil: "x" }),
      renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "y" }),
      releasePairingHold: vi.fn().mockResolvedValue(undefined),
    } as unknown as DashboardApi;
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.renewPairingHold).toHaveBeenCalledExactlyOnceWith("h1");
    expect(hold.status).toBe("held");
  });

  it("renews through the background client when there is one, never the session-touching one", async () => {
    vi.useFakeTimers();
    const background = {
      renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "y" }),
    } as unknown as DashboardApi;
    const api = {
      takePairingHold: vi.fn().mockResolvedValue({ holdId: "h1", openUntil: "x" }),
      renewPairingHold: vi.fn().mockResolvedValue({ openUntil: "y" }),
      releasePairingHold: vi.fn().mockResolvedValue(undefined),
      background,
    } as unknown as DashboardApi;
    const hold = new PairingHold(
      () => api,
      () => {},
      60_000,
    );
    await hold.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(background.renewPairingHold).toHaveBeenCalledExactlyOnceWith("h1");
    expect(api.renewPairingHold).not.toHaveBeenCalled();
  });
});
