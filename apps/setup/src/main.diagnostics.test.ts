import { afterEach, expect, it, vi } from "vitest";
import { render } from "lit";
import { userEvent } from "vitest/browser";
import { BUILD_HEADER } from "@waitron/shared";
import type { SetupApp } from "./setup-app.js";
import type { WtButton, WtReportDialog } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";

const listeners: [string, EventListenerOrEventListenerObject][] = [];
afterEach(() => {
  const app = document.querySelector<HTMLElement>("#app");
  if (app) {
    render(null, app);
    app.remove();
  }
  for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});

it("wires real setup requests, HTTP IDs, build observation and errors into the downloadable report", async () => {
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (listener) listeners.push([type, listener]);
    add(type, listener, options);
  });
  vi.stubGlobal("isSecureContext", false);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const requests: { path: string; id: string | null }[] = [];
  let build: string | undefined;
  let foreign = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    requests.push({ path, id: new Headers(init?.headers).get("x-request-id") });
    const body = path.endsWith("/status")
      ? { provisioned: false, environment: "preproduction", needs: ["venue"] }
      : path.endsWith("/discovery")
        ? { caDownloadAvailable: false }
        : { claimed: false };
    const response = new Response(JSON.stringify(body), {
      headers: build ? { [BUILD_HEADER]: build } : {},
    });
    if (foreign)
      Object.defineProperty(response, "url", {
        value: "http://other.example.test/setup-api/discovery",
      });
    return response;
  });
  const host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  await import("./main.js");
  const app = host.querySelector<SetupApp>("setup-app")!;
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(3);
  expect(requests[0]!.id).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  const { diag, reportBuild } = await import("./diagnostics.js");
  expect(reportBuild).toBeNull();
  build = "abcdef0";
  foreign = true;
  await app.api.getDiscovery();
  expect((await import("./diagnostics.js")).reportBuild).toBeNull();
  foreign = false;
  await app.api.getDiscovery();
  expect((await import("./diagnostics.js")).reportBuild).toBe("abcdef0");
  build = "1234567";
  await app.api.getDiscovery();
  expect((await import("./diagnostics.js")).reportBuild).toBe("abcdef0");
  const onError = listeners.find(([type]) => type === "error")![1] as EventListener;
  onError(
    new ErrorEvent("error", { error: new TypeError("private detail"), message: "private detail" }),
  );
  const onRejection = listeners.find(
    ([type]) => type === "unhandledrejection",
  )![1] as EventListener;
  onRejection({ reason: { name: "RangeError", message: "private rejection" } } as unknown as Event);
  await app.updateComplete;
  const report =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["setup-problem-report"]>(
      "setup-problem-report",
    )!;
  await report.updateComplete;
  await userEvent.click(report.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!);
  await report.updateComplete;
  const dialog = report.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  const data = JSON.parse(dialog.preview.split("```json\n")[1]!.split("\n```")[0]!);
  expect(data.app).toBe("setup");
  expect(data.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(data.client.build).toBe("abcdef0");
  expect(data.trail).toContainEqual(
    expect.objectContaining({
      event: "api",
      fields: expect.objectContaining({
        phase: "end",
        requestId: requests[0]!.id,
        path: "/:id/:id",
      }),
    }),
  );
  expect(data.trail).toContainEqual(
    expect.objectContaining({ event: "window.error", fields: { name: "TypeError" } }),
  );
  expect(data.trail).toContainEqual(
    expect.objectContaining({ event: "window.unhandledrejection", fields: { name: "RangeError" } }),
  );
  expect(dialog.preview).not.toContain("private detail");
  expect(dialog.preview).not.toContain("private rejection");
  expect(diag.snapshot().length).toBeGreaterThan(0);
});
