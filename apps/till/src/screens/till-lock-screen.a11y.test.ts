import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-lock-screen.js";
import type { TillLockScreen } from "./till-lock-screen.js";
import type { StaffMember, TillApi } from "../api/client.js";

const roster: StaffMember[] = [
  { personId: "p1", displayName: "Ana" },
  { personId: "p2", displayName: "Ben" },
];

function stubApi(overrides: Partial<Record<"listStaff" | "login", unknown>> = {}): TillApi {
  return {
    listStaff: vi.fn().mockResolvedValue(roster),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    ...overrides,
  } as unknown as TillApi;
}

/** Settles the in-flight roster fetch and the follow-up render. */
async function flush(el: TillLockScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** Selects a person and enters `digits` on the PIN pad, so a submit can drive an error state. */
async function enterPin(el: TillLockScreen, digits: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>('wt-button.operator-button[data-person="p1"]')!.click();
  await el.updateComplete;
  for (const digit of digits) {
    const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
    await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!.click();
    await el.updateComplete;
  }
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

  it("has no violations on the empty-roster state", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the load-failed banner (.status + .error, its own colour combo)", async () => {
    const api = stubApi({ listStaff: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the PIN-error banner", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "pin.invalid" }) });
    const { el, host } = await mountWidget<TillLockScreen>("till-lock-screen", { api }, theme);
    await flush(el);
    await enterPin(el, "9999");
    el.shadowRoot!.querySelector<HTMLElement>(".submit")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
