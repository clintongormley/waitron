import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./look-card.js";

class LookLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  list!: ThemeList;
  override render() {
    return html`<dashboard-look-card
        .api=${this.api}
        .list=${this.list}
        .canEdit=${true}
      ></dashboard-look-card>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("look-card-leave-test-app", LookLeaveApp);
type Card = HTMLElementTagNameMap["dashboard-look-card"];

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const derived = deriveTheme(LUCIA);
const lucia: ThemeView = {
  id: "t-lucia",
  name: "Bar Lucía",
  updatedAt: "2026-10-21T10:00:00.000Z",
  choices: LUCIA,
  light: derived.light,
  dark: derived.dark,
  warnings: derived.warnings,
};

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function mount() {
  const saveTheme = vi.fn(async (id: string, choices: ThemeChoices) => ({
    ...lucia,
    id,
    choices,
  }));
  const api = { saveTheme } as unknown as DashboardApi;
  const { el: app } = await mountWidget<LookLeaveApp>("look-card-leave-test-app", {
    api,
    list: { themes: [lucia], inUse: lucia.id },
  });
  const card = app.shadowRoot!.querySelector("dashboard-look-card")!;
  await card.updateComplete;
  await userEvent.click(q(card, "[data-test=edit]")!);
  await card.updateComplete;
  return { app, card, saveTheme };
}
const q = (card: Card, selector: string) => card.shadowRoot!.querySelector<HTMLElement>(selector);
const corners = (card: Card) =>
  q(card, "wt-segmented-control[name=corners]") as HTMLElementTagNameMap["wt-segmented-control"];
const save = (card: Card) => q(card, "[data-test=save]") as HTMLElementTagNameMap["wt-button"];
const editing = (card: Card) => q(card, "section.settings-card")!.hasAttribute("data-editing");
async function square(card: Card) {
  const choice = [...corners(card).shadowRoot!.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === t("appearance.corners.square"),
  )!;
  await userEvent.click(choice);
  await card.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: LookLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: LookLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}

it("Keep on leaving with a changed draft keeps it", async () => {
  const { app, card } = await mount();
  await square(card);
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(corners(card).value).toBe("square");
  expect(unload()).toBe(true);
});

it("Discard on leaving restores the saved rows without a write", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await expect.poll(() => editing(card)).toBe(false);
  expect(q(card, "[data-test=saved-corners]")!.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "Round",
  );
  expect(saveTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});

it("a reverted draft leaves without asking", async () => {
  const { app, card } = await mount();
  await userEvent.click(q(card, 'button.swatch[data-color="#b12525"]')!);
  await card.updateComplete;
  expect(unload()).toBe(true);
  const code = q(card, "wt-input[name=brandColor]")!.shadowRoot!.querySelector("input")!;
  await page.elementLocator(code).fill("#1e5b3a");
  await card.updateComplete;
  expect(save(card).disabled).toBe(true);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("Cancel asks with a changed draft: Keep stays, Discard returns to the saved rows", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  q(card, "[data-test=cancel]")!.click();
  await choose(app, "keep");
  expect(editing(card)).toBe(true);
  expect(corners(card).value).toBe("square");
  q(card, "[data-test=cancel]")!.click();
  await choose(app, "discard");
  await expect.poll(() => editing(card)).toBe(false);
  expect(saveTheme).not.toHaveBeenCalled();
  expect(unload()).toBe(false);
});

it("after a successful save, leaving asks nothing", async () => {
  const { app, card, saveTheme } = await mount();
  await square(card);
  await userEvent.click(save(card));
  await expect.poll(() => editing(card)).toBe(false);
  expect(saveTheme).toHaveBeenCalledTimes(1);
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});

it("an edit made before the card is taken out still counts once it is put back", async () => {
  const { app, card } = await mount();
  await square(card);
  card.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(card);
  await card.updateComplete;
  await expect.poll(() => corners(card)?.value).toBe("square");
  expect(save(card).disabled).toBe(false);
  expect(unload()).toBe(true);
});
