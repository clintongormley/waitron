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
import "@waitron/ui/src/components/wt-input.js";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

registerIcons(NUTRITION_ICONS);

type Words = ReturnType<typeof guestMenuWords>;
type PageMember = { member: GuestMember; sectionId?: string };

function matchingMember(member: GuestMember, query: string, language: string): GuestMember | null {
  if (member.kind !== "section")
    return member.name.toLocaleLowerCase(language).includes(query) ? member : null;
  const members = member.members
    .map((child) => matchingMember(child, query, language))
    .filter((child) => child !== null);
  return members.length ? { ...member, members } : null;
}

function scrollSource(element: HTMLElement): Element | Document {
  let ancestor: Element | null = element;
  while (ancestor) {
    const root = ancestor.getRootNode();
    ancestor =
      ancestor.assignedSlot ??
      ancestor.parentElement ??
      (root instanceof ShadowRoot ? root.host : null);
    if (ancestor && /^(auto|scroll)$/.test(getComputedStyle(ancestor).overflowY)) return ancestor;
  }
  return element.ownerDocument;
}

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
      header {
        display: grid;
        gap: var(--wt-space-3);
      }
      header h2 {
        margin: 0;
        font-size: calc(1.4 * var(--wt-font-size-xl));
      }
      wt-input::part(field) {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface);
      }
      nav {
        position: sticky;
        inset-block-start: 0;
        z-index: 1;
        display: flex;
        gap: var(--wt-space-4);
        overflow-x: auto;
        margin: var(--wt-space-2) 0 var(--wt-space-4);
        border-block-end: 1px solid var(--wt-color-border);
        background: var(--wt-color-bg);
      }
      nav a {
        flex: none;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-block: var(--wt-space-3);
        border-block-end: 3px solid transparent;
        color: var(--wt-color-text-muted);
        text-decoration: none;
      }
      nav a[aria-current] {
        border-block-end-color: var(--wt-color-primary);
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      nav a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }
      header + [role="status"] + .members {
        margin-block-start: var(--wt-space-4);
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
        header {
          grid-template-columns: minmax(0, 1fr) minmax(0, 24ch);
          align-items: center;
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

  @state() private query = "";
  #source?: Element | Document;
  #resize = new ResizeObserver(() => this.#watchScroll());

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize.observe(this);
  }

  override disconnectedCallback(): void {
    this.#resize.disconnect();
    this.#source?.removeEventListener("scroll", this.#markSection);
    this.#source = undefined;
    super.disconnectedCallback();
  }

  #watchScroll(): void {
    const source = scrollSource(this);
    if (source !== this.#source) {
      this.#source?.removeEventListener("scroll", this.#markSection);
      this.#source = source;
      source.addEventListener("scroll", this.#markSection, { passive: true });
    }
    this.#markSection();
  }

  #heading(link: HTMLAnchorElement) {
    return this.shadowRoot!.getElementById(link.hash.slice(1))!;
  }

  #markSection = (): void => {
    const strip = this.renderRoot.querySelector("nav");
    if (!strip) return;
    const links = Array.from(strip.querySelectorAll("a"));
    const edge = strip.getBoundingClientRect().bottom + 1;
    const scroller = this.#scroller();
    const end = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    let current = links[0]!;
    if (scroller && end > 1 && scroller.scrollTop >= end - 1) current = links.at(-1)!;
    else {
      for (const link of links) {
        if (this.#heading(link).getBoundingClientRect().top > edge) break;
        current = link;
      }
    }
    const previous = strip.querySelector("[aria-current]");
    if (previous === current) return;
    previous?.removeAttribute("aria-current");
    current.setAttribute("aria-current", "location");
    const stripLeft = strip.getBoundingClientRect().left;
    const { left, right } = current.getBoundingClientRect();
    const stripRight = stripLeft + strip.clientWidth;
    strip.scrollLeft += left < stripLeft ? left - stripLeft : Math.max(0, right - stripRight);
  };

  #scroller() {
    return this.#source instanceof Document ? this.#source.scrollingElement : this.#source;
  }

  #jump(event: MouseEvent): void {
    event.preventDefault();
    const link = event.currentTarget as HTMLAnchorElement;
    const heading = this.#heading(link);
    const scroller = this.#scroller();
    if (scroller) {
      const top = this.#source instanceof Document ? 0 : scroller.getBoundingClientRect().top;
      const stripHeight = link.parentElement!.getBoundingClientRect().height;
      scroller.scrollTop += heading.getBoundingClientRect().top - top - stripHeight;
    }
    heading.focus({ preventScroll: true });
    this.#markSection();
  }

  protected override updated(): void {
    const root = this.renderRoot.querySelector<HTMLElement>("article");
    if (root && !root.hasAttribute("data-wt-theme-root")) applyTokens(root);
    this.#watchScroll();
  }

  protected override render() {
    const menu = this.menu;
    if (!menu) return nothing;
    const words = guestMenuWords(menu.language, this.defaultLanguage);
    const query = this.query.trim().toLocaleLowerCase(menu.language);
    const visible = menu.members.flatMap((item, index): PageMember[] => {
      const member = query ? matchingMember(item, query, menu.language) : item;
      return member ? [{ member, sectionId: `section-${index}` }] : [];
    });
    const sections = visible.filter(({ member }) => member.kind === "section");
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

    const members = (items: PageMember[], level: number): TemplateResult =>
      html` <div class="members">
        ${items.map(({ member, sectionId }) => {
          switch (member.kind) {
            case "section":
              return html`<section>
                <div
                  class="section-title"
                  role="heading"
                  aria-level=${Math.min(6, level)}
                  id=${sectionId ?? nothing}
                  tabindex=${sectionId ? "-1" : nothing}
                >
                  ${member.name}
                </div>
                ${members(
                  member.members.map((child) => ({ member: child })),
                  level + 1,
                )}
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
      <header>
        <h2>${menu.name}</h2>
        <search lang=${words.language}>
          <wt-input
            name="dish-search"
            type="search"
            hide-label
            label=${words.text.searchDishes!}
            placeholder=${words.text.searchDishes!}
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.query = event.detail.value;
            }}
          ></wt-input>
        </search>
      </header>
      ${
        sections.length
          ? html`<nav lang=${words.language} aria-label=${words.text.menuSections!}>
              ${sections.map(
                ({ member, sectionId }) =>
                  html`<a href=${`#${sectionId}`} lang=${menu.language} @click=${this.#jump}
                    >${member.name}</a
                  >`,
              )}
            </nav>`
          : nothing
      }
      <div role="status" lang=${words.language}>
        ${query && !visible.length ? words.text.noDishes : nothing}
      </div>
      ${members(visible, 3)} ${legend(words)}
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-customer-menu-page": CustomerMenuPage;
  }
}
