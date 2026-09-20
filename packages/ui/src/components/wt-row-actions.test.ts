import { html, nothing } from "lit";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "./wt-button.js";
import "./wt-button.js";
import { WtDataTable } from "./wt-data-table.js";
import { cleanup, host, mount } from "../test-helpers.js";
import { expectNoA11yViolations } from "../a11y-helpers.js";
import { WtRowActions } from "./wt-row-actions.js";

async function mountWidget<T extends HTMLElement>(tag: string, props: Partial<T>) {
  const el = (await mount(`<${tag}></${tag}>`)) as T & { updateComplete: Promise<unknown> };
  Object.assign(el, props);
  await el.updateComplete;
  return { el, host };
}

afterEach(cleanup);

async function mountActions() {
  const mounted = await mountWidget<WtRowActions>("wt-row-actions", {
    label: "Actions for Receipt printer",
  });
  const edit = document.createElement("wt-button");
  edit.textContent = "Edit";
  const remove = document.createElement("wt-button");
  remove.textContent = "Delete";
  mounted.el.append(edit, remove);
  await Promise.all([edit.updateComplete, remove.updateComplete]);
  const trigger = mounted.el.shadowRoot!.querySelector("button")!;
  const popup = mounted.el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  return { ...mounted, edit, remove, trigger, popup };
}

