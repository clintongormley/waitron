import type { WtStepper } from "@waitron/ui";
import "@waitron/ui/src/components/wt-stepper.js";
import {
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
  css,
  html,
  nothing,
} from "lit";
import { fill, t } from "../i18n/t.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";
import type { TillBasket } from "./basket.js";
import { dishFacts } from "./dish-facts.js";
import { type DraftRowTap, draftRowSlotStyles } from "./draft-row.js";
import { lineProductName, soldByTheUnit } from "./product-name.js";

/**
 * Which new dish's row is open in place, one at a time. A tap on a row opens it and a second tap
 * closes it. The row closes for good once its dish leaves the order, the order is swapped or read
 * again, or it is sending, locked or has an order in flight, or the screen closes it, as holding a
 * row does.
 */
export class OpenDraftRow implements ReactiveController {
  #opened?: { store: WorkingOrderStore; line: OrderLine; generation: number };
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #inFlight: () => boolean;
  readonly #current: () => WorkingOrderStore | null;
  readonly #scroller: () => Element;

  /** `current` is the order the screen shows now, which a control drawn earlier may no longer be;
   * `scroller` is the area the order scrolls in. */
  constructor(
    host: ReactiveControllerHost & HTMLElement,
    inFlight: () => boolean,
    current: () => WorkingOrderStore | null,
    scroller: () => Element,
  ) {
    this.#host = host;
    this.#inFlight = inFlight;
    this.#current = current;
    this.#scroller = scroller;
    host.addController(this);
  }

  hostConnected(): void {
    this.#host.addEventListener("draft-row-tap", this.#tap);
  }

  hostDisconnected(): void {
    this.#host.removeEventListener("draft-row-tap", this.#tap);
  }

  readonly #tap = (event: Event): void => {
    const { store, line } = (event as CustomEvent<DraftRowTap>).detail;
    this.#opened =
      this.line(store) === line || this.#blocked(store)
        ? undefined
        : { store, line, generation: store.loadGeneration };
    this.#host.requestUpdate();
    // The basket sends the tap from itself.
    if (this.#opened !== undefined)
      void this.#reveal(event.composedPath()[0] as TillBasket, store, line);
  };

  /** Brings the opened box's foot above the bar at the scroll area's foot, which the row's
   * `scroll-margin-block-end` measures. Where the box is taller than the area, its foot wins. */
  async #reveal(basket: TillBasket, store: WorkingOrderStore, line: OrderLine): Promise<void> {
    await this.#host.updateComplete;
    await basket.updateComplete;
    await basket.querySelector<WtStepper>("wt-stepper")?.updateComplete;
    if (this.line(store) !== line) return;
    const box = basket.renderRoot
      .querySelector(`[data-draft-row="${store.lines.indexOf(line)}"]`)
      ?.closest<HTMLElement>(".entry");
    if (box == null) return;
    const scroller = this.#scroller();
    const foot =
      scroller === document.scrollingElement
        ? innerHeight
        : scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight;
    const margin = Number.parseFloat(getComputedStyle(box).scrollMarginBlockEnd);
    if (box.getBoundingClientRect().bottom > foot - margin)
      box.scrollIntoView({
        block: "end",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
  }

  close(): void {
    this.#opened = undefined;
    this.#host.requestUpdate();
  }

  #blocked(store: WorkingOrderStore): boolean {
    return store.sending || store.editsLocked || this.#inFlight();
  }

  /** The dish whose row is open in `store`'s order, if it still may be. */
  line(store: WorkingOrderStore | null): OrderLine | undefined {
    const opened = this.#opened;
    if (opened === undefined) return undefined;
    if (
      store !== opened.store ||
      store.loadGeneration !== opened.generation ||
      !store.lines.includes(opened.line) ||
      this.#blocked(store)
    ) {
      this.#opened = undefined;
      return undefined;
    }
    return opened.line;
  }

