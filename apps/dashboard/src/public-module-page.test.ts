import { afterEach, expect, it, vi } from "vitest";
import {
  currentLocale,
  setLocale,
  t,
  type DashboardContribution,
  type FetchLike,
} from "@waitron/dashboard-kit";
import { html } from "lit";
import { mountPublicModulePage } from "./public-module-page.js";
import { diag } from "./diagnostics.js";
import { userEvent } from "vitest/browser";

const path = location.pathname;
const locale = currentLocale();
afterEach(() => {
  document.querySelector("#app")?.remove();
  history.replaceState(null, "", path);
  setLocale(locale);
  vi.unstubAllGlobals();
});

it("boots the real module recovery page before creating a dashboard session client", async () => {
  history.replaceState(null, "", "/manage/recovery/fiscal-conflict");
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);
  const fetchImpl = vi.fn<FetchLike>(async () =>
    Response.json({ error: { code: "management_session.required" } }, { status: 401 }),
  );
  vi.stubGlobal("fetch", fetchImpl);
  await import("./main.js");
  expect(app.querySelector("dashboard-app")).toBeNull();
  const page = app.querySelector("vf-conflict-recovery") as HTMLElement & {
    updateComplete: Promise<boolean>;
  };
  expect(page).not.toBeNull();
  await page.updateComplete;
  expect(page.shadowRoot!.querySelector("wt-input[name=recoveryKey]")).not.toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
  const trail = diag.snapshot();
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const field = page.shadowRoot!.querySelector("wt-input")!;
  await (field as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, "BOOTSTRAP_PRIVATE_KEY");
  await userEvent.click(page.shadowRoot!.querySelector("[data-action=inspect]")!);
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  expect(fetchImpl.mock.calls[0]![0]).toBe("/api/module-recovery/fiscal-verifactu/conflict");
  expect(diag.snapshot()).toEqual(trail);
  expect(JSON.stringify(writes.mock.calls)).not.toContain("BOOTSTRAP_PRIVATE_KEY");
  expect(location.href).not.toContain("BOOTSTRAP_PRIVATE_KEY");
  expect(app.innerHTML).not.toContain("BOOTSTRAP_PRIVATE_KEY");
  writes.mockRestore();
});

it("matches contributed paths exactly and leaves unrelated destinations to the session shell", () => {
  const app = document.createElement("div");
  app.textContent = "session shell";
  const contribution: DashboardContribution = {
    module: "example",
    strings: { en: {}, es: {} },
    publicPages: [
      {
        path: "/manage/recovery/example",
        create: () => ({ render: () => html`<h1>Public procedure</h1>` }),
      },
    ],
  };
  for (const pathname of [
    "/manage",
    "/manage/recovery/example/child",
    "/manage/recovery/example/",
    "/manage/recovery/Example",
  ]) {
    expect(mountPublicModulePage(app, pathname, [contribution], { locale: "en" })).toBe(false);
    expect(app.textContent).toBe("session shell");
  }
  expect(
    mountPublicModulePage(app, "/manage/recovery/example", [contribution], { locale: "en" }),
  ).toBe(true);
  expect(app.querySelector("h1")?.textContent).toBe("Public procedure");
});

it("registers the matching module's strings and passes a plain request and chosen language", async () => {
  const app = document.createElement("div");
  const fetchImpl = vi.fn<FetchLike>(async () => Response.json({ accepted: true }));
  const contribution: DashboardContribution = {
    module: "example",
    strings: {
      en: { "public_test.title": "Recovery" },
      es: { "public_test.title": "Recuperación" },
    },
    publicPages: [
      {
        path: "/manage/recovery/example",
        create: ({ request, locale }) => ({
          render: () =>
            html`<h1 lang=${locale}>${t("public_test.title")}</h1>
              <button @click=${() => request("/api/example", "POST", { key: "in-memory" })}>
                Continue
              </button>`,
        }),
      },
    ],
  };
  mountPublicModulePage(app, "/manage/recovery/example", [contribution], {
    locale: "es",
    fetchImpl,
  });
  expect(app.querySelector("h1")?.textContent).toBe("Recuperación");
  expect(app.querySelector("h1")?.lang).toBe("es");
  app.querySelector("button")!.click();
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  expect(fetchImpl.mock.calls[0]).toEqual([
    "/api/example",
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: '{"key":"in-memory"}',
    },
  ]);
});

it("refuses ambiguous duplicate paths before mounting either module", () => {
  const app = document.createElement("div");
  app.textContent = "unchanged";
  const contribution: DashboardContribution = {
    module: "example",
    strings: { en: {}, es: {} },
    publicPages: [
      {
        path: "/manage/recovery/example",
        create: () => ({ render: () => html`<h1>Wrong module</h1>` }),
      },
    ],
  };
  expect(() =>
    mountPublicModulePage(
      app,
      "/manage/recovery/example",
      [contribution, { ...contribution, module: "other" }],
      { locale: "en" },
    ),
  ).toThrow(/duplicate/i);
  expect(app.textContent).toBe("unchanged");
});
