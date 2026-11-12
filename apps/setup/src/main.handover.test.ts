import { afterEach, expect, it, vi } from "vitest";
import { render } from "lit";
import type { SetupHandoverScreen } from "./screens/handover-screen.js";
import { setLocale } from "./i18n/t.js";
const listeners: [string, EventListenerOrEventListenerObject][] = [];
afterEach(() => {
  const host = document.querySelector<HTMLElement>("#app");
  if (host) {
    render(null, host);
    host.remove();
  }
  for (const [type, listener] of listeners) window.removeEventListener(type, listener);
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});
it("opens the literal emergency entry without reading an operation named emergency", async () => {
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (listener) listeners.push([type, listener]);
    add(type, listener, options);
  });
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ body: {} }));
  });
  history.replaceState(null, "", "/handover/emergency");
  const host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  await import("./main.js");
  const screen = host.querySelector<SetupHandoverScreen>("setup-handover-screen")!;
  await screen.updateComplete;
  expect(screen.emergency).toBe(true);
  expect(screen.operationId).toBe("");
  expect(requests).toEqual([]);
  expect(screen.shadowRoot!.querySelector("[data-test=emergency-preview]")).not.toBeNull();
});
