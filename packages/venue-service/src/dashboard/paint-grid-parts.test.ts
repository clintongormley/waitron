import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import { CopyChooser, columnMenu, hourMarks } from "./paint-grid-parts.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const columns = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
];

class PartsHost extends LitElement {
  copied: { from: string; to: string[] }[] = [];
  readonly follow = vi.fn<(key: string) => void>();
  readonly clear = vi.fn<(key: string) => void>();
  readonly chooser = new CopyChooser(this, {
    columns: () => columns,
    trigger: (key) =>
      this.renderRoot.querySelector<HTMLElement>(`[data-column="${key}"] wt-row-actions`),
    copy: (from, to) => this.copied.push({ from, to }),
  });

  override render() {
    return html`${columns.map(
      ({ key, label }) =>
        html`<div data-column=${key}>
          ${columnMenu(
            label,
            { copy: () => void this.chooser.open(key), clear: () => this.clear(key) },
            [{ label: "Follow the season", select: () => this.follow(key) }],
          )}
        </div>`,
    )}${this.chooser.render()}`;
  }
}
customElements.define("paint-grid-parts-host", PartsHost);

function menu(el: PartsHost, key: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `[data-column="${key}"] wt-row-actions`,
  )!;
}
function action(el: PartsHost, key: string, label: string) {
  return [...menu(el, key).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}

test("a column menu offers Copy to…, Clear and then the host's own items, each calling back", async () => {
  const el = (await mount("<paint-grid-parts-host></paint-grid-parts-host>")) as PartsHost;
  expect(menu(el, "tue").label).toBe("Tuesday options");
  expect(
    [...menu(el, "tue").querySelectorAll("wt-button")].map((b) => b.textContent!.trim()),
  ).toEqual(["Copy to…", "Clear", "Follow the season"]);

  await userEvent.click(menu(el, "tue"));
  await userEvent.click(action(el, "tue", "Follow the season"));
  expect(el.follow).toHaveBeenCalledExactlyOnceWith("tue");
  await userEvent.click(menu(el, "wed"));
  await userEvent.click(action(el, "wed", "Clear"));
  expect(el.clear).toHaveBeenCalledExactlyOnceWith("wed");
  expect(el.follow).toHaveBeenCalledTimes(1);
});

test("the copy chooser reports where it copies from and the ticked columns in column order, and leaves the copying to its host", async () => {
  const el = (await mount("<paint-grid-parts-host></paint-grid-parts-host>")) as PartsHost;
  await userEvent.click(menu(el, "tue"));
  await userEvent.click(action(el, "tue", "Copy to…"));
  await el.updateComplete;
  const chooser = el.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
  expect(chooser.matches(":popover-open")).toBe(true);
  expect(el.chooser.from).toBe("tue");
  const rows = [...chooser.querySelectorAll("label")];
  expect(rows.map((row) => row.textContent!.trim())).toEqual(["Monday", "Wednesday"]);

  await userEvent.click(rows[1]!);
  await userEvent.click(rows[0]!);
  await el.updateComplete;
  const copy = [...chooser.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === "Copy",
  )!;
  await userEvent.click(copy);

  expect(el.copied).toEqual([{ from: "tue", to: ["mon", "wed"] }]);
  expect(chooser.matches(":popover-open")).toBe(false);
  expect(el.chooser.from).toBeUndefined();
});

test("hour marks fall on each clock hour after a changeover that is not on the hour", () => {
  const marks = hourMarks("06:30");
  expect(marks.slice(0, 3)).toEqual([30, 90, 150]);
  expect(marks).toHaveLength(24);
  expect(hourMarks("06:00")[0]).toBe(0);
});
