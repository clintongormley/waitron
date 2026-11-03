import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import {
  PASS_COLUMNS,
  STATION_COLUMNS,
  type ColumnKey,
  type ColumnState,
} from "../state/kitchen-columns.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage, textRects } from "./test-helpers.js";
import { passColumnNames } from "./pass-board.js";
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
      layout: layout({ order: ["ready", "held", "toFire", "waitingOnly", "waiting", "preparing"] }),
    });
    expect(rows(el)).toEqual([
      ["1", t("station.state.ready")],
      ["2", t("pass.column.held")],
      ["3", t("station.state.queued")],
      ["4", t("station.columns_waiting_held")],
      ["5", t("station.state.preparing")],
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
      t("station.columns_waiting_held"),
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

describe("A773 held column", () => {
  const stationDefaults = (): ColumnState => ({
    order: [...STATION_COLUMNS.order],
    hidden: [...STATION_COLUMNS.hidden],
    collapsed: [...STATION_COLUMNS.collapsed],
  });

  it("offers the station's six columns, Waiting + Held shown and the separate Waiting and Held not", async () => {
    const { el } = await mount({ layout: stationDefaults() });
    expect(rows(el)).toEqual([
      ["1", t("station.overview")],
      ["2", t("station.columns_waiting_held")],
      ["3", t("station.state.queued")],
      ["4", t("pass.column.held")],
      ["5", t("station.state.preparing")],
      ["6", t("station.state.ready")],
    ]);
    const shown = STATION_COLUMNS.order.map(
      (key) => part(el, `[data-column-show="${key}"]`).checked,
    );
    expect(shown).toEqual([true, true, false, false, true, true]);
    const shows = heard<{ key: ColumnKey; visible: boolean }>(el, "column-show");
    await userEvent.click(part(el, '[data-column-show="held"]'));
    expect(shows).toEqual([{ key: "held", visible: true }]);
  });

  it.each(["en-GB", "es-ES"])(
    "at 390 px each of the six names is drawn whole on one line, its row inside the window (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        await pageAt(390, 844);
        const { el } = await mount({ layout: stationDefaults() });
        const drawnRows = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-column-row]");
        expect(drawnRows).toHaveLength(6);
        for (const row of drawnRows) {
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
});

describe("D95 the pass's columns", () => {
  const passDefaults = (): ColumnState => ({
    order: [...PASS_COLUMNS.order],
    hidden: [...PASS_COLUMNS.hidden],
    collapsed: [...PASS_COLUMNS.collapsed],
  });

  it("offers the pass's six columns, Held + To fire shown and the separate Held and To fire not", async () => {
    const { el } = await mount({ layout: passDefaults(), names: passColumnNames() });
    expect(rows(el)).toEqual([
      ["1", t("station.overview")],
      ["2", t("pass.columns_held_to_fire")],
      ["3", t("pass.column.held")],
      ["4", t("pass.column.to_fire")],
      ["5", t("pass.column.in_progress")],
      ["6", t("pass.column.ready")],
    ]);
    const shown = PASS_COLUMNS.order.map((key) => part(el, `[data-column-show="${key}"]`).checked);
    expect(shown).toEqual([false, true, false, false, true, true]);
    const shows = heard<{ key: ColumnKey; visible: boolean }>(el, "column-show");
    await userEvent.click(part(el, '[data-column-show="held"]'));
    expect(shows).toEqual([{ key: "held", visible: true }]);
  });

  it.each(["en-GB", "es-ES"])(
    "at 390 px each of the pass's six names is drawn whole on one line, its row inside the window (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        await page.viewport(390, 844);
        const { el } = await mount({ layout: passDefaults(), names: passColumnNames() });
        const drawnRows = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-column-row]");
        expect(drawnRows).toHaveLength(6);
        for (const row of drawnRows) {
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
});

describe("A773 the pass's other-stations choice", () => {
  const control = (el: TillKitchenColumnsDialog) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
      "wt-segmented-control[data-other-stations]",
    );
  const radios = (el: TillKitchenColumnsDialog) => [
    ...control(el)!.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  const checked = (el: TillKitchenColumnsDialog) =>
    radios(el).map((radio) => radio.getAttribute("aria-checked"));
  const passLayout = () => layout({ order: ["toFire", "inProgress", "ready"] });

  it("draws no section unless it is handed the device's choice", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("[data-other-stations]")).toBeNull();
  });

  it.each([
    [null, ["true", "false", "false"]],
    [true, ["false", "true", "false"]],
    [false, ["false", "false", "true"]],
  ] as const)("names the three choices, with %s chosen", async (value, expected) => {
    const { el } = await mount({ layout: passLayout(), otherStations: { value, sending: false } });
    await control(el)!.updateComplete;
    expect(
      control(el)!.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-label"),
    ).toBe("Other stations' dishes");
    expect(radios(el).map((radio) => radio.textContent!.trim())).toEqual([
      "Use the profile's setting",
      "Show",
      "Hide",
    ]);
    expect(checked(el)).toEqual(expected);
  });

  it("a choice asks once for its value, and its change stops at the window", async () => {
    const { el } = await mount({
      layout: passLayout(),
      otherStations: { value: null, sending: false },
    });
    await control(el)!.updateComplete;
    const asks = heard<{ value: boolean | null }>(el, "other-stations-choose");
    const changes = vi.fn();
    document.addEventListener("wt-change", changes);
    try {
      await userEvent.click(radios(el)[2]!);
      await userEvent.click(radios(el)[0]!);
      await userEvent.click(radios(el)[1]!);
    } finally {
      document.removeEventListener("wt-change", changes);
    }
    expect(asks).toEqual([{ value: false }, { value: null }, { value: true }]);
    expect(changes).not.toHaveBeenCalled();
  });

  it("disables the choices while one is out", async () => {
    const { el } = await mount({
      layout: passLayout(),
      otherStations: { value: true, sending: true },
    });
    await control(el)!.updateComplete;
    expect(control(el)!.disabled).toBe(true);
    expect(radios(el).every((radio) => radio.disabled)).toBe(true);
  });

  it("shows a refusal's words as the window's one message, leaving the choice unmarked", async () => {
    const { el } = await mount({
      layout: passLayout(),
      otherStations: { value: true, sending: false, errorCode: "storage.disk_full" },
    });
    await control(el)!.updateComplete;
    const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await el.shadowRoot!.querySelector("wt-form-actions")!.updateComplete;
    await dialog.updateComplete;
    const message = dialog.shadowRoot!.querySelector(".footer [data-error]");
    expect(message?.textContent!.trim()).toBe(codeMessage("storage.disk_full"));
    expect(message?.getAttribute("role")).toBe("alert");
    expect(control(el)!.shadowRoot!.querySelector("[data-error]")).toBeNull();
    expect(
      control(el)!.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it.each(["en-GB", "es-ES"])(
    "at 390 px each choice's words are drawn whole, the choices inside the window (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        await pageAt(390, 844);
        const { el } = await mount({
          layout: passLayout(),
          otherStations: { value: null, sending: false },
        });
        await control(el)!.updateComplete;
        expect(radios(el)).toHaveLength(3);
        for (const radio of radios(el)) {
          const walker = document.createTreeWalker(radio, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const word of node.textContent!.matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(node, word.index);
              range.setEnd(node, word.index + word[0].length);
              expect(range.getClientRects(), word[0]).toHaveLength(1);
            }
          }
        }
        const group = control(el)!.shadowRoot!.querySelector<HTMLElement>('[role="radiogroup"]')!;
        expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
        expect(group.getBoundingClientRect().right).toBeLessThanOrEqual(
          control(el)!.getBoundingClientRect().right,
        );
      } finally {
        setLocale(before);
        await resetPage();
      }
    },
  );

  it("at 320 px in Spanish at 130% the choices stay inside the window", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      await pageAt(320, 700, 130);
      const { el } = await mount({
        layout: passLayout(),
        otherStations: { value: null, sending: false },
      });
      await control(el)!.updateComplete;
      expect(radios(el).map((radio) => radio.textContent!.trim())).toEqual([
        t("pass.use_profile"),
        "Mostrar",
        "Ocultar",
      ]);
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
      const body = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
      const group = control(el)!.shadowRoot!.querySelector<HTMLElement>('[role="radiogroup"]')!;
      await expect.poll(() => group.scrollWidth <= group.clientWidth).toBe(true);
      expect(body.scrollWidth, "the window scrolls sideways").toBeLessThanOrEqual(body.clientWidth);
      const edge =
        body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight);
      for (const radio of radios(el)) {
        expect(radio.getBoundingClientRect().right, radio.textContent!.trim()).toBeLessThanOrEqual(
          edge + 0.5,
        );
      }
    } finally {
      setLocale(before);
      await resetPage();
    }
  });

  it("reads the section in Spanish", async () => {
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const { el } = await mount({
        layout: passLayout(),
        otherStations: { value: null, sending: false },
      });
      await control(el)!.updateComplete;
      expect(
        control(el)!.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-label"),
      ).toBe("Platos de otras estaciones");
      expect(radios(el).map((radio) => radio.textContent!.trim())).toEqual([
        "Usar la configuración del perfil",
        "Mostrar",
        "Ocultar",
      ]);
    } finally {
      setLocale(before);
    }
  });
});
