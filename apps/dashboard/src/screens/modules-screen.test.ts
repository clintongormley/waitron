import { TABLE_CUSTOMISATION_STRINGS } from "@waitron/dashboard-kit/src/strings.js";
import { page, userEvent } from "vitest/browser";
import { html } from "lit";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { NavigationGuard, registerIcons, type NavigationLeave } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { modulesClient } from "./modules-screen.test-support.js";
import type { ModulesScreen } from "./modules-screen.js";
import "./modules-screen.js";
registerIcons(DASHBOARD_ICONS);
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/modules");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(api = modulesClient()) {
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(rows(el).length).toBeGreaterThan(0));
  return el;
}
function rows(el: ModulesScreen) {
  return [
    ...(el
      .shadowRoot!.querySelector("wt-data-table")
      ?.shadowRoot?.querySelectorAll("tbody tr[data-row-key]") ?? []),
  ].map((row) => row.textContent);
}
function change(el: ModulesScreen, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
it("opens Enabled, and Add discovers Disabled without changing the independent category", async () => {
  const el = await mount();
  expect(rows(el)).toHaveLength(3);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.shadowRoot!.querySelector("[data-test=configure-payments]")).toBeNull();
  expect(table.shadowRoot!.querySelectorAll("wt-row-actions")).toHaveLength(2);
  expect(rows(el).join()).toContain("Card payments");
  expect(rows(el).join()).not.toContain("Bookings");
  change(el, "category", "card-providers");
  await el.updateComplete;
  expect(rows(el)).toHaveLength(2);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-module]")!.click();
  await el.updateComplete;
  expect(rows(el)).toEqual([]);
  expect(location.pathname).toBe("/modules/view/card-providers/state/disabled");
  change(el, "category", "all");
  await el.updateComplete;
  expect(rows(el).join()).toContain("Bookings");
  expect(rows(el).join()).toContain("Spanish workforce rules");
});
it("honours the direct all-provider link and separates Enabled from Needs setup", async () => {
  history.replaceState(null, "", "/modules/view/card-providers/state/all");
  const el = await mount();
  const text = rows(el).join();
  expect(rows(el)).toHaveLength(2);
  expect(text).toContain("SumUp");
  expect(text).toContain("Stripe");
  expect(text).toContain("Configured");
  expect(text).toContain("Needs setup");
  expect(text).not.toContain("Disabled");
});
it("shows a failed menu read and retries without substituting an empty list", async () => {
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue([{ id: "payments", category: "module", enabled: true }]),
  });
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]")!.click();
  await vi.waitFor(() => expect(rows(el)).toHaveLength(1));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("wraps the pending restart note on a Spanish phone display", async () => {
  await page.viewport(390, 900);
  try {
    setLocale("es-ES");
    const el = await mount(
      modulesClient({
        listModules: vi
          .fn()
          .mockResolvedValue([
            { id: "payments", category: "module", enabled: true, applied: false, revision: 1 },
          ]),
      }),
    );
    const reason = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("[part=switch-reason]")!;
    const range = document.createRange();
    range.selectNodeContents(reason);
    expect(range.getClientRects().length).toBeGreaterThan(1);
  } finally {
    await page.viewport(1280, 900);
  }
});

it("ends the loading indication when provider configuration cannot be read, and recovers on Retry", async () => {
  const api = modulesClient({
    listPaymentProviders: vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue([
        { providerId: "sumup", state: "connected", canUnpair: true },
        { providerId: "stripe", state: "not_connected", canUnpair: false },
      ]),
  });
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  await vi.waitFor(() => expect(rows(el).join()).toContain("Configuration unavailable"));
  expect(rows(el).join()).not.toContain("Loading");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]")!.click();
  await vi.waitFor(() => expect(rows(el).join()).toContain("Needs setup"));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("confirms provider Off separately from configuration and keeps attached-reader refusals visible", async () => {
  const api = modulesClient({
    setPaymentProviderState: vi.fn().mockRejectedValue({
      code: "payment.provider_in_use",
      params: { readerNames: ["Front reader"] },
    }),
  });
  const el = await mount(api);
  el.canManageProviders = true;
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const off = table.shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]");
  expect(off).not.toBeNull();
  off!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("sumup-connect-form")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=provider-state-error]")?.textContent).toContain(
      "Front reader",
    ),
  );
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=remove-readers]")!;
  expect(link.getAttribute("href")).toBe("/payments");
  expect(api.setPaymentProviderState).toHaveBeenCalledWith("sumup", false, 0);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=provider-state-error]")?.textContent).toContain(
    "Front reader",
  );
});
it("a manager can configure but cannot switch a provider", async () => {
  const el = await mount();
  const root = el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  expect(root.querySelector("[data-test=configure-sumup]")).not.toBeNull();
  expect(root.querySelector("[data-test=switch-sumup]")).toBeNull();
});

