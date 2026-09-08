import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./done-screen.js";
import type { SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

/** A minimal {@link SetupApi} exposing only `getStatus`, the sole method the done screen polls. */
function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus } as unknown as SetupApi;
}

/** Mounts the done screen with fast polling so the restart reconnect is testable in real time. */
async function mountDone(
  getStatus: () => Promise<unknown>,
  extra: Partial<SetupDoneScreen> = {},
): Promise<SetupDoneScreen> {
  const { el } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
    api: apiWith(getStatus),
    startDelayMs: 0,
    pollIntervalMs: 3,
    ...extra,
  });
  return el;
}

afterEach(cleanupWidgets);

describe("setup-done-screen", () => {
  it("always announces the restart", async () => {
    const el = await mountDone(() => new Promise(() => {})); // never settles
    expect(el.shadowRoot!.textContent).toContain("restarting into trading mode");
  });

  // A connection failure mid-restart is EXPECTED — it must never surface as an error, and the screen
  // must keep waiting rather than offer the reload.
  it("keeps waiting (no reload) while getStatus fails with a network TypeError", async () => {
    const getStatus = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await mountDone(getStatus);
    await new Promise((r) => setTimeout(r, 40)); // several poll intervals
    expect(q(el, "[data-test=reload]")).toBeNull();
    expect(q(el, "[data-test=status]")).not.toBeNull();
    // It really is polling, not stuck.
    expect(getStatus.mock.calls.length).toBeGreaterThan(1);
  });

  // Once the setup route stops answering as setup (a non-2xx / a body that no longer parses), trading
  // mode is up — offer the reload.
  it("offers the reload once getStatus rejects with a non-2xx code", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
    expect(q(el, "[data-test=status]")).toBeNull();
  });

  // The transient-vs-done distinction end to end: network failures keep waiting, then a non-2xx flips
  // to the reload.
  it("waits through network failures, then offers the reload on the first non-2xx", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
  });

  // A getStatus that still RESOLVES means the box has not restarted yet — keep waiting.
  it("keeps waiting while getStatus still resolves, then reloads once it 404s", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
  });

  it("reloads into the till when the reload control is clicked", async () => {
    const reload = vi.fn();
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus, { reload });
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });
});
