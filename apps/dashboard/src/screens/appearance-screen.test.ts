import { afterEach, expect, it, vi } from "vitest";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { DashboardApi, type ThemeList, type ThemeView } from "../api/client.js";
import type { ThemesChanged } from "./themes-card.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./appearance-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-appearance-screen"];
type Card = HTMLElementTagNameMap["dashboard-look-card"];
type ThemesCard = HTMLElementTagNameMap["dashboard-themes-card"];

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Screen, selector: string) => el.shadowRoot!.querySelector(selector);
const card = (el: Screen) => q(el, "dashboard-look-card") as Card | null;
const themesCard = (el: Screen) => q(el, "dashboard-themes-card") as ThemesCard | null;
const brand = (el: Screen) => text(card(el)?.shadowRoot?.querySelector("[data-test=saved-brand]"));
const flush = async (el: Screen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await card(el)?.updateComplete;
  await themesCard(el)?.updateComplete;
};

function theme(choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id: "t-lucia",
    name: "Bar Lucía",
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}
const GREEN = theme({ ...WAITRON_CHOICES, brandColor: "#1e5b3a" });
const BLUE = theme({ ...WAITRON_CHOICES, brandColor: "#2a4b8d" });
const listOf = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });

function stubApi(answers: Array<() => Promise<Response>>) {
  let next = 0;
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(() =>
    answers[Math.min(next++, answers.length - 1)]!(),
  );
  const active = vi.fn();
  return { api: new DashboardApi("", fetchImpl, undefined, active), fetchImpl, active };
}
const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

async function mount(api: DashboardApi, canEdit = true): Promise<Screen> {
  const { el } = await mountWidget<Screen>("dashboard-appearance-screen", { api, canEdit });
  await flush(el);
  return el;
}

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

it("heads the page and hands the card the list and the editing right", async () => {
  setLocale("en-GB");
  const { api } = stubApi([json(listOf(GREEN))]);
  const el = await mount(api, false);
  expect(text(q(el, "h1"))).toBe(t("appearance.title"));
  await expect.poll(() => card(el)?.list).toEqual(listOf(GREEN));
  expect(card(el)!.canEdit).toBe(false);
  expect(card(el)!.api).toBe(api);
});

it("sends its first read as activity and a live re-read passively", async () => {
  setLocale("en-GB");
  const { api, fetchImpl, active } = stubApi([json(listOf(GREEN)), json(listOf(BLUE))]);
  const el = await mount(api);
  await expect.poll(() => brand(el)).toBe("Custom · #1e5b3a");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0]![0]).toBe("/management-api/themes");
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);

  api.liveData.invalidate([{ type: "custom_themes" }]);
  await expect.poll(() => brand(el)).toBe("Custom · #2a4b8d");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1]![0]).toBe("/management-api/themes");
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();
});

it("shows a failed read's message, and Retry reads again", async () => {
  setLocale("en-GB");
  const { api, fetchImpl } = stubApi([
    json({ error: { code: "permission.denied" } }, 403),
    json(listOf(GREEN)),
  ]);
  const el = await mount(api);
  await expect
    .poll(() => text(q(el, "[data-test=read-error]")))
    .toBe(codeMessage("permission.denied"));
  expect(card(el)).toBeNull();
  (q(el, "[data-test=retry]") as HTMLElement).click();
  await expect.poll(() => brand(el)).toBe("Custom · #1e5b3a");
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("takes a saved theme into the card at once, and a read sent before the save does not undo it", async () => {
  setLocale("en-GB");
  let answerStale: (response: Response) => void = () => {};
  const { api, fetchImpl } = stubApi([
    json(listOf(GREEN)),
    () =>
      new Promise<Response>((resolve) => {
        answerStale = resolve;
      }),
    json(listOf(BLUE)),
  ]);
  const el = await mount(api);
  await expect.poll(() => brand(el)).toBe("Custom · #1e5b3a");

  api.liveData.invalidate([{ type: "custom_themes" }]);
  await expect.poll(() => fetchImpl.mock.calls.length).toBe(2);
  card(el)!.dispatchEvent(
    new CustomEvent("themes-changed", {
      detail: { kind: "saved", theme: BLUE },
      bubbles: true,
      composed: true,
    }),
  );
  await flush(el);
  expect(brand(el)).toBe("Custom · #2a4b8d");

  answerStale(new Response(JSON.stringify(listOf(GREEN)), { status: 200 }));
  await flush(el);
  await flush(el);
  expect(brand(el)).toBe("Custom · #2a4b8d");
});

it("renders the Themes card under the Look card with the same list and editing right", async () => {
  const { api } = stubApi([json(listOf(GREEN))]);
  const el = await mount(api, false);
  await expect.poll(() => themesCard(el)?.list).toEqual(listOf(GREEN));
  expect(themesCard(el)!.canEdit).toBe(false);
  expect(themesCard(el)!.api).toBe(api);
  expect(card(el)!.nextElementSibling).toBe(themesCard(el));
});

const named = (view: ThemeView, id: string, name: string): ThemeView => ({ ...view, id, name });
const XMAS = named(GREEN, "t-xmas", "Christmas");
const START: ThemeList = { themes: [GREEN, XMAS], inUse: GREEN.id };
const changes: Array<{ name: string; change: ThemesChanged; after: ThemeList }> = [
  {
    name: "saved",
    change: { kind: "saved", theme: BLUE },
    after: { themes: [BLUE, XMAS], inUse: GREEN.id },
  },
  {
    name: "created in use",
    change: { kind: "created", theme: named(BLUE, "t-aard", "Aardvark"), inUse: true },
    after: { themes: [named(BLUE, "t-aard", "Aardvark"), GREEN, XMAS], inUse: "t-aard" },
  },
  {
    name: "created not in use",
    change: { kind: "created", theme: named(BLUE, "t-don", "Dahlia"), inUse: false },
    after: { themes: [GREEN, XMAS, named(BLUE, "t-don", "Dahlia")], inUse: GREEN.id },
  },
  {
    name: "renamed",
    change: { kind: "renamed", theme: named(GREEN, GREEN.id, "Zebra") },
    after: { themes: [XMAS, named(GREEN, GREEN.id, "Zebra")], inUse: GREEN.id },
  },
  {
    name: "deleted",
    change: { kind: "deleted", id: GREEN.id, inUse: null },
    after: { themes: [XMAS], inUse: null },
  },
  {
    name: "switched",
    change: { kind: "switched", inUse: "t-xmas" },
    after: { themes: [GREEN, XMAS], inUse: "t-xmas" },
  },
];

it.each(changes)(
  "applies a $name change to both cards at once, and a read sent before it does not undo it",
  async ({ change, after }) => {
    let answerStale: (response: Response) => void = () => {};
    const { api, fetchImpl } = stubApi([
      json(START),
      () =>
        new Promise<Response>((resolve) => {
          answerStale = resolve;
        }),
    ]);
    const el = await mount(api);
    await expect.poll(() => themesCard(el)?.list).toEqual(START);

    api.liveData.invalidate([{ type: "custom_themes" }]);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(2);
    themesCard(el)!.dispatchEvent(
      new CustomEvent("themes-changed", { detail: change, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(themesCard(el)!.list).toEqual(after);
    expect(card(el)!.list).toEqual(after);

    answerStale(new Response(JSON.stringify(START), { status: 200 }));
    await flush(el);
    await flush(el);
    expect(themesCard(el)!.list).toEqual(after);
    expect(card(el)!.list).toEqual(after);
  },
);