it.each([true, false])(
  "switches a provider from enabled=%s and refreshes its state without changing configuration",
  async (enabled) => {
    history.replaceState(null, "", "/modules/view/card-providers/state/all");
    const api = modulesClient({
      listModules: vi
        .fn()
        .mockResolvedValueOnce([{ id: "sumup", category: "card-provider", enabled, revision: 4 }])
        .mockResolvedValue([
          { id: "sumup", category: "card-provider", enabled: !enabled, revision: 5 },
        ]),
      setPaymentProviderState: vi.fn().mockResolvedValue({ enabled: !enabled, revision: 5 }),
    });
    const el = await mount(api);
    el.canManageProviders = true;
    await el.updateComplete;
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]")!
      .click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
    await vi.waitFor(() => expect(rows(el).join()).toContain(enabled ? "Disabled" : "Enabled"));
    expect(api.setPaymentProviderState).toHaveBeenCalledWith("sumup", !enabled, 4);
    expect(rows(el).join()).toContain("Configured");
    expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  },
);

it("offers no provider switch while the Payments module is disabled", async () => {
  history.replaceState(null, "", "/modules/view/card-providers/state/all");
  const el = await mount(
    modulesClient({
      listModules: vi.fn().mockResolvedValue([
        { id: "payments", category: "module", enabled: false },
        { id: "sumup", category: "card-provider", enabled: false, revision: 0 },
      ]),
    }),
  );
  el.canManageProviders = true;
  await el.updateComplete;
  expect(
    el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("[data-test=switch-sumup]"),
  ).toBeNull();
});

it("refreshes a stale provider revision so the open confirmation can be retried", async () => {
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "sumup", category: "card-provider", enabled: true, revision: 0 },
      ])
      .mockResolvedValue([{ id: "sumup", category: "card-provider", enabled: true, revision: 1 }]),
    setPaymentProviderState: vi
      .fn()
      .mockRejectedValueOnce({ code: "settings.out_of_date" })
      .mockResolvedValue({ enabled: false, revision: 2 }),
  });
  const el = await mount(api);
  el.canManageProviders = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]")!
    .click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() => expect(api.listModules).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("[data-test=confirm-provider-state]")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(false),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() =>
    expect(api.setPaymentProviderState).toHaveBeenLastCalledWith("sumup", false, 1),
  );
});

