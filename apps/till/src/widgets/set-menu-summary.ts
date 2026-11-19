import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import {
  centsToDecimal,
  checkMoves,
  type BillSetMenuState,
  type DishMove,
  type PlacedDish,
} from "@waitron/shared";
import { codeMessage } from "../i18n/codes.js";
import { countText, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  draftNamesLosingPlace,
  draftPlacementId,
  draftPlacements,
  menusWithCopies,
} from "../state/set-menus.js";
import type { OrderLine } from "../state/working-order.js";
import { lineProductName } from "./product-name.js";
import {
  setMenuCourseName,
  setMenuPrice,
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
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) bill: BillSetMenuState | null = null;
  @property({ attribute: false }) draft: readonly OrderLine[] = [];
  @property({ attribute: false }) courseNames: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) dishNames: ReadonlyMap<string, string> = new Map();
  @property({ attribute: false }) removeMenu?: (id: string) => Promise<string | undefined>;
  @property({ attribute: false }) moveDish?: (move: DishMove) => Promise<string | undefined>;
  @property({ type: Boolean }) busy = false;
  @state() private moving: string | null = null;
  @state() private pending = false;
  @state() private errors = new Map<string, string>();

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render() {
    const bill = this.bill;
    if (bill === null || bill.setMenus.length === 0) return nothing;
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
    const disabled = this.busy || this.pending;

    const moveOptions = (dish: PlacedDish) =>
      rows.flatMap((row) =>
        row.places.flatMap(({ name, place, open }) => {
          if (open <= 0 || (row.id === dish.setMenuLineId && place === dish.place)) return [];
          const move = { lineId: dish.lineId, to: { setMenuLineId: row.id, place } };
          const result = checkMoves(bill, [move]);
          return result.kind === "ok"
            ? [
                {
                  move,
                  label: `${row.name} ${row.number} · ${name} · ${setMenuPrice(centsToDecimal(result.results[0]!.priceCents), "set_menu.included")}`,
                },
              ]
            : [];
        }),
      );

    const sentDish = (dish: PlacedDish, menuId: string) => {
      const options = this.moveDish === undefined || !dish.movable ? [] : moveOptions(dish);
      return html`<li>
        ${this.dishNames.get(dish.lineId)}${setMenuTag(centsToDecimal(dish.priceCents))}
        ${
          options.length === 0
            ? nothing
            : html`
                <wt-button
                  variant="ghost"
                  ?disabled=${disabled}
                  aria-expanded=${this.moving === dish.lineId ? "true" : "false"}
                  @click=${() => {
                    this.moving = this.moving === dish.lineId ? null : dish.lineId;
                  }}
                  >${t("set_menu.move")}</wt-button
                >
                ${
                  this.moving !== dish.lineId
                    ? nothing
                    : html` <div class="actions" data-move-options>
                        ${options.map(
                          ({ move, label }) =>
                            html` <wt-button
                              variant="secondary"
                              ?disabled=${disabled}
                              @click=${() => void this.#apply(menuId, () => this.moveDish!(move))}
                              >${label}</wt-button
                            >`,
                        )}
                      </div>`
                }
              `
        }
      </li>`;
    };

    return html`<details>
      <summary>
        ${total} · ${types}
        ${places === "" ? nothing : html`<span class="open">${fill(t("set_menu.open_places"), { places })}</span>`}
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
                  ${sent.map((dish) => sentDish(dish, row.id))}
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
            <wt-button
              variant="secondary"
              ?disabled=${disabled || this.removeMenu === undefined}
              @click=${() =>
                void this.#apply(row.id, async () => {
                  if (row.places.some(({ sent }) => sent.length > 0))
                    return this.removeMenu!(row.id);
                  const draft = draftNamesLosingPlace(bill, this.draft, [row.id]);
                  if (draft.length > 0)
                    return codeMessage("set_menu.needed_by_draft", undefined, {
                      setMenuName: row.name,
                      dishNames: draft,
                    });
                  return this.removeMenu!(row.id);
                })}
              >${t("action.cancel")}</wt-button
            >
            <div class="error" role="status">${this.errors.get(row.id) ?? ""}</div>
          </article>
        `,
      )}
    </details>`;
  }

  async #apply(id: string, change: () => Promise<string | undefined>) {
    if (this.pending || this.busy) return;
    this.pending = true;
    let error: string | undefined;
    try {
      error = await change();
    } catch {
      error = codeMessage("server.error");
    } finally {
      this.errors = new Map(this.errors).set(id, error ?? "");
      this.pending = false;
    }
    if (error === undefined) this.moving = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-set-menu-summary": TillSetMenuSummary;
  }
}
