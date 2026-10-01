import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import type { AddContentLanguageDialog } from "../widgets/add-content-language.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./content-languages-screen.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";

const LOADED = () => Promise.resolve({ defaultLanguage: "es", languages: ["es", "ca", "en"] });

function stubApi(
  read: () => Promise<unknown>,
  save: () => Promise<void> = () => Promise.resolve(),
): DashboardApi {
  return {
    getContentLanguages: vi.fn(read),
    updateContentLanguages: vi.fn(save),
  } as unknown as DashboardApi;
}

async function flush(el: ContentLanguagesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("content-languages-screen a11y (%s theme)", (theme) => {
  it.each([
    ["loaded", LOADED],
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

  it("renders a refused save accessibly", async () => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED, () => Promise.reject({ code: "content.default_missing" })) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=set-default-ca]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-error]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it.each([
    ["open", false],
    ["showing a missing choice", true],
  ] as const)("renders the Add language dialog %s accessibly", async (_state, submit) => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-language]")!.click();
    await flush(el);
    if (submit) {
      const add = el.shadowRoot!.querySelector<AddContentLanguageDialog>(
        "dashboard-add-content-language",
      )!;
      add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
      await add.updateComplete;
      expect(add.shadowRoot!.querySelector("#language-error")).not.toBeNull();
    }
    await expectNoA11yViolations(host);
  });
});
