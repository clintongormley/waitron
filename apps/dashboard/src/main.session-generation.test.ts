import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApp } from "./dashboard-app.js";

afterEach(() => vi.unstubAllGlobals());

it("the actual entry shares one epoch with shell, API, module requests and background clients", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const events: unknown[] = [];
  const active = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener("waitron-session-active", active);
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("session/me"))
      return new Response(JSON.stringify({ error: { code: "management_session.required" } }), {
        status: 401,
      });
    if (path.includes("locales"))
      return new Response(
        JSON.stringify({
          locales: [{ code: "en-GB", label: "English" }],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
          venueName: "Test venue",
        }),
      );
    if (path.includes("google")) return new Response(JSON.stringify({ configured: false }));
    if (path.includes("theme"))
      return new Response(JSON.stringify({ hash: "waitron", css: "", logo: null }));
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchImpl);
  const streams: EventTarget[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends EventTarget {
      constructor() {
        super();
        streams.push(this);
      }
      close() {}
    },
  );
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
  try {
    await import("./main.js");
    const app = root.querySelector<DashboardApp>("dashboard-app")!;
    await vi.waitFor(() =>
      expect(app.shadowRoot?.querySelector("dashboard-login-screen")).not.toBeNull(),
    );
    await vi.waitFor(() =>
      expect(fetchImpl.mock.calls.some(([path]) => String(path).includes("locales"))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    events.length = 0;
    const epoch = app.sessionEpoch.advance();
    await app.request("/test-module", "POST");
    expect(events).toEqual([{ generation: epoch }]);
    events.length = 0;
    await app.api.getStaffRoster();
    expect(events).toEqual([{ generation: epoch }]);
    const captured: unknown[] = [];
    const invalid = (event: Event) => captured.push((event as CustomEvent).detail);
    window.addEventListener("waitron-session-invalid", invalid);
    try {
      await expect(app.api.background.getMe({ sessionErrors: "caller" })).rejects.toMatchObject({
        code: "management_session.required",
      });
      expect(captured).toEqual([]);
      await expect(app.api.background.getMe()).rejects.toMatchObject({
        code: "management_session.required",
      });
      expect(captured).toEqual([{ code: "management_session.required", generation: epoch }]);
      captured.length = 0;
      let settle!: (response: Response) => void;
      fetchImpl.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            settle = resolve;
          }),
      );
      const pending = app.api.background.getMe();
      const rejection = expect(pending).rejects.toMatchObject({
        code: "management_session.required",
      });
      app.sessionEpoch.advance();
      settle(
        new Response(JSON.stringify({ error: { code: "management_session.required" } }), {
          status: 401,
        }),
      );
      await rejection;
      expect(captured).toEqual([]);
      const observed = app.api.liveData.observe(
        { key: "wiring", dependencies: [{ type: "printers" }], read: async () => [] },
        () => {},
      );
      try {
        app.liveUpdates!.start();
        await vi.waitFor(() => expect(streams).toHaveLength(1));
        app.sessionEpoch.advance();
        streams[0]!.dispatchEvent(
          new MessageEvent("session-invalid", {
            data: JSON.stringify({ code: "management_session.expired" }),
          }),
        );
        expect(captured).toEqual([]);
      } finally {
        app.liveUpdates!.stop();
        observed.unsubscribe();
      }
    } finally {
      window.removeEventListener("waitron-session-invalid", invalid);
    }
  } finally {
    root.remove();
    window.removeEventListener("waitron-session-active", active);
  }
});