describe("row actions", () => {
  it("shows the kebab icon on its trigger, not the hamburger — this is a per-row menu, not navigation", async () => {
    const el = await mount('<wt-row-actions label="Department actions"></wt-row-actions>');
    const icon = el.shadowRoot!.querySelector("button wt-icon")!;
    expect(icon.getAttribute("name")).toBe("kebab");
  });
  it("shows a caller-supplied icon instead of the kebab, for a non-row menu (e.g. account menu) reusing this same disclosure", async () => {
    const { el } = await mountWidget<WtRowActions>("wt-row-actions", {
      label: "Account menu",
      icon: "person",
    });
    const icon = el.shadowRoot!.querySelector("button wt-icon")!;
    expect(icon.getAttribute("name")).toBe("person");
  });
  it("defaults the trigger icon to md, but takes a caller-supplied size (e.g. a larger account-menu trigger)", async () => {
    const { el } = await mountWidget<WtRowActions>("wt-row-actions", {
      label: "Department actions",
    });
    expect(el.shadowRoot!.querySelector("button wt-icon")!.getAttribute("size")).toBe("md");

    const { el: bigger } = await mountWidget<WtRowActions>("wt-row-actions", {
      label: "Account menu",
      iconSize: "lg",
    });
    expect(bigger.shadowRoot!.querySelector("button wt-icon")!.getAttribute("size")).toBe("lg");
  });
  it("registers the reusable action disclosure", async () => {
    const el = await mount('<wt-row-actions label="Department actions"></wt-row-actions>');
    expect(el.shadowRoot?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Department actions",
    );
  });
  async function openInTable(
    align: "start" | "end" | undefined,
  ): Promise<{ bounds: DOMRect; anchor: DOMRect }> {
    const { el: table } = await mountWidget<WtDataTable>("wt-data-table", {
      ariaLabel: "Print agents",
      rows: [{}],
      columns: [
        { key: "name", label: "Name", cell: () => "Kitchen agent" },
        {
          key: "actions",
          label: "Actions",
          align: "end",
          cell: () =>
            html`<wt-row-actions label="Agent actions" align=${align ?? nothing}
              ><wt-button>Edit</wt-button><wt-button>Delete</wt-button></wt-row-actions
            >`,
        },
      ],
    });
    // A narrow table leaves room on both sides so alignment is observed, not clamped to the viewport.
    table.style.width = "320px";
    table.style.marginTop = "150px";
    const actions = table.shadowRoot!.querySelector<WtRowActions>("wt-row-actions")!;
    await actions.updateComplete;
    const trigger = actions.shadowRoot!.querySelector("button")!;
    const popup = actions.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    const firstFrame = new Promise<DOMRect>((resolve) => {
      trigger.addEventListener(
        "click",
        () => requestAnimationFrame(() => resolve(popup.getBoundingClientRect())),
        { once: true },
      );
    });
    await userEvent.click(trigger);
    return { bounds: await firstFrame, anchor: trigger.getBoundingClientRect() };
  }

  it("aligns the popup's left edge under the trigger before the first painted frame", async () => {
    const { bounds, anchor } = await openInTable(undefined);
    expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
    expect(bounds.left).toBeCloseTo(anchor.left, 0);
  });

  it("aligns the popup's right edge under the trigger when align is end (e.g. the account menu)", async () => {
    const { bounds, anchor } = await openInTable("end");
    expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
    expect(bounds.right).toBeCloseTo(anchor.right, 0);
  });

  it("starts plain popup text at the start edge even when align is end", async () => {
    const el = await mount(
      '<wt-row-actions label="Alerts" align="end"><p>Payment check failed</p></wt-row-actions>',
    );
    (el as WtRowActions).show();
    const text = el.querySelector("p")!;
    expect(getComputedStyle(text).textAlign).toBe("start");
  });

  it("allows an action to keep the popup open while it asks for confirmation", async () => {
    const { trigger, remove, popup } = await mountActions();
    remove.setAttribute("data-keep-open", "");
    await userEvent.click(trigger);
    await userEvent.click(remove);
    expect(popup.matches(":popover-open")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(popup.matches(":popover-open")).toBe(false);
  });

  it("names the hamburger and reflects both open and closed states without menu semantics", async () => {
    const { el, host, trigger, popup } = await mountActions();
    expect(trigger.getAttribute("aria-label")).toBe("Actions for Receipt printer");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
    expect(popup.matches(":popover-open")).toBe(true);
    expect(el.shadowRoot!.querySelector('[role="menu"]')).toBeNull();
    await expectNoA11yViolations(host);
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("supports Tab then Enter to activate an action and close the disclosure", async () => {
    const { edit, trigger, popup } = await mountActions();
    const action = vi.fn();
    edit.addEventListener("click", action);
    trigger.focus();
    await userEvent.keyboard("{Enter}{Tab}");
    expect(edit.shadowRoot!.activeElement).toBe(edit.shadowRoot!.querySelector("button"));
    await userEvent.keyboard("{Enter}");
    expect(action).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const { el, trigger, popup } = await mountActions();
    trigger.focus();
    await userEvent.keyboard("{Enter}{Tab}{Escape}");
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
    expect(el.shadowRoot!.activeElement).toBe(trigger);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("dismisses on an outside click without taking focus from that destination", async () => {
    const { host, trigger, popup } = await mountActions();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    host.append(outside);
    await userEvent.click(trigger);
    await userEvent.click(outside);
    expect(popup.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(outside);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("keeps the disclosure open when non-action content is clicked", async () => {
    const { el, trigger, popup } = await mountActions();
    const explanation = document.createElement("span");
    explanation.textContent = "Choose an action";
    el.append(explanation);
    await userEvent.click(trigger);
    await userEvent.click(explanation);
    expect(popup.matches(":popover-open")).toBe(true);
  });

  it("leaves keyboard focus in a modal opened by an action", async () => {
    const { edit, host, trigger, popup } = await mountActions();
    const dialog = document.createElement("dialog");
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Printer name");
    dialog.append(input);
    host.append(dialog);
    edit.addEventListener("click", () => dialog.showModal());
    await userEvent.click(trigger);
    await userEvent.click(edit);
    expect(dialog.open).toBe(true);
    expect(popup.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(input);
    dialog.close();
  });

  it("lets the last action receive a real pointer click beyond a horizontally scrolling table", async () => {
    const action = vi.fn();
    const { el: table, host } = await mountWidget<WtDataTable>("wt-data-table", {
      ariaLabel: "Printers",
      rows: [{}],
      columns: [
        {
          key: "name",
          label: "Name",
          cell: () => html`<span style="display: block; width: 600px">Receipt printer</span>`,
        },
        {
          key: "actions",
          label: "Actions",
          cell: () =>
            html`<wt-row-actions label="Actions for Receipt printer">
              <wt-button>Edit</wt-button><wt-button>Print test</wt-button
              ><wt-button @click=${action}>Delete</wt-button>
            </wt-row-actions>`,
        },
      ],
    });
    host.style.width = "320px";
    const scroller = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    const actions = table.shadowRoot!.querySelector<WtRowActions>("wt-row-actions")!;
    await actions.updateComplete;
    scroller.scrollLeft = scroller.scrollWidth;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    await userEvent.click(actions.shadowRoot!.querySelector("button")!);
    const popup = actions.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await vi.waitFor(() => expect(popup.style.top).not.toBe(""));
    const remove = actions.querySelectorAll<WtButton>("wt-button")[2];
    await remove.updateComplete;
    expect(remove.getBoundingClientRect().top).toBeGreaterThan(
      scroller.getBoundingClientRect().bottom,
    );
    await userEvent.click(remove);
    expect(action).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  });
});

it("delegates host focus and paints the keyboard focus ring from tokens", async () => {
  const { el, host, trigger } = await mountActions();
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(1, 2, 3)");
  host.style.setProperty("--wt-focus-offset", "5px");
  await userEvent.keyboard("{Tab}");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(trigger);
  expect(getComputedStyle(trigger).outlineColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(trigger).outlineWidth).toBe("3px");
  expect(getComputedStyle(trigger).outlineOffset).toBe("5px");
});

it("meets the tap target and uses the theme tokens", async () => {
  const { host, trigger, popup } = await mountActions();
  host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-tap-min", "52px");
  expect(trigger.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(trigger).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(popup).backgroundColor).toBe("rgb(4, 5, 6)");
});

it("does not close for disabled actions or already handled Escape", async () => {
  const { el, trigger, popup } = await mountActions();
  const action = document.createElement("a");
  action.href = "#";
  action.textContent = "Unavailable action";
  action.setAttribute("aria-disabled", "true");
  el.append(action);
  await userEvent.click(trigger);
  action.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(popup.matches(":popover-open")).toBe(true);
  action.removeAttribute("aria-disabled");
  action.setAttribute("disabled", "");
  action.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  expect(popup.matches(":popover-open")).toBe(true);
  const handled = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  handled.preventDefault();
  action.dispatchEvent(handled);
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(trigger);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(popup.matches(":popover-open")).toBe(false);
});

test("puts a badge-slotted element inside the trigger button", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts"><span slot="badge">3</span><wt-button>See all</wt-button></wt-row-actions>',
  )) as WtRowActions;
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>("button slot[name=badge]")!;
  expect(slot.assignedElements().map((e) => e.textContent)).toEqual(["3"]);
});

test("show() opens the popup under its trigger and hide() closes it", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts" align="end"><wt-button>See all</wt-button></wt-row-actions>',
  )) as WtRowActions;
  // Room on both sides, so the trailing-edge alignment is observed rather than clamped.
  el.style.marginInlineStart = "300px";
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  el.show();
  expect(popup.matches(":popover-open")).toBe(true);
  // Only a popup measured while open has a width to subtract from the trigger's right edge.
  const anchor = el.shadowRoot!.querySelector("button")!.getBoundingClientRect();
  const bounds = popup.getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
  expect(bounds.right).toBeCloseTo(anchor.right, 0);
  el.hide();
  expect(popup.matches(":popover-open")).toBe(false);
});

test("show() and hide() do nothing before the first render", () => {
  const el = document.createElement("wt-row-actions");
  expect(() => el.show()).not.toThrow();
  expect(() => el.hide()).not.toThrow();
});

test("show() does nothing once the menu has been removed from the page", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts"><wt-button>See all</wt-button></wt-row-actions>',
  )) as WtRowActions;
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  el.remove();
  expect(() => el.show()).not.toThrow();
  expect(popup.matches(":popover-open")).toBe(false);
  expect(() => el.hide()).not.toThrow();
});

