import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { ColumnKey, ColumnState } from "../state/kitchen-columns.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage, textRects } from "./test-helpers.js";
import { stationColumnNames } from "./station-queue.js";
import { TillKitchenColumnsDialog } from "./kitchen-columns-dialog.js";

afterEach(cleanupWidgets);

const layout = (over: Partial<ColumnState> = {}): ColumnState => ({
  order: ["waiting", "preparing", "ready"],
  hidden: [],
  collapsed: [],
  ...over,
});

const mount = (over: Partial<TillKitchenColumnsDialog> = {}) =>
  mountWidget<TillKitchenColumnsDialog>("till-kitchen-columns-dialog", {
    layout: layout(),
    names: stationColumnNames(),
    boardName: "Grill",
    opener: null,
    ...over,
  });

const part = (el: TillKitchenColumnsDialog, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean; checked: boolean }>(selector)!;
const rows = (el: TillKitchenColumnsDialog) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-column-row]")].map((row) => [
    row.querySelector("[data-column-number]")!.textContent!.trim(),
    row.querySelector("[data-column-name]")!.textContent!.trim(),
  ]);

function heard<T>(el: Element, name: string): T[] {
  const details: T[] = [];
  el.addEventListener(name, (event) => details.push((event as CustomEvent<T>).detail));
  return details;
}

