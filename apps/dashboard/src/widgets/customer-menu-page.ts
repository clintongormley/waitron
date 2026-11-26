import {
  ALLERGEN_CODES,
  DIETARY_LABELS,
  MEDIA_FILENAME,
  formatMoney,
  guestMenuWords,
  type GuestChoice,
  type GuestDeclarations,
  type GuestMember,
  type PublicGuestMenu,
} from "@waitron/shared";
import { applyTokens, baseStyles, NUTRITION_ICONS, registerIcons } from "@waitron/ui";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

registerIcons(NUTRITION_ICONS);

type Words = ReturnType<typeof guestMenuWords>;

function icon(name: string, label: string) {
  return html`<wt-icon name=${name} role="img" aria-label=${label} title=${label}></wt-icon>`;
}

function declarations({ allergens, dietary }: GuestDeclarations, { language, text }: Words) {
  return html`<span class="declarations" lang=${language}>
    ${
      allergens === null
        ? nothing
        : ALLERGEN_CODES.filter((code) => Object.hasOwn(allergens, code)).map((code) => {
            const kinds = allergens[code]!.kinds?.map((kind) => text[kind]!).join(", ");
            return html`<span>
              ${icon(`allergen-${code}`, kinds ? `${text[code]} (${kinds})` : text[code]!)}
              ${kinds ? html`<span aria-hidden="true">${kinds}</span>` : nothing}
            </span>`;
          })
    }
    ${dietary.map((diet) => icon(`diet-${diet}`, text[diet]!))}
  </span>`;
}

function legend({ language, text }: Words) {
  const key = (codes: readonly string[], prefix: string) =>
    html` <ul class="key">
      ${codes.map((code) => html`<li><wt-icon name=${`${prefix}-${code}`}></wt-icon>${text[code]}</li>`)}
    </ul>`;
  return html`<footer lang=${language}>
    <p>${text.note}</p>
    <h3>${text.key}</h3>
    ${key(ALLERGEN_CODES, "allergen")}
    <h3>${text.diet}</h3>
    ${key(DIETARY_LABELS, "diet")}
  </footer>`;
}

@customElement("dashboard-customer-menu-page")
export class CustomerMenuPage extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      article {
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
        font-size: var(--wt-font-size-md);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        overflow-wrap: anywhere;
      }
      h2 {
        font-size: calc(1.4 * var(--wt-font-size-xl));
      }
      h2,
      .section-title {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .section-title,
      h3 {
        font-size: var(--wt-font-size-lg);
      }
      .members {
        display: grid;
        gap: var(--wt-space-5);
      }
      section,
      .set-menu {
        grid-column: 1 / -1;
      }
      .set-menu {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .dish {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-content: start;
        align-items: start;
        gap: var(--wt-space-3);
      }
      .dish strong,
      .set-menu strong {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
      img {
        display: block;
        inline-size: min(84px, 24cqi);
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: var(--wt-radius-md);
      }
      .description,
      .declarations {
        color: var(--wt-color-text-muted);
      }
      .description,
      .price,
      .choices {
        margin: var(--wt-space-1) 0 0;
      }
      .declarations,
      .declarations > span,
      .key li {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-1);
      }
      .choices {
        padding-inline-start: var(--wt-space-4);
      }
      .choices li + li,
      .extra {
        margin-block-start: var(--wt-space-1);
      }
      footer {
        border-block-start: 1px solid var(--wt-color-border);
        margin-block-start: var(--wt-space-5);
        padding-block-start: var(--wt-space-3);
      }
      .key {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding: 0;
      }
      @container (min-width: 640px) {
        article {
          padding: var(--wt-space-6);
        }
        .members {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .dish {
          grid-template-columns: minmax(0, 1fr);
        }
        img {
          grid-row: 1;
          inline-size: 100%;
          aspect-ratio: 4 / 3;
        }
      }
    `,
  ];

  @property({ attribute: false }) menu?: PublicGuestMenu;
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: "data-theme" }) theme: "light" | "dark" = "light";

  protected override updated(): void {
    const root = this.renderRoot.querySelector<HTMLElement>("article");
    if (root && !root.hasAttribute("data-wt-theme-root")) applyTokens(root);
  }

  protected override render() {
    const menu = this.menu;
    if (!menu) return nothing;
    const words = guestMenuWords(menu.language, this.defaultLanguage);
    const money = (value: string) => formatMoney(value, menu.language);
    const unit = (value: string) => (value === "" ? "" : `/${value}`);
    const quantity = new Intl.NumberFormat(menu.language, { maximumFractionDigits: 3 });
    const choice = (value: GuestChoice & { portion?: string }) => {
      const size =
        value.portion !== undefined && value.unit
          ? ` · ${quantity.format(Number(value.portion))} ${value.unit}`
          : "";
      const rate = value.portion === undefined ? unit(value.unit) : "";
      return html`<li>
        ${value.name}${size} ${money(value.price)}${rate} ${declarations(value, words)}
      </li>`;
    };
    let firstPhoto = true;

    const members = (items: GuestMember[], level: number): TemplateResult =>
      html` <div class="members">
        ${items.map((member) => {
          switch (member.kind) {
            case "section":
              return html`<section>
                <div class="section-title" role="heading" aria-level=${Math.min(6, level)}>
                  ${member.name}
                </div>
                ${members(member.members, level + 1)}
              </section>`;
            case "set_menu":
              return html`<div class="set-menu">
                <strong>${member.name}</strong><span>${money(member.price)}</span>
              </div>`;
            case "product": {
              const { min, max } = member.price;
              const image = member.image && MEDIA_FILENAME.test(member.image) ? member.image : null;
              const eager = firstPhoto && image !== null;
              if (image !== null) firstPhoto = false;
              return html`<div class="dish">
                <div>
                  <strong>${member.name}</strong> ${declarations(member, words)}
                  ${member.description ? html`<p class="description">${member.description}</p>` : nothing}
                  <p class="price">
                    ${min === max ? money(min) : `${money(min)}–${money(max)}`}${unit(member.unit)}
                  </p>
                  ${
                    member.variants.length
                      ? html`<ul class="choices">
                          ${member.variants.map(choice)}
                        </ul>`
                      : nothing
                  }
                  ${member.modifiers.map((group) =>
                    group.kind === "extras" && group.items.length
                      ? html`<div class="extra">
                          ${group.name}
                          <ul class="choices">
                            ${group.items.map(choice)}
                          </ul>
                        </div>`
                      : nothing,
                  )}
                </div>
                ${
                  image === null
                    ? nothing
                    : html`<img
                        src=${liveMediaImage(image, "display")}
                        alt=""
                        loading=${eager ? nothing : "lazy"}
                        fetchpriority=${eager ? "high" : nothing}
                      />`
                }
              </div>`;
            }
          }
        })}
      </div>`;
    return html`<article lang=${menu.language} data-theme=${this.theme}>
      <h2>${menu.name}</h2>
      ${members(menu.members, 3)} ${legend(words)}
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-customer-menu-page": CustomerMenuPage;
  }
}
