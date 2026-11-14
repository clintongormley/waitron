import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "lit";
import {
  currentLocale,
  setLocale,
  type DashboardPermissionContinuation,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed, type Theme } from "@waitron/ui/src/a11y-helpers.js";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { FiscalFilingScreen } from "./fiscal-filing-screen.js";
import type { FilingOverviewAnswer } from "../filing-overview-types.js";
import { conflictCase, overview } from "../../test/fiscal-filing-browser-fixture.js";

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
  missingHistory: { notIssuedHere: [], identityChanges: [] },
  warnings: { replyMismatches: [], recordWarnings: [], total: 0 },
});

const MESSAGE = "Valor o tipo incorrecto del campo: DescripcionOperacion";
const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
/** A case AEAT refused for its operation description, which the dialog offers to correct. */
const DESCRIPTION = overview({
  cases: [
    {
      ...base,
      cause: "fiscal.registro_rechazado",
      evidence: { codigo: 1100, mensaje: MESSAGE, csv: null },
      submission: { ...base.submission!, codigoError: "1100", mensajeError: MESSAGE },
      conflicts: [],
    },
  ],
  totalCases: 1,
});

function continuation(permissions: string[]): DashboardPermissionContinuation {
  return {
    snapshot: () => ({ accountGeneration: 1, authenticated: true, permissions }),
    subscribe: () => () => {},
    signIn: async () => "stopped",
  };
}

async function show(
  answer: FilingOverviewAnswer,
  theme: Theme,
  permissions = ["report.export", "fiscal.remedy"],
): Promise<FiscalFilingScreen> {
  setLocale("en");
  await mountThemed("<div></div>", theme);
  const entry = VERIFACTU_DASHBOARD.moreScreens!.find((s) => s.screen.id === "fiscal-filing")!;
  const request = (async (path: string) => {
    if (path.endsWith("/remedy"))
      throw Object.assign(new Error("clock.unconfirmed"), { code: "clock.unconfirmed" });
    return answer;
  }) as unknown as DashboardRequest;
  render(
    entry.create({ request, permissionContinuation: continuation(permissions) }).render(),
    host,
  );
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

  it("draws the warnings with each one's technical details open", async () => {
    await page.viewport(1280, 1000);
    const screen = await show(overview(), theme);
    const folds = screen.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-disclosure"]>(
      "[data-test=warnings] wt-disclosure",
    );
    expect(folds).toHaveLength(3);
    for (const fold of folds) fold.open = true;
    await Promise.all([...folds].map((fold) => fold.whenSettled()));
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

  it("draws the description correction, then a refusal under its actions", async () => {
    await page.viewport(1280, 1000);
    const screen = await show(DESCRIPTION, theme);
    const details = await refuseOnce(screen);
    await expectNoA11yViolations(host);
    expect(details.querySelector("wt-textarea[name=operationDescription]")).not.toBeNull();
  });

  it("draws the administrator's sign-in in place of Send", async () => {
    await page.viewport(1280, 1000);
    const screen = await show(DESCRIPTION, theme, ["report.export"]);
    const details = await openDetails(screen);
    expect(details.querySelector("[data-test=put-right]")!.textContent).toContain("Sign in");
    await expectNoA11yViolations(host);
  });
});

/** Opens the case, edits its description and sends it, which the server refuses. */
async function refuseOnce(screen: FiscalFilingScreen): Promise<HTMLElement> {
  const details = await openDetails(screen);
  await expectNoA11yViolations(host);
  const area = details
    .querySelector("wt-textarea")!
    .shadowRoot!.querySelector("textarea") as HTMLTextAreaElement;
  area.value = "Servicio de restauración";
  area.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await screen.updateComplete;
  (details.querySelector("[data-test=put-right]") as HTMLElement).click();
  const actions = details.querySelector("wt-form-actions") as HTMLElement & { error: string };
  await vi.waitFor(() => expect(actions.error).not.toBe(""));
  await screen.updateComplete;
  return details;
}

it("draws the full page and a case's details at phone width", async () => {
  await page.viewport(390, 1000);
  const screen = await show(overview(), "light");
  await expectNoA11yViolations(host);
  expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth);

  const fold = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    "[data-test=reply-mismatches] wt-disclosure",
  )!;
  fold.open = true;
  await fold.whenSettled();
  await expectNoA11yViolations(host);
  expect(screen.scrollWidth).toBeLessThanOrEqual(screen.clientWidth);

  await openDetails(screen);
  await expectNoA11yViolations(host);
});

it("draws the description correction and its refusal at phone width", async () => {
  await page.viewport(390, 1000);
  const screen = await show(DESCRIPTION, "light");
  const details = await refuseOnce(screen);
  await expectNoA11yViolations(host);
  expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth);
});
