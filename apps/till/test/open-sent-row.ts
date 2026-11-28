import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";

export type SentRowKind = "fired" | "held" | "served";
export type SentServeKind = "one" | "rest" | "whole";

/** A sent row's own button (`data-sent-row`), the row picked by `kind` when given; a served row
 * may still be drawn as fired while it waits for its last portion. */
export function sentRowButton(
  panel: LitElement,
  lineId: string,
  kind?: SentRowKind,
): HTMLButtonElement {
  const kinds = kind === undefined ? [undefined] : kind === "served" ? ["served", "fired"] : [kind];
  const button = kinds
    .map((each) =>
      panel.shadowRoot!.querySelector<HTMLButtonElement>(
        `${each === undefined ? "" : `[data-${each}-line="${lineId}"] `}[data-sent-row="${lineId}"]`,
      ),
    )
    .find((found) => found !== null);
  expect(button, `the sent row for ${lineId} is drawn`).toBeTruthy();
  return button!;
}

/** Opens `lineId`'s sent row in place unless it is already open, and returns its list item. */
export async function openSentRow(
  panel: LitElement,
  lineId: string,
  kind?: SentRowKind,
): Promise<HTMLLIElement> {
  const button = sentRowButton(panel, lineId, kind);
  expect(button.checkVisibility(), `the sent row for ${lineId} is visible`).toBe(true);
  if (button.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(button);
    await panel.updateComplete;
  }
  expect(button.getAttribute("aria-expanded"), `the sent row for ${lineId} opened`).toBe("true");
  return button.closest("li")!;
}

/** The open row's Dish details button, after opening `lineId`'s row. */
export async function sentDetailsButton(
  panel: LitElement,
  lineId: string,
  kind?: SentRowKind,
): Promise<HTMLButtonElement> {
  const row = await openSentRow(panel, lineId, kind);
  const details = row.querySelector<HTMLButtonElement>("[data-sent-details]");
  expect(details, `Dish details for ${lineId} is offered`).not.toBeNull();
  expect(details!.checkVisibility(), `Dish details for ${lineId} is visible`).toBe(true);
  return details!;
}

/** Opens `lineId`'s row and presses Dish details, which opens the dish window. */
export async function openSentDetails(
  panel: LitElement,
  lineId: string,
  kind?: SentRowKind,
): Promise<void> {
  await userEvent.click(await sentDetailsButton(panel, lineId, kind));
  await panel.updateComplete;
}

/** The open row's Serve button of `serve`'s kind, after opening `lineId`'s row. */
export async function sentServeButton(
  panel: LitElement,
  lineId: string,
  serve: SentServeKind,
  kind?: SentRowKind,
): Promise<HTMLButtonElement> {
  const row = await openSentRow(panel, lineId, kind);
  const button = row.querySelector<HTMLButtonElement>(`[data-sent-serve="${serve}"]`);
  expect(button, `the open row for ${lineId} offers its "${serve}" Serve`).not.toBeNull();
  return button!;
}

/** Opens `lineId`'s row and presses its Serve of `serve`'s kind. */
export async function serveSentRow(
  panel: LitElement,
  lineId: string,
  serve: SentServeKind,
  kind?: SentRowKind,
): Promise<void> {
  await userEvent.click(await sentServeButton(panel, lineId, serve, kind));
  await panel.updateComplete;
}
