import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import type { WtDialog, WtFormActions, WtInput } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const refusals = {
  open: undefined,
  refused: {
    code: "venue.detail_invalid",
    params: { field: "legalName", reason: "fiscal_format" },
  },
  stale: { code: "venue.detail_changed", params: { field: "legalName" } },
};

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["open", "refused", "stale"] as const).map((state) => ({ theme, locale, state })),
  ),
);

it.each(cases)(
  "the legal-name dialog has no accessibility violations: $state, $locale, $theme",
  async ({ theme, locale, state }) => {
    setLocale(locale);
    const api = {
      liveData: new LiveData(),
      getVenueDetails: vi.fn(async () => venueDetailsFixture()),
      getVenueClockPreview: vi.fn(),
      patchVenueDetails: vi.fn(),
      renameTaxpayer: vi.fn().mockRejectedValue(refusals[state]),
    } as unknown as DashboardApi;
    const { el: panel, host } = await mountWidget<Panel>(
      "dashboard-venue-details-panel",
      { api },
      theme,
    );
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=change-legal-name]"))
      .toBeTruthy();
    panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-legal-name]")!.click();
    const dialogHost = panel.shadowRoot!.querySelector("dashboard-legal-name-dialog")!;
    await dialogHost.updateComplete;
    const dialog = dialogHost.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const input = dialog.querySelector<WtInput>("wt-input[name=legalName]")!;
    const actions = dialog.querySelector<WtFormActions>("wt-form-actions")!;
    if (state !== "open") {
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Nuevo SL" },
          bubbles: true,
          composed: true,
        }),
      );
      await dialogHost.updateComplete;
      dialog.querySelector<HTMLElement>("wt-button[data-test=save-legal-name]")!.click();
      await expect.poll(() => actions.error).not.toBe("");
      if (state === "refused") await expect.poll(() => input.error).not.toBe("");
      await input.updateComplete;
      await actions.updateComplete;
    }
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    await expectNoA11yViolations(host);
  },
);
