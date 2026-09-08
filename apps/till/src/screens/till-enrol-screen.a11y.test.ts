import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-enrol-screen.js";
import type { TillEnrolScreen } from "./till-enrol-screen.js";
import type { TillApi } from "../api/client.js";

type JoinVerbs = "join" | "joinStatus" | "getLocales";
function stubApi(overrides: Partial<Record<JoinVerbs, unknown>> = {}): TillApi {
  return {
    join: vi.fn().mockResolvedValue({ joinId: "jr-1", verificationNumber: "47" }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** Names the device and knocks, settling the join. */
async function knock(el: TillEnrolScreen): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[data-name]")!;
  input.value = "Front counter";
  input.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Front counter" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
  await flush(el);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-enrol-screen a11y (%s theme)", (theme) => {
  it("has no violations on the name phase (labelled field + Ask to join)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the waiting phase (the announced number)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await knock(el);
    expect(el.shadowRoot!.querySelector("[data-number]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the refusal banner (danger-on-surface, not muted text)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi({ join: vi.fn().mockRejectedValue({ code: "device.pairing_closed" }) }) },
      theme,
    );
    await flush(el);
    await knock(el);
    expect(el.shadowRoot!.querySelector("[data-error]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
