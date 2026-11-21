import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import "./venue-details-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];

let width = 0;
let height = 0;

beforeEach(() => {
  width = window.innerWidth;
  height = window.innerHeight;
});

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(width, height);
  setLocale("en-GB");
});

async function opened(viewport: number): Promise<{ host: HTMLElement; dialog: WtDialog }> {
  await page.viewport(viewport, 800);
  const api = {
    liveData: new LiveData(),
    getVenueDetails: vi.fn(async () => venueDetailsFixture()),
    getVenueClockPreview: vi.fn(),
    patchVenueDetails: vi.fn(),
    changeTaxpayerDomicile: vi.fn(),
  } as unknown as DashboardApi;
  const { el: panel } = await mountWidget<Panel>("dashboard-venue-details-panel", { api });
  await expect
    .poll(() => panel.shadowRoot!.querySelector("[data-test=change-taxpayer-domicile]"))
    .toBeTruthy();
  panel.shadowRoot!.querySelector<HTMLElement>("[data-test=change-taxpayer-domicile]")!.click();
  const host = panel.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    "dashboard-registered-address-dialog",
  )!;
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  await dialog.updateComplete;
  return { host, dialog };
}

const box = (dialog: WtDialog, selector: string) =>
  dialog.querySelector(selector)!.getBoundingClientRect();

it.each([
  ["en-GB", 375],
  ["es-ES", 375],
])("stacks Postcode over City on a phone (%s, %i px)", async (locale, viewport) => {
  setLocale(locale);
  const { dialog } = await opened(viewport);
  const postcode = box(dialog, "[name=registeredPostalCode]");
  const city = box(dialog, "[name=registeredCity]");
  expect(city.top).toBeGreaterThanOrEqual(postcode.bottom);
  expect(Math.round(city.width)).toBe(Math.round(postcode.width));
});

it("keeps Postcode and City side by side on a wide screen", async () => {
  const { dialog } = await opened(1280);
  const postcode = box(dialog, "[name=registeredPostalCode]");
  const city = box(dialog, "[name=registeredCity]");
  expect(Math.round(city.top)).toBe(Math.round(postcode.top));
  expect(city.left).toBeGreaterThan(postcode.right);
});

it.each([375, 1280])(
  "keeps its width when the switch turns on, and sets the switch's note apart from the invoices note (%i px)",
  async (viewport) => {
    const { host, dialog } = await opened(viewport);
    const native = dialog.shadowRoot!.querySelector("dialog")!;
    const off = native.getBoundingClientRect().width;
    dialog
      .querySelector("wt-switch[name=registeredSameAsVenue]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
      );
    await (host as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(dialog.querySelector("[name=registeredStreet]")).toBeNull();
    expect(native.getBoundingClientRect().width).toBe(off);
    const hint = box(dialog, "[data-test=registered-same-hint]");
    const note = box(dialog, ".note");
    const toggle = box(dialog, "wt-switch[name=registeredSameAsVenue]");
    // Small text at the fields' own gap ran into the note below; a field's margin sets it apart.
    const space4 = parseFloat(
      getComputedStyle(dialog).getPropertyValue("--wt-space-4").replace("px", ""),
    );
    expect(space4).toBeGreaterThan(0);
    expect(note.top - hint.bottom).toBeGreaterThanOrEqual(space4);
    expect(hint.top - toggle.bottom).toBeLessThan(note.top - hint.bottom);
  },
);
