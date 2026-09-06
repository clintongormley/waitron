import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";
import { ServiceStatusScreen } from "./service-status-screen.js";

/**
 * The service-status editor screen. Its `api` is a stub: `listStatuses` returns a known list the
 * screen loads on connect, and `createStatus`/`updateStatus`/`deactivateStatus` are spies the per-item
 * CRUD paths call (each followed by a reload). Assertions cover each behaviour on its own: the list
 * LOADS from `listStatuses`; the new-status form calls `createStatus` with the composed body and
 * reloads; an empty label creates nothing; a row edit calls `updateStatus` with the row's CURRENT
 * values (read from state at save time, not a stale closure) and reloads; a deactivate soft-deletes;
 * and any rejected mutation/load surfaces a `role="alert"` whose text is the LOCALISED copy for the
 * code, never the raw wire code. Mirrors `receipt-screen.test.ts`.
 */

afterEach(cleanupWidgets);

const SEED: ServiceStatus[] = [
  {
    id: "s1",
    label: "Bill requested",
    color: "#ef4444",
    displayOrder: 0,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

/** Two rows — a second status so a per-row edit exercises the "leave the other rows alone" branch. */
const TWO_SEED: ServiceStatus[] = [
  ...SEED,
  {
    id: "s2",
    label: "Needs cleaning",
    color: "#f59e0b",
    displayOrder: 1,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi(
  overrides: Partial<DashboardApi> = {},
  list: ServiceStatus[] = SEED,
): DashboardApi {
  return {
    listStatuses: vi.fn().mockResolvedValue(list.map((s) => ({ ...s }))),
    createStatus: vi.fn().mockResolvedValue({ id: "s2" }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    deactivateStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight listStatuses and the follow-up render. */
async function flush(el: ServiceStatusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: ServiceStatusScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const errorKey = (el: ServiceStatusScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

/** Fire a wt-input's composed change, exactly as `wt-input` dispatches it. */
function type(el: ServiceStatusScreen, sel: string, value: string): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

/** Fire a wt-switch's composed change, exactly as `wt-switch` dispatches it. */
function toggle(el: ServiceStatusScreen, sel: string, checked: boolean): void {
  q(el, sel)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
}

describe("service-status-screen", () => {
  it("loads and lists the configured statuses on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    expect(api.listStatuses).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=row-s1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });

  it("creates a status from the new-status form, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    type(el, "[data-test=new-label]", "Needs cleaning");
    type(el, "[data-test=new-color]", "#f59e0b");
    q(el, "[data-test=add]")!.click();
    await flush(el);
    // displayOrder is the current row count (1 seed row → the new one lands at index 1).
    expect(api.createStatus).toHaveBeenCalledWith({
      label: "Needs cleaning",
      color: "#f59e0b",
      displayOrder: 1,
    });
    expect(api.listStatuses).toHaveBeenCalledTimes(2); // initial + reload after create
  });

  it("does not create an empty-label status", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(api.createStatus).not.toHaveBeenCalled();
  });

  it("saves an edited row (updateStatus with the row's current values), then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    type(el, "[data-test=label-s1]", "Bill please");
    q(el, "[data-test=save-s1]")!.click();
    await flush(el);
    expect(api.updateStatus).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ label: "Bill please", active: true }),
    );
    expect(api.listStatuses).toHaveBeenCalledTimes(2); // initial + reload after save
  });

  it("saves an edited colour, order and active state on the addressed row only", async () => {
    // Two rows, so editing s1 also exercises the "leave the other row untouched" map branch.
    const api = stubApi({}, TWO_SEED);
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    type(el, "[data-test=color-s1]", "#22c55e");
    // A non-numeric order coerces to 0 (the falsy `|| 0` branch); then a real number (the truthy one).
    type(el, "[data-test=order-s1]", "x");
    type(el, "[data-test=order-s1]", "2");
    toggle(el, "[data-test=active-s1]", false);
    q(el, "[data-test=save-s1]")!.click();
    await flush(el);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
    expect(api.updateStatus).toHaveBeenCalledWith("s1", {
      label: "Bill requested",
      color: "#22c55e",
      displayOrder: 2,
      active: false,
    });
  });

  it("deactivates a row", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=deactivate-s1]")!.click();
    await flush(el);
    expect(api.deactivateStatus).toHaveBeenCalledWith("s1");
    expect(api.listStatuses).toHaveBeenCalledTimes(2); // initial + reload after deactivate
  });

  it("surfaces a rejected create as a localised role=alert (never the raw code)", async () => {
    const api = stubApi({
      createStatus: vi.fn().mockRejectedValue({ code: "status.label_taken" }),
    });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    type(el, "[data-test=new-label]", "Bill requested");
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("status.label_taken");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("status.label_taken", "es-ES"));
    expect(banner).not.toContain("status.label_taken");
  });

  it("surfaces a rejected update as a localised role=alert", async () => {
    const api = stubApi({ updateStatus: vi.fn().mockRejectedValue({ code: "status.not_found" }) });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=save-s1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("status.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("status.not_found", "es-ES"));
  });

  it("surfaces a rejected deactivate as a localised role=alert", async () => {
    const api = stubApi({
      deactivateStatus: vi.fn().mockRejectedValue({ code: "status.inactive" }),
    });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=deactivate-s1]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("status.inactive");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("status.inactive", "es-ES"));
  });

  it("falls back to server.internal when a rejected mutation carries no code", async () => {
    const api = stubApi({ createStatus: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    type(el, "[data-test=new-label]", "Whatever");
    q(el, "[data-test=add]")!.click();
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("a rejected initial load shows the error banner and does not throw", async () => {
    const api = stubApi({ listStatuses: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    expect(errorKey(el)).toBe("server.internal");
  });

  it("field-change events do not leak past the host (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);
    let leaked = false;
    host.addEventListener("wt-change", () => (leaked = true));
    type(el, "[data-test=new-label]", "X");
    type(el, "[data-test=label-s1]", "Y");
    expect(leaked).toBe(false);
  });
});

it.each([
  {
    method: "createStatus",
    field: "[data-test=new-label]",
    button: "[data-test=add]",
    result: { id: "s9" },
  },
  {
    method: "updateStatus",
    field: "[data-test=label-s1]",
    button: "[data-test=save-s1]",
    result: null,
  },
])(
  "Enter guards pending $method and allows retry after rejection",
  async ({ method, field, button, result }) => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const api = stubApi({ [method]: request });
    const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
      api,
    });
    await flush(el);

    const control = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(field)!;
    await control.updateComplete;
    const input = control.shadowRoot!.querySelector("input")!;
    input.value = "Updated";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    el.shadowRoot!.querySelector<HTMLElement>(button)!.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      true,
    );
    reject({ code: "management.request_invalid" });
    await flush(el);
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect((el.shadowRoot!.querySelector(button) as import("@waitron/ui").WtButton).disabled).toBe(
      false,
    );
  },
);
