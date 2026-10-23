import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtDialog, WtRowActions } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { DashboardApi, type ThemeList, type ThemeView } from "../api/client.js";
import type { ThemesChanged } from "./themes-card.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
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

it("leaves the venue settings page's space between the Look card and the Themes card", async () => {
  const { api } = stubApi([json(listOf(GREEN))]);
  const el = await mount(api);
  await expect.poll(() => themesCard(el)?.list).toEqual(listOf(GREEN));
  const look = card(el)!.shadowRoot!.querySelector("section")!.getBoundingClientRect();
  const themes = themesCard(el)!.shadowRoot!.querySelector("section")!.getBoundingClientRect();
  const space = parseFloat(
    getComputedStyle(el).getPropertyValue("--wt-space-5") ||
      getComputedStyle(document.documentElement).getPropertyValue("--wt-space-5"),
  );
  expect(space).toBeGreaterThan(0);
  expect(themes.top - look.bottom).toBeCloseTo(space, 0);
});

describe("the page opens the Look card's editor from the Themes card", () => {
  const LUCIA = theme({ ...WAITRON_CHOICES, brandColor: "#1e5b3a", corners: "round" });
  const CHRISTMAS = named(
    theme({
      ...WAITRON_CHOICES,
      brandColor: "#7a1f2b",
      brandFix: { dark: true },
      corners: "round",
      logo: null,
    }),
    "t-xmas",
    "Christmas",
  );
  const BOTH: ThemeList = { themes: [LUCIA, CHRISTMAS], inUse: LUCIA.id };

  /** Answers by method and path; `lists` are the successive answers to the list read. */
  function routedApi(lists: ThemeList[]) {
    let reads = 0;
    const fetchImpl = vi.fn(async (path: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const id = path.split("/").at(-1)!;
      const answer = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (path === "/management-api/themes" && method === "GET") {
        return answer(lists[Math.min(reads++, lists.length - 1)]);
      }
      if (method === "PATCH") return answer({ ...CHRISTMAS, id, name: body.name });
      if (method === "PUT" && path.endsWith("/theme-in-use"))
        return answer({ inUse: body.customThemeId });
      if (method === "PUT") return answer({ error: { code: "theme.not_found" } }, 404);
      return answer({ hash: "h2", css: "", logo: null });
    });
    return { api: new DashboardApi("", fetchImpl, undefined, vi.fn()), fetchImpl };
  }

  const lookQ = (el: Screen, selector: string) =>
    card(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const heading = (el: Screen) => text(lookQ(el, "section.settings-card header > h2"));
  const editingLine = (el: Screen) => text(lookQ(el, "[data-test=editing-line]"));
  const cornersValue = (el: Screen) =>
    (
      lookQ(
        el,
        "wt-segmented-control[name=corners]",
      ) as HTMLElementTagNameMap["wt-segmented-control"]
    ).value;
  const table = (el: Screen) =>
    themesCard(el)!.shadowRoot!.querySelector(
      "wt-data-table",
    ) as HTMLElementTagNameMap["wt-data-table"];
  const menu = (el: Screen, key: string) =>
    table(el).shadowRoot!.querySelector(`tr[data-row-key="${key}"] wt-row-actions`) as HTMLElement;

  async function settle(el: Screen): Promise<void> {
    await flush(el);
    await table(el).updateComplete;
  }

  async function openMenu(el: Screen, key: string): Promise<HTMLElement> {
    await table(el).updateComplete;
    for (const open of table(el).shadowRoot!.querySelectorAll<WtRowActions>("wt-row-actions")) {
      open.hide();
    }
    const actions = menu(el, key);
    await userEvent.click(actions.shadowRoot!.querySelector("button")!);
    return actions;
  }

  async function choose(el: Screen, key: string, item: string): Promise<void> {
    const actions = await openMenu(el, key);
    await userEvent.click(actions.querySelector<HTMLElement>(`[data-test="${item}-${key}"]`)!);
    await settle(el);
  }

  async function squareCorners(el: Screen): Promise<void> {
    const control = lookQ(el, "wt-segmented-control[name=corners]")!;
    const choice = [...control.shadowRoot!.querySelectorAll("button")].find(
      (b) => text(b) === t("appearance.corners.square"),
    )!;
    await userEvent.click(choice);
    await settle(el);
  }

  async function mountBoth(lists: ThemeList[] = [BOTH]) {
    setLocale("en-GB");
    const stub = routedApi(lists);
    const el = await mount(stub.api);
    await expect.poll(() => themesCard(el)?.list).toEqual(lists[0]);
    const scroll = vi.spyOn(card(el)!, "scrollIntoView").mockImplementation(() => {});
    await settle(el);
    return { el, scroll, ...stub };
  }

  it("a row's Edit and Add theme open the Look card's editor", async () => {
    const { el, scroll } = await mountBoth();
    await choose(el, "t-xmas", "edit");
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith({ block: "start" });
    expect(themesCard(el)!.editingId).toBe("t-xmas");
    await userEvent.click(
      themesCard(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=new-theme]")!,
    );
    await settle(el);
    expect(heading(el)).toBe("Add theme");
    expect(themesCard(el)!.editingId).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("the theme being edited has no Delete on its row", async () => {
    const { el } = await mountBoth();
    await choose(el, "t-xmas", "edit");
    let actions = await openMenu(el, "t-xmas");
    expect(actions.querySelector("[data-test=delete-t-xmas]")).toBeNull();
    expect(actions.querySelector("[data-test=edit-t-xmas]")).not.toBeNull();
    (actions as WtRowActions).hide();
    await userEvent.click(lookQ(el, "[data-test=cancel]")!);
    await settle(el);
    expect(themesCard(el)!.editingId).toBeNull();
    actions = await openMenu(el, "t-xmas");
    expect(actions.querySelector("[data-test=delete-t-xmas]")).not.toBeNull();
  });

  it("renaming the edited theme from its row renames the editor's heading", async () => {
    const { el } = await mountBoth();
    await choose(el, "t-xmas", "edit");
    await squareCorners(el);
    await choose(el, "t-xmas", "rename");
    const host = themesCard(el)!.shadowRoot!.querySelector("dashboard-theme-name-dialog")!;
    await host.updateComplete;
    const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog[data-test=name-dialog]")!;
    await expect.poll(() => dialog.open).toBe(true);
    dialog.querySelector("wt-input[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Holiday" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    const closed = dialogClosed(dialog);
    await userEvent.click(dialog.querySelector<WtButton>("wt-button[data-test=name-save]")!);
    await closed;
    await settle(el);
    expect(heading(el)).toBe("Edit theme: Holiday");
    expect(cornersValue(el)).toBe("square");
  });

  it("a rename from another dashboard does the same", async () => {
    const { el, api } = await mountBoth([
      BOTH,
      { ...BOTH, themes: [LUCIA, named(CHRISTMAS, "t-xmas", "Holiday")] },
    ]);
    await choose(el, "t-xmas", "edit");
    await squareCorners(el);
    api.liveData.invalidate([{ type: "custom_themes" }]);
    await expect.poll(() => heading(el)).toBe("Edit theme: Holiday");
    expect(cornersValue(el)).toBe("square");
  });

  it("a switch leaves the draft and the editor as they are", async () => {
    const { el } = await mountBoth();
    await choose(el, "t-xmas", "edit");
    await squareCorners(el);
    const useRow = async (key: string) => {
      await choose(el, key, "use");
      const host = themesCard(el)!.shadowRoot!.querySelector("dashboard-theme-switch-dialog")!;
      await host.updateComplete;
      const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
      await expect.poll(() => dialog.open).toBe(true);
      const closed = dialogClosed(dialog);
      await userEvent.click(dialog.querySelector<WtButton>("wt-button[data-test=switch-use]")!);
      await closed;
      await settle(el);
    };
    await useRow("t-xmas");
    expect(heading(el)).toBe("Look");
    expect(editingLine(el)).toBe("Theme in use: Christmas. Saving changes every screen.");
    expect(cornersValue(el)).toBe("square");
    await useRow("t-lucia");
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(cornersValue(el)).toBe("square");
  });

  it("a delete from another dashboard keeps slice 5's behaviour", async () => {
    const { el, api, fetchImpl } = await mountBoth([BOTH, { themes: [LUCIA], inUse: LUCIA.id }]);
    expect(CHRISTMAS.warnings).toEqual([]);
    await choose(el, "t-xmas", "edit");
    await squareCorners(el);
    api.liveData.invalidate([{ type: "custom_themes" }]);
    await expect.poll(() => card(el)!.list?.themes.length).toBe(1);
    await settle(el);
    expect(editingLine(el)).toBe(t("appearance.editing_not_in_use"));
    expect(heading(el)).toBe("Edit theme: Christmas");
    expect(cornersValue(el)).toBe("square");
    await userEvent.click(lookQ(el, "[data-test=save]")!);
    const actions = lookQ(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"];
    await expect
      .poll(async () => (await formMessageOf(actions))?.textContent?.trim())
      .toBe(codeMessage("theme.not_found"));
    expect((lookQ(el, "[data-test=save]") as WtButton).disabled).toBe(false);
    expect(fetchImpl.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(1);
  });
});
