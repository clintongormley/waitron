import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-enrol-screen.js";
import type { TillEnrolScreen } from "./till-enrol-screen.js";
import type { EnrolCatalogue, TillApi } from "../api/client.js";

function catalogue(): EnrolCatalogue {
  return {
    profiles: [
      { id: "pr-till", name: "Front counter", formFactor: "till" },
      { id: "pr-kds", name: "Kitchen pass", formFactor: "kds" },
    ],
    stations: [{ id: "st1", name: "Pass" }],
    registers: [{ id: "rg1", name: "Caja 1" }],
  };
}

function stubApi(overrides: Partial<Record<"enrolVerify" | "getLocales", unknown>> = {}): TillApi {
  return {
    enrolVerify: vi.fn().mockResolvedValue(catalogue()),
    getLocales: vi.fn().mockResolvedValue({ locales: [] }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillEnrolScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-enrol-screen a11y (%s theme)", (theme) => {
  it("has no violations on step 1 (labelled key field + Continue)", async () => {
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on step 2 (name + profile + a binding picker)", async () => {
    // A preset key jumps straight to the describe step; a kds profile surfaces the station picker so
    // the sweep covers the labelled name field, the profile select and a binding select together.
    const { el, host } = await mountWidget<TillEnrolScreen>(
      "till-enrol-screen",
      { api: stubApi(), code: "DEMO" },
      theme,
    );
    await flush(el);
    const profile = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-profile]")!;
    profile.value = "pr-kds";
    profile.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-station]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
