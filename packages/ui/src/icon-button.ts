import { css } from "lit";

/**
 * An icon-only `.icon-button`, pressed (`aria-pressed`) or open (`aria-expanded`), and the
 * `.icon-tooltip` inside it that shows its name on keyboard focus, and on hover where the primary
 * pointer can hover. The tooltip is `aria-hidden`: the button's `aria-label` is its name. Bind
 * `trackIconTooltip` to the button so Escape can hide the tooltip and a click on the tooltip does
 * not press the button.
 */
export const iconButtonStyles = css`
  .icon-button {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font: inherit;
    cursor: pointer;
  }

  .icon-button:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }

  .icon-button:is([aria-pressed="true"], [aria-expanded="true"]) {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-surface-lifted);
    color: var(--wt-color-primary-text);
  }

  /* Anchored at the button's start so a button at a phone's leading edge keeps it on screen, and
     layered above a sticky table's headings, which it can overlap. */
  .icon-tooltip {
    position: absolute;
    inset-block-start: calc(100% + var(--wt-space-1));
    inset-inline-start: 0;
    z-index: 4;
    display: none;
    padding: var(--wt-space-1) var(--wt-space-2);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-text);
    color: var(--wt-color-bg);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
    text-wrap: nowrap;
  }

  /* The tooltip is inside its button, so the pointer on it keeps the button hovered; this bridges
     the gap between them, so moving onto the tooltip never hides it (WCAG 1.4.13). */
  .icon-tooltip::before {
    content: "";
    position: absolute;
    inset-inline: 0;
    inset-block-end: 100%;
    block-size: var(--wt-space-1);
  }

  .icon-button:focus-visible:not([data-tooltip-hidden]) > .icon-tooltip {
    display: block;
  }

  /* A touch screen leaves a tapped button in :hover, which would leave its tooltip over whatever
     lies beneath it. */
  @media (hover: hover) {
    .icon-button:hover:not([data-tooltip-hidden]) > .icon-tooltip {
      display: block;
    }
  }
`;

/** The tooltip is inside its button but can lie over other controls, so a click on it presses
 * nothing. */
function ignoreTooltipClick(event: Event): void {
  const button = event.currentTarget as HTMLElement;
  if (!button.querySelector(".icon-tooltip")?.contains(event.target as Node)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

const watched = new WeakMap<
  HTMLElement,
  { hovered: boolean; focused: boolean; escape: (event: KeyboardEvent) => void }
>();

/**
 * Bind to an icon button's `pointerenter`, `pointerleave`, `focus` and `blur`. While the pointer is
 * on the button or it has focus, Escape anywhere hides its tooltip without moving either (WCAG
 * 1.4.13); once both have left, the tooltip can show again.
 */
export function trackIconTooltip(event: Event): void {
  const button = event.currentTarget as HTMLElement;
  button.addEventListener("click", ignoreTooltipClick, true);
  let state = watched.get(button);
  if (!state) {
    // A button removed while hovered gets no pointerleave, so the listener lets itself go at the
    // next keydown after its button leaves the page.
    const escape = (key: KeyboardEvent) => {
      if (!button.isConnected) forget(button);
      else if (key.key === "Escape") button.setAttribute("data-tooltip-hidden", "");
    };
    state = { hovered: false, focused: false, escape };
    watched.set(button, state);
    document.addEventListener("keydown", escape, true);
  }
  if (event.type === "pointerenter" || event.type === "pointerleave")
    state.hovered = event.type === "pointerenter";
  else state.focused = event.type === "focus";
  if (state.hovered || state.focused) return;
  forget(button);
  button.removeAttribute("data-tooltip-hidden");
}

function forget(button: HTMLElement): void {
  document.removeEventListener("keydown", watched.get(button)!.escape, true);
  watched.delete(button);
}
