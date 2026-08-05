import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-lock-screen.js";
import type { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";

const roster: StaffMember[] = [
  { personId: "p1", displayName: "Ana" },
  { personId: "p2", displayName: "Ben" },
];

function stubApi(): TillApi {
  return {
    listStaff: vi.fn().mockResolvedValue(roster),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
  } as unknown as TillApi;
}

/** Settles the in-flight roster fetch and the follow-up render. */
async function flush(el: TillLockScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-lock-screen a11y (%s theme)", (theme) => {
  it("has no violations on the staff-picker view", async () => {
    const { el, host } = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the PIN entry view", async () => {
    const { el, host } = await mountWidget<TillLockScreen>(
      "till-lock-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>(
      'wt-button.operator-button[data-person="p1"]',
    )!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
