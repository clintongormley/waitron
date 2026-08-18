import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./service-status-screen.js";
import type { ServiceStatusScreen } from "./service-status-screen.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";

/**
 * The service-status screen scanned by axe in both themes, in three shapes: a populated list (active +
 * inactive rows, so the deactivate button renders both enabled and disabled), an empty list (just the
 * new-status form), and the error state (a rejected create shows the `role="alert"` banner). Mounted by
 * ASSIGNING the `api` stub as a property; the screen loads on connect, so the stub must resolve or a
 * stray rejection pollutes the run (a rejection is a finding). Every colour is a `--wt-*` token; the
 * native `type="color"` swatch is the browser's own control and carries no text for axe to contrast.
 */
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