test("a consumer can size the popup through its part", async () => {
  const style = document.createElement("style");
  style.textContent = "wt-row-actions.wide::part(popup) { width: 300px; }";
  document.head.append(style);
  try {
    const el = (await mount(
      '<wt-row-actions class="wide" label="Alerts"><wt-button>See all</wt-button></wt-row-actions>',
    )) as WtRowActions;
    el.show();
    expect(
      el.shadowRoot!.querySelector<HTMLElement>("[popover]")!.getBoundingClientRect().width,
    ).toBe(300);
  } finally {
    style.remove();
  }
});

test("pins the badge to the trigger's top trailing corner", async () => {
  const el = (await mount(
    '<wt-row-actions label="Alerts"><span slot="badge">3</span></wt-row-actions>',
  )) as WtRowActions;
  const trigger = el.shadowRoot!.querySelector("button")!.getBoundingClientRect();
  const badge = el.querySelector("span")!.getBoundingClientRect();
  expect(badge.top).toBeCloseTo(trigger.top, 0);
  expect(badge.right).toBeCloseTo(trigger.right, 0);
});

test("a menu given no label ships an unnamed button, and opens from its leading edge", async () => {
  // Not a virtue: `label` has no wording of its own to fall back on, so an unlabelled menu renders
  // `aria-label=""` and its button has no accessible name at all. The nearest control is
  // wt-row-actions.a11y.test.ts's "detects a missing accessible name on the hamburger", which
  // REMOVES the attribute rather than leaving it empty — a different DOM state with the same axe
  // outcome. Nothing scans an unlabelled menu with axe today. What this pins is only that the
  // empty default is what reaches the attribute, rather than some invented English.
  const el = (await mount("<wt-row-actions></wt-row-actions>")) as WtRowActions;
  expect(el.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe("");
  expect(el.align).toBe("start");
});

test("show() on a menu just added to the page, before it has rendered, opens nothing", async () => {
  const el = document.createElement("wt-row-actions");
  document.body.append(el);
  try {
    // Connected, so the shadow root exists, but the first render has not run and there is no
    // popup element to open yet.
    expect(() => el.show()).not.toThrow();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open")).toBe(
      false,
    );
  } finally {
    el.remove();
  }
});