  /** The open row's controls, for its `opened-<n>` slot. Given `remove`, and while it is
   * `allowed`, the stepper's − is a bin at 1 that calls `run`. */
  controls(
    store: WorkingOrderStore,
    line: OrderLine,
    index: number,
    remove?: { allowed: boolean; run: () => void },
  ): TemplateResult | typeof nothing {
    if (this.line(store) !== line) return nothing;
    const name = lineProductName(line.product);
    const count = Number(line.quantity);
    // A weighed dish's amount and a set-menu dish's count are changed in its details.
    const stepped = soldByTheUnit(line.product) && line.setMenuId === undefined;
    const addable =
      store.canSelectProduct?.(line.product) !== false &&
      !line.notOfferedExtras?.some((extra) => extra.listId !== null && extra.productId !== null);
    // As the row button: open only while nothing blocks it, so these are drawn enabled.
    const disabled = this.#blocked(store);
    const live = () => this.line(this.#current()) === line;
    const details = (event: Event, note: boolean) => {
      if (!live()) return;
      (event.currentTarget as Element)
        .closest<TillBasket>("till-basket")
        ?.openLineDetails(line, { note });
    };
    return html`<div slot=${`opened-${index}`} data-draft-open=${index}>
      <div class="draft-open-info" data-draft-open-info>${dishFacts(line.product)}</div>
      <div class="draft-open-acts">
        ${
          stepped
            ? html`<wt-stepper
                .value=${count}
                .min=${1}
                .max=${addable ? null : count}
                .label=${name}
                ?disabled=${disabled}
                .decreaseLabel=${(label: string) => fill(t("action.decrease"), { label })}
                .increaseLabel=${(label: string) => fill(t("action.increase"), { label })}
                .removeLabel=${
                  remove?.allowed === true
                    ? (label: string) => fill(t("action.remove_named"), { label })
                    : null
                }
                @wt-remove=${(event: Event) => {
                  event.stopPropagation();
                  if (live()) remove?.run();
                }}
                @wt-change=${(event: CustomEvent<{ value: number }>) => {
                  event.stopPropagation();
                  if (live())
                    store.setLineQuantity(store.lines.indexOf(line), String(event.detail.value));
                  (event.currentTarget as WtStepper).value = Number(line.quantity);
                }}
              ></wt-stepper>`
            : nothing
        }
        <button
          type="button"
          class="draft-open-act"
          data-draft-open-options
          ?disabled=${disabled}
          @click=${(event: Event) => details(event, false)}
        >
          ${t("line.options.button")}
        </button>
        <button
          type="button"
          class="draft-open-act"
          data-draft-open-note
          ?disabled=${disabled}
          @click=${(event: Event) => details(event, true)}
        >
          ${t("line.note.button")}
        </button>
      </div>
    </div>`;
  }
}

const openedRowStyles = css`
  .draft-open-info {
    padding: 0 var(--wt-space-2);
    font-size: var(--wt-font-size-sm);
    overflow-wrap: anywhere;
  }
  .draft-open-info p,
  .draft-open-info ul {
    margin: 0 0 var(--wt-space-1);
    padding: 0;
  }
  .draft-open-info [data-description] {
    color: var(--wt-color-text-muted);
  }
  .draft-open-info h3 {
    margin: var(--wt-space-1) 0 0;
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }
  .draft-open-info ul {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--wt-space-3);
    list-style: none;
  }
  .draft-open-info li {
    display: flex;
    align-items: center;
    gap: var(--wt-space-1);
  }
  .draft-open-info wt-icon {
    flex-shrink: 0;
  }
  .draft-open-acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    padding: var(--wt-space-1) var(--wt-space-2) var(--wt-space-2);
  }
  .draft-open-act {
    box-sizing: border-box;
    height: var(--wt-tap-min);
    margin: 0;
    padding: 0 var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    font: inherit;
    font-size: var(--wt-font-size-md);
    font-weight: var(--wt-font-weight-bold);
    cursor: pointer;
  }
  .draft-open-act:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;

/** For the screen's own styles: everything it slots into a row, the opened row's controls included. */
export const draftSlotStyles = [draftRowSlotStyles, openedRowStyles];
