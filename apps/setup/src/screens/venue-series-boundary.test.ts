import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each([
  [
    "en-GB",
    "up to 21 characters",
    "Leave the defaults unless you have a good reason to change them.",
  ],
  [
    "es-ES",
    "hasta 21 caracteres",
    "Deja los valores predeterminados salvo que tengas un buen motivo para cambiarlos.",
  ],
] as const)(
  "shows the approved series limit beside the refused field in %s",
  async (locale, limit, advice) => {
    setLocale(locale);
    const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
      invalidField: "seriesCode",
    });
    const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[data-test="seriesCode"]',
    )!;
    await field.updateComplete;
    expect(field.shadowRoot!.textContent).toContain(limit);
    const help = field.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    await help.updateComplete;
    await userEvent.click(help.shadowRoot!.querySelector("button")!);
    expect(help.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    expect(help.textContent!.trim()).toBe(advice);
  },
);
