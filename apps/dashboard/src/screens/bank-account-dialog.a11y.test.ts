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
    params: { field: "iban", reason: "checksum" },
  },
  stale: { code: "venue.detail_changed", params: { field: "iban" } },
};

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    (["open", "refused", "stale"] as const).map((state) => ({ theme, locale, state })),
  ),
);

it.each(cases)(
  "the bank-account dialog has no accessibility violations: $state, $locale, $theme",
  async ({ theme, locale, state }) => {
    setLocale(locale);
    const api = {
      liveData: new LiveData(),
      getVenueDetails: vi.fn(async () => ({
        ...venueDetailsFixture(),
        bankAccount: { iban: "ES7620770024003102575766", bankName: "Openbank" },
      })),
      getVenueClockPreview: vi.fn(),
      patchVenueDetails: vi.fn(),
      saveBankAccount: vi.fn().mockRejectedValue(refusals[state]),
    } as unknown as DashboardApi;
    const { el: panel, host } = await mountWidget<Panel>(
      "dashboard-venue-details-panel",
      { api },
      theme,
    );
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=change-bank-account]"))
      .toBeTruthy();
    panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-bank-account]")!.click();
    const dialogHost = panel.shadowRoot!.querySelector("dashboard-bank-account-dialog")!;
    await dialogHost.updateComplete;
    const dialog = dialogHost.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    await expect.poll(() => dialog.open).toBe(true);
    const input = dialog.querySelector<WtInput>("wt-input[name=iban]")!;
    const actions = dialog.querySelector<WtFormActions>("wt-form-actions")!;
    if (state !== "open") {
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "ES9121000418450200051332" },
          bubbles: true,
          composed: true,
        }),
      );
      await dialogHost.updateComplete;
      dialog.querySelector<HTMLElement>("wt-button[data-test=save-bank-account]")!.click();
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
