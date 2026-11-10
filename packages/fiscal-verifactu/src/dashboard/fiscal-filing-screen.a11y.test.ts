import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "lit";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed, type Theme } from "@waitron/ui/src/a11y-helpers.js";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { FiscalFilingScreen } from "./fiscal-filing-screen.js";
import type { FilingOverviewAnswer } from "../filing-overview-types.js";
import { overview } from "../../test/fiscal-filing-browser-fixture.js";

const size = { width: window.innerWidth, height: window.innerHeight };
const locale = currentLocale();
afterEach(async () => {
  render(null, host);
  cleanup();
  setLocale(locale);
  await page.viewport(size.width, size.height);
});

const EMPTY = overview({
  cases: [],
  totalCases: 0,
  activeConflicts: [],
  heldWithoutCase: 0,
});

async function show(answer: FilingOverviewAnswer, theme: Theme): Promise<FiscalFilingScreen> {
  setLocale("en");
  await mountThemed("<div></div>", theme);
  const entry = VERIFACTU_DASHBOARD.moreScreens!.find((s) => s.screen.id === "fiscal-filing")!;
  const request = (async () => answer) as unknown as DashboardRequest;
  render(entry.create({ request }).render(), host);
  const screen = host.querySelector("vf-fiscal-filing-screen") as FiscalFilingScreen;
  await vi.waitFor(() =>
    expect(screen.shadowRoot?.querySelector("[data-state=read]")).not.toBeNull(),
  );
  const table = screen.shadowRoot!.querySelector("wt-data-table") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await table.updateComplete;
  await screen.updateComplete;
  return screen;
}

async function openDetails(screen: FiscalFilingScreen): Promise<HTMLElement> {
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  const view = (table.shadowRoot!.querySelector("[data-test=view-rec-1]") ??
    table.querySelector("[data-test=view-rec-1]")) as HTMLElement;
  view.click();
  const details = screen.shadowRoot!.querySelector("wt-modal[data-test=case-details]")!;
  await vi.waitFor(() => expect(details).toHaveProperty("open", true));
  return details as HTMLElement;
}

describe.each(["light", "dark"] as const)("fiscal filing accessibility %s", (theme) => {
  it.each([
    ["with cases and an identity conflict", overview()],
    ["with nothing to show", EMPTY],
  ] as const)("draws the page %s at desktop width", async (_name, answer) => {
    await page.viewport(1280, 1000);
    await show(answer, theme);
    await expectNoA11yViolations(host);
  });

  it("draws the conflict box with its technical details open", async () => {
    await page.viewport(1280, 1000);
    const screen = await show(overview(), theme);
    const fold = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
      "[data-test=conflict] wt-disclosure",
    )!;
    fold.open = true;
    await fold.whenSettled();
    await expectNoA11yViolations(host);
  });

  it("draws a case's details with the technical details closed and open", async () => {
    await page.viewport(1280, 1000);
    const screen = await show(overview(), theme);
    const details = await openDetails(screen);
    await expectNoA11yViolations(host);
    const fold = details.querySelector("wt-disclosure")!;
    fold.open = true;
    await fold.whenSettled();
    await expectNoA11yViolations(host);
  });
});

it("draws the full page and a case's details at phone width", async () => {
  await page.viewport(390, 1000);
  const screen = await show(overview(), "light");
  await expectNoA11yViolations(host);
  expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth);

  await openDetails(screen);
  await expectNoA11yViolations(host);
});
