import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { centsToDecimal, type BillSetMenuState } from "@waitron/shared";
import { countText, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { draftPlacementId, draftPlacements, menusWithCopies } from "../state/set-menus.js";
import type { OrderLine } from "../state/working-order.js";
import { lineProductName } from "./product-name.js";
import {
  notCheapestText,
  setMenuCourseName,
  setMenuTag,
  setMenuTagStyles,
} from "./set-menu-presentation.js";

@customElement("till-set-menu-summary")
export class TillSetMenuSummary extends LitElement {
  static override styles = [
    baseStyles,
    setMenuTagStyles,
    css`
      :host {
        display: block;
      }
      details {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      summary,
      article {
        padding: var(--wt-space-2) var(--wt-space-3);
      }
      summary {
        cursor: pointer;
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
      .open {
        display: block;
      }
      p.open {
        margin: 0;
      }
      .open,
      .unsent {
        color: var(--wt-color-text-muted);
      }
      article {
        border-top: 1px solid var(--wt-color-border);
      }
      h3 {
        display: inline;
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      ul {
        margin: var(--wt-space-2) 0;
        padding-inline-start: var(--wt-space-5);
      }
    `,
  ];

  @property({ attribute: false }) bill: BillSetMenuState | null = null;
  @property({ attribute: false }) draft: readonly OrderLine[] = [];
  @property({ attribute: false }) courseNames: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) dishNames: ReadonlyMap<string, string> = new Map();
  @property({ attribute: false }) compMenu?: (lineId: string, name: string) => void;
  @property({ type: Boolean }) busy = false;
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render() {
    const bill = this.bill;
    if (bill === null) return nothing;
    const note = notCheapestText(bill);
    if (bill.setMenus.length === 0)
      return note === undefined ? nothing : html`<p class="open" data-not-cheapest>${note}</p>`;
    const held = draftPlacements(bill, this.draft).placed;
    const draftNames = new Map(
      this.draft.map((line, index) => [
        draftPlacementId(line, index),
        lineProductName(line.product),
      ]),
    );
    const counts = new Map<string, { name: string; count: number }>();
    const openings = new Map<string, number>();
    const rows = menusWithCopies(bill).map(({ menu, copy }) => {
      const type = counts.get(copy.setMenuId) ?? { name: copy.name, count: 0 };
      counts.set(copy.setMenuId, type);
      type.count++;
      const places = copy.lines.map(({ count, courseIds }, place) => {
        const name = setMenuCourseName(courseIds, this.courseNames);
        const sent = bill.dishes.filter(
          (dish) => dish.setMenuLineId === menu.lineId && dish.place === place,
        );
        const unsent = held.filter(
          (dish) => dish.setMenuLineId === menu.lineId && dish.place === place,
        );
        const open = count - sent.length - unsent.length;
        openings.set(name, (openings.get(name) ?? 0) + Math.max(0, open));
        return { name, place, sent, unsent, open };
      });
      return { id: menu.lineId, name: copy.name, number: type.count, places };
    });
    const total = countText(rows.length, "set_menu.many", "set_menu.one");
    const types = Array.from(counts.values(), ({ name, count }) => `${count} ${name}`).join(" + ");
    const places = Array.from(openings)
      .flatMap(([name, count]) => (count > 0 ? [`${count} ${name}`] : []))
      .join(" · ");
    return html`<details>
      <summary>
        ${total} · ${types}
        ${places === "" ? nothing : html`<span class="open">${fill(t("set_menu.open_places"), { places })}</span>`}
        ${note === undefined ? nothing : html`<span class="open" data-not-cheapest>${note}</span>`}
      </summary>
      ${repeat(
        rows,
        ({ id }) => id,
        (row) => html`
          <article>
            <h3>${row.name} ${row.number}</h3>
            <ul>
              ${row.places.map(
                ({ name, open, sent, unsent }) => html`
                  ${sent.map(
                    (dish) =>
                      html`<li>
                        ${this.dishNames.get(dish.lineId)}${setMenuTag(centsToDecimal(dish.priceCents))}
                      </li>`,
                  )}
                  ${unsent.map(
                    (dish) =>
                      html`<li>
                        ${draftNames.get(dish.id)}${setMenuTag(centsToDecimal(dish.priceCents))}
                        <span class="unsent"> · ${t("set_menu.unsent")}</span>
                      </li>`,
                  )}
                  ${
                    open <= 0
                      ? nothing
                      : html`<li>
                          ${t("set_menu.open")} · ${open > 1 ? `${open} × ` : ""}${name}
                        </li>`
                  }
                `,
              )}
            </ul>
            ${
              this.compMenu === undefined
                ? nothing
                : html`<wt-button
                    variant="secondary"
                    data-comp-menu
                    aria-label=${`${t("comp.title")} · ${row.name} ${row.number}`}
                    ?disabled=${this.busy}
                    @click=${() => this.compMenu!(row.id, `${row.name} ${row.number}`)}
                    >${t("comp.title")}</wt-button
                  >`
            }
          </article>
        `,
      )}
    </details>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-set-menu-summary": TillSetMenuSummary;
  }
}
