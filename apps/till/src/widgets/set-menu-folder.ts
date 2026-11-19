import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { formatMoney, type ServedSetMenuCopy, type ServedSetMenuOffer } from "@waitron/shared";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { setMenuCourseName, setMenuPrice } from "./set-menu-presentation.js";

export interface PickSetMenuDishDetail {
  setMenuId: string;
  versionId: string;
  offer: ServedSetMenuOffer;
}

@customElement("till-set-menu-folder")
export class TillSetMenuFolder extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host,
      section {
        display: grid;
        gap: var(--wt-space-2);
      }
      h2,
      h3 {
        margin: 0;
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      .dishes {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) copy: ServedSetMenuCopy | null = null;
  @property() versionId = "";
  @property({ attribute: false }) courseNames: Readonly<Record<string, string>> = {};
  @property({ type: Boolean }) busy = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render() {
    const copy = this.copy;
    if (copy === null) return nothing;
    const groups = copy.terms.lines.map(() => [] as ServedSetMenuOffer[]);
    for (const offer of copy.offers) {
      if (offer.unit.measure) continue;
      const courses = [
        ...(offer.countsAsCourseId === null ? [] : [offer.countsAsCourseId]),
        ...offer.variants.map((variant) => offer.variantCountsAs[variant.id]),
      ];
      const first = copy.terms.lines.findIndex(({ courseIds }) =>
        courseIds.some((id) => courses.includes(id)),
      );
      if (first !== -1) groups[first]!.push(offer);
    }
    return html`
      <h2>${copy.name} · ${formatMoney(copy.terms.price, currentLocale())}</h2>
      <div>
        <wt-button
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("add-set-menu", {
                detail: { setMenuId: copy.menuId },
                bubbles: true,
                composed: true,
              }),
            )}
          >${fill(t("set_menu.add"), { name: copy.name })}</wt-button
        >
      </div>
      ${copy.terms.lines.map(
        ({ count, courseIds }, index) => html`
          <section>
            <h3>
              ${count > 1 ? `${count} × ` : ""}${setMenuCourseName(courseIds, this.courseNames)}
            </h3>
            <div class="dishes">
              ${groups[index]!.map((offer) => this.#dish(copy.menuId, offer))}
            </div>
          </section>
        `,
      )}
    `;
  }

  #dish(setMenuId: string, offer: ServedSetMenuOffer) {
    const hasVariants = Object.keys(offer.variantCountsAs).length > 0;
    const available =
      offer.available && (!hasVariants || offer.variants.some((variant) => variant.available));
    const prices = hasVariants
      ? offer.variants.map((variant) => variant.unitPrice)
      : [offer.unitPrice];
    return html`<wt-button
      variant="secondary"
      ?disabled=${this.busy || !available}
      @click=${() =>
        this.dispatchEvent(
          new CustomEvent<PickSetMenuDishDetail>("pick-set-menu-dish", {
            detail: { setMenuId, versionId: this.versionId, offer },
            bubbles: true,
            composed: true,
          }),
        )}
      >${offer.name}
      ${[...new Set(prices)].map((price) => setMenuPrice(price, "set_menu.included")).join(" / ")}
      ${available ? nothing : html`<span> · ${t("menu.sold_out")}</span>`}
    </wt-button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-set-menu-folder": TillSetMenuFolder;
  }
}
