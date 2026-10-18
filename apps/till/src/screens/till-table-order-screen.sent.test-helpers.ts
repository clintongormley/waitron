import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtDialog, WtRowActions } from "@waitron/ui";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { resized } from "./till-table-order-screen.test-helpers.js";

export async function sentPanelFor(screen: TillTableOrderScreen): Promise<TillSentOrders> {
  screen.style.width = "1280px";
  await resized(screen);
  const panel = screen.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  return panel;
}

export async function openSentDish(
  screen: TillTableOrderScreen,
  lineId: string,
  kind: "fired" | "held" | "served" = "fired",
): Promise<WtDialog> {
  const panel = await sentPanelFor(screen);
  for (const selector of [
    "[data-sent-toggle]",
    ...(kind === "fired" ? [] : [`[data-${kind}-toggle]`]),
  ]) {
    const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector)!;
    if (toggle.getAttribute("aria-expanded") === "false") {
      await userEvent.click(toggle);
      await panel.updateComplete;
    }
  }
  const info = panel.shadowRoot!.querySelector<HTMLElement>(
    `[data-${kind}-line="${lineId}"] [data-sent-info]`,
  )!;
  expect(info.checkVisibility(), `Sent information for ${lineId} is visible`).toBe(true);
  await userEvent.click(info);
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector<WtDialog>("[data-sent-line-dialog]")!;
  await dialog.updateComplete;
  return dialog;
}

export async function openSentMore(screen: TillTableOrderScreen): Promise<WtRowActions> {
  const menu = screen.shadowRoot!.querySelector<WtRowActions>(
    "[data-sent-line-dialog] wt-row-actions",
  )!;
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  return menu;
}

export async function chooseSentServing(
  screen: TillTableOrderScreen,
  lineId: string,
  undo = false,
) {
  await openSentDish(screen, lineId, undo ? "served" : "fired");
  if (undo) await openSentMore(screen);
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>(
      `[data-sent-line-${undo ? "unserve" : "serve"}]`,
    )!,
  );
  await screen.updateComplete;
}
