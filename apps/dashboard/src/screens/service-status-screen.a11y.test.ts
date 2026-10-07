import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./service-status-screen.js";
import type { ServiceStatusScreen } from "./service-status-screen.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

const SEED: ServiceStatus[] = [
  {
    id: "s1",
    label: "Bill requested",
    color: "#ef4444",
    displayOrder: 0,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "s2",
    label: "Needs cleaning",
    color: "#f59e0b",
    displayOrder: 1,
    active: false,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi(list: ServiceStatus[]): DashboardApi {
  return {
    listStatuses: vi.fn().mockResolvedValue(list.map((s) => ({ ...s }))),
    createStatus: vi.fn().mockResolvedValue({ id: "s3" }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    deactivateStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: ServiceStatusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

function change(el: ServiceStatusScreen, test: string, value: string): void {
  el.shadowRoot!.querySelector(`[data-test=${test}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function button(el: ServiceStatusScreen, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=${test}]`,
  )!;
}

describe.each(["light", "dark"] as const)("service-status-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with a populated list", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi(SEED) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with Save quiet on untouched rows and loud on an edited one", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi(SEED) },
      theme,
    );
    await flush(el);
    change(el, "label-s1", "Bill please");
    change(el, "new-label", "Needs water");
    await el.updateComplete;
    expect(button(el, "save-s1").variant).toBe("primary");
    expect(button(el, "save-s2").variant).toBe("secondary");
    expect(button(el, "add").variant).toBe("primary");
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a colour picked and no name, the add action loud but disabled", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi(SEED) },
      theme,
    );
    await flush(el);
    change(el, "new-color", "#10b981");
    await el.updateComplete;
    expect(button(el, "add").variant).toBe("primary");
    expect(button(el, "add").disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with an empty list", async () => {
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the error banner shown", async () => {
    const api = {
      ...stubApi(SEED),
      createStatus: vi.fn().mockRejectedValue({ code: "status.label_taken" }),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<ServiceStatusScreen>(
      "dashboard-service-status-screen",
      { api },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-label]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Bill requested" },
        bubbles: true,
        composed: true,
      }),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