it.each(
  ["bookings", "payments", "workforce-es"].flatMap((id) =>
    ["/modules/state/all", "/modules"].map((path) => ({ id, path })),
  ),
)("confirms $id and keeps its pending state visible at $path", async ({ id, path }) => {
  history.replaceState(null, "", path);
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockResolvedValueOnce([
        { id, category: "module", enabled: true, applied: true, revision: 2 },
      ])
      .mockResolvedValue([{ id, category: "module", enabled: false, applied: true, revision: 3 }]),
    setModuleState: vi.fn().mockResolvedValue({ enabled: false, applied: true, revision: 3 }),
  });
  const el = await mount(api);
  expect(
    el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector(`[data-test="switch-${id}"]`),
  ).toBeNull();
  el.canManageModules = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="switch-${id}"]`)!
    .click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")!.textContent).toContain("tills reconnect");
  expect(el.shadowRoot!.querySelector("wt-dialog")!.textContent).toContain("station");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() => expect(rows(el).join()).toContain("Waiting for restart"));
  expect(rows(el).join()).toContain("Disabled");
  expect(api.setModuleState).toHaveBeenCalledWith(id, false, 2);
  expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
});
it("keeps a refused Bookings confirmation available and refreshes a stale revision", async () => {
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "bookings", category: "module", enabled: true, applied: true, revision: 0 },
      ])
      .mockResolvedValue([
        { id: "bookings", category: "module", enabled: true, applied: true, revision: 1 },
      ]),
    setModuleState: vi
      .fn()
      .mockRejectedValueOnce({ code: "settings.out_of_date" })
      .mockResolvedValue({ enabled: false, applied: true, revision: 2 }),
  });
  const el = await mount(api);
  el.canManageModules = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-bookings]")!
    .click();
  await el.updateComplete;
  const confirm = () =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!;
  confirm().click();
  await vi.waitFor(() => expect(api.listModules).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(confirm().shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false),
  );
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toContain(
    "Someone else saved these settings",
  );
  confirm().click();
  await vi.waitFor(() => expect(api.setModuleState).toHaveBeenLastCalledWith("bookings", false, 1));
});

it("keeps the Payments provider prerequisite refusal beside the confirmation", async () => {
  const el = await mount(
    modulesClient({
      setModuleState: vi.fn().mockRejectedValue({ code: "module.providers_enabled" }),
    }),
  );
  el.canManageModules = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-payments]")!
    .click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("error")).toContain(
      "card providers",
    ),
  );
  expect(el.shadowRoot!.querySelector("wt-dialog")).not.toBeNull();
});
it("narrows the modules to those whose shown name or configuration matches the search, beside the Category and State choices", async () => {
  history.replaceState(null, "", "/modules/view/all/state/all");
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const rowKeys = () =>
    [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    );
  const search = async (value: string) => {
    const box = table.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
    box.value = value;
    box.dispatchEvent(new Event("input"));
    await table.updateComplete;
  };
  expect(table.shadowRoot!.querySelector(".table-search")!.getAttribute("aria-label")).toBe(
    "Search modules",
  );
  await search("spanish workforce");
  expect(rowKeys()).toEqual(["module:workforce-es"]);
  await search("needs setup");
  expect(rowKeys()).toEqual(["card-provider:stripe"]);
  expect(el.shadowRoot!.querySelector("[name=category]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[name=state]")).not.toBeNull();
});
it("keeps the Category and State choices on screen when no module matches them", async () => {
  const el = await mount();
  change(el, "category", "card-providers");
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-module]")!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
  expect(rows(el)).toEqual([]);
  for (const name of ["category", "state"]) {
    const choice = el.shadowRoot!.querySelector<HTMLElement>(`[name=${name}]`);
    expect(choice).not.toBeNull();
    expect(choice!.checkVisibility()).toBe(true);
    const box = choice!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }
});

it("keeps Disconnect reachable without a provider panel or provider-switch permission", async () => {
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", {
    api: modulesClient(),
    panels: [],
  });
  await vi.waitFor(() => expect(rows(el).join()).toContain("Configured"));
  const root = el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  expect(root.querySelector("[data-test=disconnect-sumup]")).not.toBeNull();
  expect(root.querySelector("[data-test=configure-sumup]")).toBeNull();
  expect(root.querySelector("[data-test=switch-sumup]")).toBeNull();
  expect(root.querySelector("[data-test=disconnect-stripe]")).toBeNull();
});

it("offers localized column choices and restores a hidden module state", async () => {
  setLocale("es-ES");
  localStorage.setItem("waitron.modules.table:columns", '{"state":false}');
  try {
    const el = await mount();
    const root = el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
    const heading = root.querySelector('thead th[data-pinned="end"]')!;
    await expect.element(page.elementLocator(heading)).toHaveAccessibleName("Acciones");
    const chooser = root.querySelector<HTMLElement>(".columns-trigger");
    expect(chooser?.getAttribute("aria-label")).toBe(
      TABLE_CUSTOMISATION_STRINGS.es["table.customise_columns"],
    );
    await userEvent.click(chooser!);
    expect(root.querySelector('input[data-column="state"]')).toHaveProperty("checked", false);
    expect(root.querySelector("wt-dialog")).toHaveProperty(
      "heading",
      TABLE_CUSTOMISATION_STRINGS.es["table.customise"],
    );
  } finally {
    localStorage.removeItem("waitron.modules.table:columns");
  }
});

const FAKE_SUMUP = {
  providerId: "sumup",
  displayNameKey: "modules.providers",
  strings: { en: {}, es: {} },
  renderConnectForm: ({ onConnected }: { onConnected: () => void }) =>
    html`<button data-test="fake-connect" @click=${onConnected}>Connect</button>`,
} as unknown as CardProviderPanel;

async function connectFakeSumup(el: ModulesScreen): Promise<void> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=configure-sumup]")!
    .click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("wt-dialog [data-test=fake-connect]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull());
}

it("returns to Card readers after a provider connects, when Card readers sent the person here", async () => {
  history.replaceState(null, "", "/modules/view/card-providers/state/all/return-to/card-readers");
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", {
    api: modulesClient(),
    panels: [FAKE_SUMUP],
  });
  await vi.waitFor(() => expect(rows(el)).toHaveLength(2));
  change(el, "state", "enabled");
  await el.updateComplete;
  expect(location.pathname).toBe(
    "/modules/view/card-providers/state/enabled/return-to/card-readers",
  );
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  onTestFinished(() => {
    push.mockRestore();
    replace.mockRestore();
  });
  await connectFakeSumup(el);
  await vi.waitFor(() => expect(location.pathname).toBe("/payments"));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(new URL(String(replace.mock.calls[0]![2])).pathname).toBe(
    "/modules/view/card-providers/state/enabled",
  );
  expect(push).toHaveBeenCalledTimes(1);
  expect(new URL(String(push.mock.calls[0]![2])).pathname).toBe("/payments");
  expect(replace.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0]!);
});

async function connectWithUnsavedInput(outcome: "kept" | "proceeded") {
  history.replaceState(null, "", "/modules/view/card-providers/state/all/return-to/card-readers");
  const api = modulesClient();
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", {
    api,
    panels: [FAKE_SUMUP],
  });
  await vi.waitFor(() => expect(rows(el)).toHaveLength(2));
  const request = vi.fn<NavigationLeave["request"]>(async (proceed) => {
    if (outcome === "proceeded") await proceed();
    return outcome;
  });
  const guard = new NavigationGuard(window, { isDirty: () => true, request });
  onTestFinished(() => guard.dispose());
  const reads = vi.mocked(api.listModules).mock.calls.length;
  await connectFakeSumup(el);
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  return { api, request, reads };
}

it("clears the return without asking, then stays on Modules and reloads when leaving for Card readers is refused", async () => {
  const { api, request, reads } = await connectWithUnsavedInput("kept");
  await vi.waitFor(() =>
    expect(vi.mocked(api.listModules).mock.calls.length).toBeGreaterThan(reads),
  );
  expect(request).toHaveBeenCalledOnce();
  expect(new URL(request.mock.calls[0]![2]).pathname).toBe("/payments");
  expect(location.pathname).toBe("/modules/view/card-providers/state/all");
});

it("asks the leave question once, for the move to Card readers, when unsaved input is held", async () => {
  const { request } = await connectWithUnsavedInput("proceeded");
  await vi.waitFor(() => expect(location.pathname).toBe("/payments"));
  expect(request).toHaveBeenCalledOnce();
  expect(new URL(request.mock.calls[0]![2]).pathname).toBe("/payments");
});

it("stays on Modules after a provider connects when nothing sent the person here", async () => {
  history.replaceState(null, "", "/modules/view/card-providers/state/all");
  const api = modulesClient();
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", {
    api,
    panels: [FAKE_SUMUP],
  });
  await vi.waitFor(() => expect(rows(el)).toHaveLength(2));
  const push = vi.spyOn(history, "pushState");
  const replace = vi.spyOn(history, "replaceState");
  onTestFinished(() => {
    push.mockRestore();
    replace.mockRestore();
  });
  const reads = vi.mocked(api.listModules).mock.calls.length;
  await connectFakeSumup(el);
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/modules/view/card-providers/state/all");
  await vi.waitFor(() =>
    expect(vi.mocked(api.listModules).mock.calls.length).toBeGreaterThan(reads),
  );
});
