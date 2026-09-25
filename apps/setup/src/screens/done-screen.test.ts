import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./done-screen.js";
import { BACKUP_SETUP_URL, type SetupDoneScreen } from "./done-screen.js";
import type { SetupApi } from "../api/client.js";

const q = (el: SetupDoneScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);

function apiWith(getStatus: () => Promise<unknown>): SetupApi {
  return { getStatus } as unknown as SetupApi;
}

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
  it("announces the restart into trading on the provision/restore path", async () => {
    const el = await mountDone(() => new Promise(() => {}));
    expect(el.shadowRoot!.textContent).toContain("restarting into trading mode");
  });

  it.each([
    ["demo", "Demo"],
    ["prepare", "Preparation"],
    ["live", "Live"],
  ] as const)("keeps the selected %s mode visible", async (onboardingIntent, label) => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent });
    expect(q(el, "[data-test=mode-indicator]")?.textContent?.trim()).toBe(label);
  });

  it("keeps waiting (no reload) while getStatus fails with a network TypeError", async () => {
    const getStatus = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await mountDone(getStatus);
    // Waited for, not timed: a fixed sleep before counting polls fails when a loaded machine starves
    // the browser's event loop.
    await vi.waitFor(() => expect(getStatus.mock.calls.length).toBeGreaterThan(1));
    expect(q(el, "[data-test=reload]")).toBeNull();
    expect(q(el, "[data-test=status]")).not.toBeNull();
  });

  it("offers the reload once getStatus rejects with a non-2xx code", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
    expect(q(el, "[data-test=status]")).toBeNull();
  });

  it("waits through network failures, then offers the reload on the first non-2xx", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
  });

  it("keeps waiting while getStatus still resolves, then reloads once it 404s", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockResolvedValueOnce({ provisioned: false, environment: "preproduction", needs: ["venue"] })
      .mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus);
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
  });

  // The removed element still renders once and arms its first-poll timer after it has left the page.
  // The attached control arms an identical zero-delay timer AFTER it, and same-delay timers fire in
  // the order they were set, so once the control has polled the removed one's timer has fired too.
  it("never polls when removed before its first render", async () => {
    const getStatus = vi.fn(() => new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const el = document.createElement("setup-done-screen");
      Object.assign(el, { api: apiWith(getStatus), startDelayMs: 0, pollIntervalMs: 3 });
      host.appendChild(el);
      el.remove();
      await el.updateComplete;
      const controlStatus = vi.fn(() => new Promise(() => {}));
      await mountDone(controlStatus);
      await vi.waitFor(() => expect(controlStatus).toHaveBeenCalled());
      expect(getStatus).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });

  // In the case this test guards against, both elements run the same code and the removed one is
  // rejected first, so it has finished by the time the control shows its reload.
  it("does not offer the reload when it is removed while a poll is in flight", async () => {
    const inFlight = () => {
      let fail!: (reason: unknown) => void;
      const getStatus = vi.fn(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      );
      return { getStatus, fail: (reason: unknown) => fail(reason) };
    };
    const removed = inFlight();
    const control = inFlight();
    const el = await mountDone(removed.getStatus);
    const controlEl = await mountDone(control.getStatus);
    await vi.waitFor(() => {
      expect(removed.getStatus).toHaveBeenCalledOnce();
      expect(control.getStatus).toHaveBeenCalledOnce();
    });
    const host = el.parentElement!;
    el.remove();
    removed.fail({ code: "server.internal" });
    control.fail({ code: "server.internal" });
    await vi.waitFor(() => expect(q(controlEl, "[data-test=reload]")).not.toBeNull());
    host.appendChild(el);
    await el.updateComplete;
    expect(q(el, "[data-test=reload]")).toBeNull();
    expect(q(el, "[data-test=status]")).not.toBeNull();
    expect(removed.getStatus).toHaveBeenCalledOnce();
  });

  it("reloads into the till when the reload control is clicked", async () => {
    const reload = vi.fn();
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus, { reload });
    await vi.waitFor(() => expect(q(el, "[data-test=reload]")).not.toBeNull());
    q(el, "[data-test=reload]")!.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("shows a 'no backups yet' nudge with a link to backup setup", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "live" });
    const nudge = q(el, "[data-test=backup-nudge]");
    expect(nudge).not.toBeNull();
    const link = nudge!.querySelector("a");
    expect(link).not.toBeNull();
    expect(new URL(link!.href).pathname).toBe(BACKUP_SETUP_URL);
  });

  it("suppresses the nudge in demo mode", async () => {
    const el = await mountDone(() => new Promise(() => {}), { onboardingIntent: "demo" });
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
  });

  it("lists the box's reachability links on the provision/restore path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { hostname: "waitron.local" });
    const links = el.shadowRoot!.querySelector("[data-test=links]")!;
    const hrefs = [...links.querySelectorAll("a")].map((a) =>
      (a as HTMLAnchorElement).getAttribute("href"),
    );
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/manage");
    expect(hrefs).toContain("/manage/email");
    expect(hrefs).toContain("http://waitron.local:9110");
  });

  it("does not promise trading mode on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    const text = el.shadowRoot!.textContent!;
    expect(text).not.toContain("restarting into trading mode");
    expect(text.replace(/\s+/g, " ")).toContain("no till and no dashboard");
  });

  it("offers no till/dashboard links and no backup nudge on the mirror path", async () => {
    const el = await mountDone(() => new Promise(() => {}), { mirrorJoin: true });
    expect(q(el, "[data-test=links]")).toBeNull();
    expect(q(el, "[data-test=backup-nudge]")).toBeNull();
  });

  it("reports the restart instead of offering a reload on the mirror path", async () => {
    const getStatus = vi.fn().mockRejectedValue({ code: "server.internal" });
    const el = await mountDone(getStatus, { mirrorJoin: true });
    await vi.waitFor(() =>
      expect(q(el, "[data-test=status]")?.textContent).toContain("has restarted"),
    );
    expect(q(el, "[data-test=reload]")).toBeNull();
  });

  it("sets the break-glass secret in the design system's monospace font", async () => {
    const { el, host } = await mountWidget<SetupDoneScreen>("setup-done-screen", {
      api: apiWith(() => new Promise(() => {})),
      startDelayMs: 0,
      breakGlassSecret: "bg-9f3a",
    });
    host.style.setProperty("--wt-font-family-mono", "serif");
    const secret = q(el, "[data-test=break-glass-secret]")!;
    expect(getComputedStyle(secret).fontFamily).toBe("serif");
  });

  it("tells the operator what the break-glass secret is for on a trading server", async () => {
    const el = await mountDone(() => new Promise(() => {}), { breakGlassSecret: "bg-9f3a" });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("You need it to promote this server if the primary is unreachable.");
    expect(warning).not.toContain("cannot do that in this version");
  });

  it("shows the break-glass secret on the mirror path without promising a promote", async () => {
    const el = await mountDone(() => new Promise(() => {}), {
      mirrorJoin: true,
      breakGlassSecret: "bg-9f3a",
    });
    expect(q(el, "[data-test=break-glass-secret]")?.textContent).toBe("bg-9f3a");
    const warning = q(el, "[data-test=break-glass-warning]")!.textContent!.replace(/\s+/g, " ");
    expect(warning).toContain("will not be shown again");
    expect(warning).toContain("cannot do that in this version");
  });
});
