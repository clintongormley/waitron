import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import type { WtButton } from "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-button.js";
import { WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { RowActions } from "./row-actions.js";

afterEach(cleanupWidgets);

async function mountActions() {
  const mounted = await mountWidget<RowActions>("dashboard-row-actions", {
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
  it("positions the popup beside the trigger before the first painted frame", async () => {
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
            html`<dashboard-row-actions label="Agent actions"
              ><wt-button>Edit</wt-button><wt-button>Delete</wt-button></dashboard-row-actions
            >`,
        },
      ],
    });
    table.style.marginTop = "150px";
    const actions = table.shadowRoot!.querySelector<RowActions>("dashboard-row-actions")!;
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
    const bounds = await firstFrame;
    const anchor = trigger.getBoundingClientRect();
    expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
    expect(bounds.right).toBeCloseTo(anchor.right, 0);
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
            html`<dashboard-row-actions label="Actions for Receipt printer">
              <wt-button>Edit</wt-button><wt-button>Print test</wt-button
              ><wt-button @click=${action}>Delete</wt-button>
            </dashboard-row-actions>`,
        },
      ],
    });
    host.style.width = "320px";
    const scroller = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    const actions = table.shadowRoot!.querySelector<RowActions>("dashboard-row-actions")!;
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
