import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { en, es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import type { StaffNotice } from "../api/client.js";
import "./notice-strip.js";
import type { TillNoticeStrip } from "./notice-strip.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

function notice(
  code: string,
  severity: StaffNotice["severity"],
  params: Record<string, unknown> = {},
): StaffNotice {
  return { owner: "core", key: code, code, severity, params };
}

const DISK = notice("storage.disk_full", "error");
const SPACE = notice("storage.space_low", "warning");
const UNSENT = notice("fiscal.records_unsent", "notice", { count: 3, held: 0 });
const CLOCK = notice("clock.unusable", "error");

const root = (el: TillNoticeStrip) => el.shadowRoot!;
const announce = (el: TillNoticeStrip) =>
  root(el).querySelector<HTMLElement>("[data-notice-announce]")!;
const strip = (el: TillNoticeStrip) => root(el).querySelector<HTMLElement>("[data-notice-strip]");
const button = (el: TillNoticeStrip) => root(el).querySelector<HTMLButtonElement>("button");
const list = (el: TillNoticeStrip) => root(el).querySelector<HTMLElement>("[data-notice-list]");
const flat = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function settle(el: TillNoticeStrip): Promise<void> {
  await el.updateComplete;
}

/** The colour a token resolves to inside `host`, read off a probe element. */
function tokenColour(host: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  host.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

describe("till-notice-strip", () => {
  it("draws nothing with no notices, and leaves the status region empty", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", { notices: [] });
    expect(strip(el)).toBeNull();
    expect(button(el)).toBeNull();
    expect(el.getBoundingClientRect().height).toBe(0);
    expect(flat(announce(el))).toBe("");
    expect(announce(el).getAttribute("role")).toBe("status");
  });

  it("draws one red notice as a plain status line with its words and hint", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", { notices: [DISK] });
    expect(button(el)).toBeNull();
    const line = root(el).querySelector<HTMLElement>("[data-notice-tone]")!;
    expect(line.dataset.noticeTone).toBe("error");
    expect(flat(line)).toBe(
      `${en["staff_notice.storage.disk_full"]} · ${en["staff_notice.tell_manager"]}`,
    );
    expect(flat(announce(el))).toBe(en["staff_notice.storage.disk_full"]);
  });

  it("makes several notices one closed button with the first notice's words and +N", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [DISK, SPACE, UNSENT],
    });
    const control = button(el)!;
    expect(root(el).querySelectorAll("button")).toHaveLength(1);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.dataset.noticeTone).toBe("error");
    expect(flat(control)).toContain(en["staff_notice.storage.disk_full"]);
    const more = control.querySelector<HTMLElement>("[data-notice-more]")!;
    const shown = more.querySelector<HTMLElement>("[aria-hidden='true']")!;
    expect(flat(shown)).toBe(en["staff_notice.more"].replace("{n}", "2"));
    expect(flat(more.querySelector(".visually-hidden"))).toBe(
      en["staff_notice.more_label"].replace("{n}", "2"),
    );
    await expect
      .element(page.elementLocator(control))
      .toHaveAccessibleName(
        `${en["staff_notice.storage.disk_full"]} · ${en["staff_notice.tell_manager"]} ${en[
          "staff_notice.more_label"
        ].replace("{n}", "2")}`,
      );
    expect(list(el)).toBeNull();
  });

  it("words one more notice in the singular, in English and Spanish", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [DISK, SPACE],
    });
    const more = () => button(el)!.querySelector("[data-notice-more]")!;
    expect(flat(more().querySelector("[aria-hidden='true']"))).toBe("+1");
    expect(flat(more().querySelector(".visually-hidden"))).toBe(en["staff_notice.more_label_one"]);
    setLocale("es-ES");
    el.requestUpdate();
    await settle(el);
    expect(flat(more().querySelector(".visually-hidden"))).toBe(es["staff_notice.more_label_one"]);
  });

  it("opens the list of every notice in order on a tap, and closes it on a second", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [DISK, SPACE, UNSENT],
    });
    await userEvent.click(button(el)!);
    await settle(el);
    expect(button(el)!.getAttribute("aria-expanded")).toBe("true");
    const items = [...list(el)!.querySelectorAll("li")];
    expect(items.map((item) => (item as HTMLElement).dataset.noticeTone)).toEqual([
      "error",
      "warning",
      "notice",
    ]);
    expect(items.map(flat)).toEqual([
      `${en["staff_notice.storage.disk_full"]} · ${en["staff_notice.tell_manager"]}`,
      `${en["staff_notice.storage.space_low"]} · ${en["staff_notice.tell_manager"]}`,
      `${en["staff_notice.fiscal.records_unsent"].replace("{n}", "3")} · ${en["staff_notice.retried"]}`,
    ]);
    expect(list(el)!.getAttribute("aria-label")).toBe(en["staff_notice.list"]);
    expect(button(el)!.getAttribute("aria-controls")).toBe(list(el)!.id);
    await userEvent.click(button(el)!);
    await settle(el);
    expect(button(el)!.getAttribute("aria-expanded")).toBe("false");
    expect(list(el)).toBeNull();
  });

  it("lets the open list take keyboard focus and draws the focus ring inside its edges", async () => {
    const { el, host } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [DISK, SPACE, UNSENT],
    });
    host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
    host.style.setProperty("--wt-focus-offset", "2px");
    await userEvent.click(button(el)!);
    await settle(el);
    await userEvent.keyboard("{Tab}");
    expect(root(el).activeElement).toBe(list(el));
    expect(list(el)!.matches(":focus-visible")).toBe(true);
    const ring = getComputedStyle(list(el)!);
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineColor).toBe("rgb(4, 5, 6)");
    expect(ring.outlineWidth).toBe("3px");
    expect(ring.outlineOffset).toBe("-2px");
  });

  it("closes the open list when only one notice is left", async () => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [DISK, SPACE, UNSENT],
    });
    await userEvent.click(button(el)!);
    await settle(el);
    expect(list(el)).not.toBeNull();
    el.notices = [DISK];
    await settle(el);
    expect(list(el)).toBeNull();
    expect(button(el)).toBeNull();
    const line = root(el).querySelector<HTMLElement>("[data-notice-tone]")!;
    expect(line.dataset.noticeTone).toBe("error");
    expect(flat(line)).toBe(
      `${en["staff_notice.storage.disk_full"]} · ${en["staff_notice.tell_manager"]}`,
    );
    el.notices = [DISK, SPACE];
    await settle(el);
    expect(button(el)!.getAttribute("aria-expanded")).toBe("false");
    expect(list(el)).toBeNull();
  });

  it.each([
    ["error", "--wt-color-danger"],
    ["warning", "--wt-color-warning"],
    ["notice", "--wt-color-primary"],
  ] as const)("paints a %s line's edge and icon in %s", async (severity, token) => {
    const { el, host } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [notice("storage.space_low", severity)],
    });
    const line = root(el).querySelector<HTMLElement>("[data-notice-tone]")!;
    const expected = tokenColour(host, token);
    expect(getComputedStyle(line).borderInlineStartColor).toBe(expected);
    expect(getComputedStyle(line.querySelector("wt-icon")!).color).toBe(expected);
    expect(line.querySelector("wt-icon")!.shadowRoot!.querySelector("path")).not.toBeNull();
    expect(getComputedStyle(line).color).toBe(tokenColour(host, "--wt-color-text"));
  });

  it("draws a severity it does not know in the notice tone", async () => {
    const { el, host } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: [{ ...DISK, severity: "critical" as StaffNotice["severity"] }],
    });
    const line = root(el).querySelector<HTMLElement>("[data-notice-tone]")!;
    expect(line.dataset.noticeTone).toBe("notice");
    expect(getComputedStyle(line).borderInlineStartColor).toBe(
      tokenColour(host, "--wt-color-primary"),
    );
  });

  it.each([
    ["one notice", [SPACE], [DISK]],
    ["three notices", [SPACE, UNSENT, CLOCK], [DISK, SPACE, UNSENT]],
  ])("announces a new most serious notice with %s", async (_form, before, after) => {
    const { el } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
      notices: before,
    });
    expect(flat(announce(el))).toBe(en["staff_notice.storage.space_low"]);
    el.notices = after;
    await settle(el);
    expect(flat(announce(el))).toBe(en["staff_notice.storage.disk_full"]);
  });

  it("wraps a Spanish red notice inside the strip on a phone", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setLocale("es-ES");
    try {
      await page.viewport(1280, 844);
      const { el, host } = await mountWidget<TillNoticeStrip>("till-notice-strip", {
        notices: [CLOCK],
      });
      const line = root(el).querySelector<HTMLElement>("[data-notice-tone]")!;
      expect(flat(line)).toBe(
        `${es["staff_notice.clock.unusable"]} · ${es["staff_notice.tell_manager"]}`,
      );
      const wide = line.getBoundingClientRect().height;
      await page.viewport(390, 844);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(line.getBoundingClientRect().height).toBeGreaterThan(wide);
      expect(el.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(
        host.getBoundingClientRect().right,
      );
    } finally {
      await page.viewport(width, height);
    }
  });
});
