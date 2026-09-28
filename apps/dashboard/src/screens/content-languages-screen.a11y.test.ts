import { afterEach, describe, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./content-languages-screen.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";

function stubApi(read: () => Promise<unknown>): DashboardApi {
  return {
    getContentLanguages: vi.fn(read),
    updateContentLanguages: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function flush(el: ContentLanguagesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("content-languages-screen a11y (%s theme)", (theme) => {
  it.each([
    ["loaded", () => Promise.resolve({ defaultLanguage: "es", languages: ["es", "ca", "en"] })],
    ["loading", () => new Promise(() => {})],
    ["load failed", () => Promise.reject(new Error("offline"))],
  ] as const)("renders the %s state accessibly", async (_state, read) => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(read) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the open edit dialog accessibly", async () => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      {
        api: stubApi(() => Promise.resolve({ defaultLanguage: "es", languages: ["es", "en"] })),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-languages]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
