import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import type { WtInput } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { VenueDetailsPanel } from "./venue-details-panel.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(1280, 900);
});
const cases = ["light", "dark"].flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    [390, 1280].map((width) => ({ theme: theme as "light" | "dark", locale, width })),
  ),
);

it.each(cases)(
  "renders and scans venue details in $locale, $theme, $width px",
  async ({ theme, locale, width }) => {
    await page.viewport(width, 900);
    expect(window.innerWidth).toBe(width);
    setLocale(locale);
    for (const state of [
      "read-only",
      "locked",
      "legacy-null",
      "invalid",
      "warnings",
      "stale",
      "loading",
      "read-error",
      "refresh-error",
    ]) {
      const model = venueDetailsFixture(
        state === "legacy-null"
          ? { addressLine1: null, postalCode: null, city: null, province: null }
          : {},
      );
      if (state === "locked") {
        model.hasSales = true;
        model.policy.timeZone = { decision: "refuse", reasons: ["sales"] };
        model.policy.dayCutover = { decision: "refuse", reasons: ["sales"] };
      }
      const api = {
        liveData: new LiveData(),
        getVenueDetails: vi.fn().mockResolvedValue(model),
        patchVenueDetails: vi.fn().mockResolvedValue({
          changed: true,
          model: venueDetailsFixture({ addressLine1: "New street" }),
        }),
      } as unknown as DashboardApi;
      if (state === "loading")
        vi.mocked(api.getVenueDetails).mockImplementation(() => new Promise(() => undefined));
      if (state === "read-error")
        vi.mocked(api.getVenueDetails).mockRejectedValue({ code: "connection.failed" });
      if (state === "refresh-error")
        vi.mocked(api.getVenueDetails)
          .mockResolvedValueOnce(model)
          .mockRejectedValue({ code: "connection.failed" });
      if (state === "stale")
        vi.mocked(api.patchVenueDetails).mockRejectedValue({
          code: "venue.detail_changed",
          params: { field: "addressLine1" },
        });
      const { el, host } = await mountWidget<VenueDetailsPanel>(
        "dashboard-venue-details-panel",
        { api, readOnly: state === "read-only" },
        theme,
      );
      const flush = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
      };
      await flush();
      if (!["read-only", "loading", "read-error"].includes(state)) {
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit]")!.click();
        await flush();
        if (["invalid", "warnings", "stale", "refresh-error"].includes(state)) {
          const name = state === "warnings" ? "venueName" : "addressLine1";
          const field = el.shadowRoot!.querySelector<WtInput>(`[name=${name}]`)!;
          field.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: state === "invalid" ? " " : "New street" },
              bubbles: true,
              composed: true,
            }),
          );
          await flush();
          if (state !== "warnings") {
            el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
            await flush();
          }
        }
      }
      await expectNoA11yViolations(host);
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        element: host,
        path: `look/venue-details-panel-${locale}-${theme}-${width}-${state}.png`,
      });
      const actions = el.shadowRoot!.querySelector("wt-form-actions");
      if (actions) {
        actions.scrollIntoView({ block: "end" });
        await page.screenshot({
          path: `look/venue-details-panel-${locale}-${theme}-${width}-${state}-bottom.png`,
        });
      }
      cleanupWidgets();
    }
  },
  30_000,
);