async function openMenuAt(position: Record<string, string>) {
  const { el, trigger, popup } = await mountActions();
  for (const [name, value] of Object.entries(position)) el.style.setProperty(name, value);
  el.show();
  return { popup: popup.getBoundingClientRect(), trigger: trigger.getBoundingClientRect() };
}

test("a menu at the right edge of the screen holds its popup exactly 8px inside that edge", async () => {
  const edge = await openMenuAt({
    position: "fixed",
    "inset-inline-end": "0",
    "inset-block-start": "0",
  });
  expect(edge.popup.right).toBeCloseTo(innerWidth - 8, 0);

  // A menu with room on every side: a popup that merely wrapped narrower at the edge could satisfy
  // the margin above without having been moved at all.
  const roomy = await openMenuAt({
    position: "fixed",
    "inset-inline-start": "40%",
    "inset-block-start": "40%",
  });
  expect(edge.popup.width).toBeCloseTo(roomy.popup.width, 0);
});

test("a menu at the bottom of the screen lifts its popup to exactly 8px above that edge", async () => {
  const edge = await openMenuAt({
    position: "fixed",
    "inset-inline-start": "40%",
    "inset-block-end": "0",
  });
  expect(edge.popup.bottom).toBeCloseTo(innerHeight - 8, 0);
  expect(edge.popup.top).toBeLessThan(edge.trigger.bottom);
});

test("Escape that closes the menu goes no further, so a dialog around it stays open", async () => {
  const { el, host, popup } = await mountActions();
  el.show();
  const outside = vi.fn();
  host.addEventListener("keydown", outside);
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  popup.dispatchEvent(escape);
  expect(popup.matches(":popover-open")).toBe(false);
  expect(escape.defaultPrevented).toBe(true);
  expect(outside).not.toHaveBeenCalled();
});