describe("the Columns window", () => {
  it("lists the columns it has names for, in the layout's order, numbered", async () => {
    const { el } = await mount({
      layout: layout({ order: ["ready", "held", "waiting", "preparing"] }),
    });
    expect(rows(el)).toEqual([
      ["1", t("station.state.ready")],
      ["2", t("station.state.queued")],
      ["3", t("station.state.preparing")],
    ]);
  });

  it("is headed Columns, names its board, and says the choice stays on this device", async () => {
    const { el } = await mount();
    const dialog = page.getByRole("dialog", { name: "Columns", exact: true });
    await expect.element(dialog).toBeInTheDocument();
    await expect.element(dialog).toHaveAccessibleDescription("Grill");
    expect(part(el, "[data-columns-kept]").textContent!.trim()).toBe("Chosen on this device");
  });

  it("the first row cannot move up and the last cannot move down", async () => {
    const { el } = await mount();
    const disabled = (["waiting", "preparing", "ready"] as const).flatMap((key) => [
      part(el, `[data-column-up="${key}"]`).disabled,
      part(el, `[data-column-down="${key}"]`).disabled,
    ]);
    expect(disabled).toEqual([true, false, false, false, false, true]);
  });

  it("an arrow asks to move its column and changes nothing itself", async () => {
    const { el } = await mount({ layout: layout({ order: ["ready", "waiting", "preparing"] }) });
    const moves = heard<{ key: ColumnKey; direction: string }>(el, "column-move");
    await userEvent.click(part(el, '[data-column-down="ready"]'));
    expect(moves).toEqual([{ key: "ready", direction: "down" }]);
    await el.updateComplete;
    expect(rows(el).map(([, name]) => name)).toEqual([
      t("station.state.ready"),
      t("station.state.queued"),
      t("station.state.preparing"),
    ]);
  });

  it("after a move the focus stays on the moved row's arrow, or its other arrow at an end", async () => {
    const { el } = await mount();
    const moves = heard<{ key: ColumnKey; direction: "up" | "down" }>(el, "column-move");
    part(el, '[data-column-down="waiting"]').focus();
    await userEvent.keyboard("{Enter}");
    expect(moves).toEqual([{ key: "waiting", direction: "down" }]);
    el.layout = layout({ order: ["preparing", "waiting", "ready"] });
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(part(el, '[data-column-down="waiting"]'));
    await userEvent.keyboard("{Enter}");
    expect(moves).toHaveLength(2);
    el.layout = layout({ order: ["preparing", "ready", "waiting"] });
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(part(el, '[data-column-up="waiting"]'));
  });

  it.each(["en-GB", "es-ES"])(
    "each arrow and switch is named for its column (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const ready = t("station.state.ready");
        const up = `${t("station.columns_move_up")} ${ready}`;
        const down = `${t("station.columns_move_down")} ${ready}`;
        const show = `${t("station.columns_show")} ${ready}`;
        if (locale === "en-GB")
          expect([up, down, show]).toEqual(["Move up Ready", "Move down Ready", "Show Ready"]);
        else {
          expect(t("station.columns_move_up")).not.toBe("Move up");
          expect(t("station.columns_move_down")).not.toBe("Move down");
          expect(t("station.columns_show")).not.toBe("Show");
          expect(ready).not.toBe("Ready");
        }
        await mount();
        await expect
          .element(page.getByRole("button", { name: up, exact: true }))
          .toBeInTheDocument();
        await expect
          .element(page.getByRole("button", { name: down, exact: true }))
          .toBeInTheDocument();
        await expect
          .element(page.getByRole("switch", { name: show, exact: true }))
          .toBeInTheDocument();
      } finally {
        setLocale(before);
      }
    },
  );

  it("a Show switch asks to hide or show its column, and its change stops at the window", async () => {
    const { el, host } = await mount();
    const shows = heard<{ key: ColumnKey; visible: boolean }>(el, "column-show");
    const changes = heard<unknown>(host, "wt-change");
    expect(part(el, '[data-column-show="ready"]').checked).toBe(true);
    await userEvent.click(part(el, '[data-column-show="ready"]'));
    expect(shows).toEqual([{ key: "ready", visible: false }]);
    expect(changes).toHaveLength(0);

    el.layout = layout({ hidden: ["ready"] });
    await el.updateComplete;
    expect(part(el, '[data-column-show="ready"]').checked).toBe(false);
    await userEvent.click(part(el, '[data-column-show="ready"]'));
    expect(shows[1]).toEqual({ key: "ready", visible: true });
  });

  it("the last shown column can be hidden too", async () => {
    const { el } = await mount({ layout: layout({ hidden: ["waiting", "preparing"] }) });
    const shows = heard<{ key: ColumnKey; visible: boolean }>(el, "column-show");
    expect(part(el, '[data-column-show="ready"]').disabled).toBe(false);
    await userEvent.click(part(el, '[data-column-show="ready"]'));
    expect(shows).toEqual([{ key: "ready", visible: false }]);

    el.layout = layout({ hidden: ["waiting", "preparing", "ready"] });
    await el.updateComplete;
    for (const key of ["waiting", "preparing", "ready"]) {
      expect(part(el, `[data-column-show="${key}"]`).disabled).toBe(false);
      expect(part(el, `[data-column-show="${key}"]`).checked).toBe(false);
    }
  });

  it.each(["Done", "Escape"] as const)("%s closes the window and sends close once", async (how) => {
    const { el } = await mount();
    const closes = heard<unknown>(el, "close");
    if (how === "Done") await userEvent.click(part(el, "[data-columns-done]"));
    else {
      part(el, '[data-column-down="waiting"]').focus();
      await userEvent.keyboard("{Escape}");
    }
    await vi.waitFor(() => expect(closes).toHaveLength(1));
    expect(el.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
  });

  it.each(["en-GB", "es-ES"])(
    "at 390 px each column's name is drawn whole on one line, its row inside the window (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        await pageAt(390, 844);
        const { el } = await mount();
        for (const row of el.shadowRoot!.querySelectorAll<HTMLElement>("[data-column-row]")) {
          const name = row.querySelector("[data-column-name]")!;
          const lineTops = new Set(textRects(name).map((line) => Math.round(line.top)));
          expect(lineTops.size, name.textContent!).toBe(1);
          expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
        }
      } finally {
        setLocale(before);
        await resetPage();
      }
    },
  );

  it("reads its heading, Done and the note in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mount();
      expect(t("station.columns")).not.toBe("Columns");
      expect(t("station.columns_done")).not.toBe("Done");
      expect(t("station.columns_kept")).not.toBe("Chosen on this device");
      await expect
        .element(page.getByRole("dialog", { name: t("station.columns"), exact: true }))
        .toBeInTheDocument();
      expect(part(el, "[data-columns-done]").textContent!.trim()).toBe(t("station.columns_done"));
      expect(part(el, "[data-columns-kept]").textContent!.trim()).toBe(t("station.columns_kept"));
    } finally {
      setLocale(before);
    }
  });
});
