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
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { choiceCaution, filterCustomerMenu, hasCautionedChoice } from "./customer-menu-filters.js";

registerIcons(NUTRITION_ICONS);

type Words = ReturnType<typeof guestMenuWords>;
type PageMember = { member: GuestMember; sectionId?: string };
type MenuEntry = Exclude<GuestMember, { kind: "section" }>;
type OpenDetail = {
  member: MenuEntry;
  button: HTMLElement;
  top: number;
  left: number;
};

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

function stripDepth(strip: HTMLElement): number {
  return strip.getBoundingClientRect().height + parseFloat(getComputedStyle(strip).marginBlockEnd);
}

function icon(name: string, label: string) {
  return html`<wt-icon name=${name} role="img" aria-label=${label} title=${label}></wt-icon>`;
}

function allergenLabels(allergens: GuestDeclarations["allergens"], { text }: Words) {
  return ALLERGEN_CODES.filter((code) => allergens && Object.hasOwn(allergens, code)).map(
    (code) => {
      const kinds = allergens![code]!.kinds?.map((kind) => text[kind]!).join(", ");
      return { code, kinds, label: kinds ? `${text[code]} (${kinds})` : text[code]! };
    },
  );
}

function declarations({ allergens, dietary }: GuestDeclarations, { language, text }: Words) {
  return html`<span class="declarations" lang=${language}>
    ${allergenLabels(allergens, { language, text }).map(
      ({ code, kinds, label }) =>
        html`<span>
          ${icon(`allergen-${code}`, label)}
          ${kinds ? html`<span aria-hidden="true">${kinds}</span>` : nothing}
        </span>`,
    )}
    ${dietary.map((diet) => icon(`diet-${diet}`, text[diet]!))}
  </span>`;
}

function declarationLabels({ allergens, dietary }: GuestDeclarations, words: Words) {
  return {
    allergens: allergenLabels(allergens, words).map(({ code, label }) => ({
      icon: `allergen-${code}`,
      label,
    })),
    diets: dietary.map((diet) => ({ icon: `diet-${diet}`, label: words.text[diet]! })),
  };
}

function namedAllergenLabels(
  { name, allergens }: Pick<GuestChoice, "name" | "allergens">,
  words: Words,
) {
  return allergenLabels(allergens, words).map(({ code, kinds, label }) => ({
    icon: `allergen-${code}`,
    label: `${name}: ${kinds || label}`,
    category: kinds ? words.text[code] : undefined,
  }));
}

function detailDeclarations(
  heading: string,
  labels: { icon: string; label: string; category?: string }[],
  language: string,
) {
  return labels.length
    ? html`<div lang=${language}>
        <h3>${heading}</h3>
        <div class="declarations">
          ${labels.map(
            ({ icon: glyph, label, category }) =>
              html`<span>
                ${category ? icon(glyph, category) : html`<wt-icon name=${glyph} aria-hidden="true"></wt-icon>`}
                ${label}
              </span>`,
          )}
        </div>
      </div>`
    : nothing;
}

function courseLabel(
  { count, courses }: Extract<MenuEntry, { kind: "set_menu" }>["lines"][number],
  language: string,
) {
  const text = new Intl.ListFormat(language, { type: "disjunction" }).format(courses);
  return count === 1 ? text : `${new Intl.NumberFormat(language).format(count)} × ${text}`;
}

function unitRate(unit: string) {
  return unit === "" ? "" : `/${unit}`;
}

function dishPrice(
  { price: { min, max }, unit }: Extract<MenuEntry, { kind: "product" }>,
  language: string,
) {
  const minimum = formatMoney(min, language);
  return `${min === max ? minimum : `${minimum}–${formatMoney(max, language)}`}${unitRate(unit)}`;
}

function choiceRow(
  name: string,
  price: string,
  value: GuestDeclarations,
  words: Words,
  excluded: readonly string[],
  showAllergenIcons = false,
) {
  const { allergens, diets } = declarationLabels(value, words);
  const labels = (showAllergenIcons ? diets : [...allergens, ...diets]).map(({ label }) => label);
  const caution = choiceCaution(value, excluded);
  return html`<li>
    <span>
      ${name}
      ${
        showAllergenIcons && allergens.length
          ? html`<span class="declarations" lang=${words.language}>
              ${allergens.map(({ icon: glyph, label }) => icon(glyph, label))}
            </span>`
          : nothing
      }
    </span>
    ${price ? html`<span class="choice-price">${price}</span>` : nothing}
    ${
      labels.length
        ? html`<span class="description" lang=${words.language}>${labels.join(", ")}</span>`
        : nothing
    }
    ${caution ? html`<strong class="choice-caution" lang=${words.language}>${words.text[caution]}</strong>` : nothing}
  </li>`;
}

function detailContent(
  member: MenuEntry,
  words: Words,
  language: string,
  excluded: readonly string[],
  filtered: boolean,
) {
  const money = (value: string) => formatMoney(value, language);
  if (member.kind === "set_menu") {
    const allergens = member.lines.flatMap(({ choices }) =>
      choices.flatMap((choice) => namedAllergenLabels(choice, words)),
    );
    return html`<p class="set-price" lang=${words.language}>
        ${words.text.perPerson!.replace("{price}", money(member.price))}
      </p>
      ${filtered ? html`<p class="description" lang=${words.language}>${words.text.askAboutSetMenu}</p>` : nothing}
      ${member.lines.map(
        (line) =>
          html`<h3>${courseLabel(line, language)}</h3>
            ${
              line.choices.length
                ? html`<ul class="choices" role="list">
                    ${line.choices.map((choice) =>
                      choiceRow(
                        choice.name,
                        choice.price === "0.00" ? "" : `+ ${money(choice.price)}`,
                        choice,
                        words,
                        excluded,
                        true,
                      ),
                    )}
                  </ul>`
                : nothing
            }`,
      )}
      ${detailDeclarations(words.text.allergens!, allergens, words.language)}`;
  }
  const quantity = new Intl.NumberFormat(language, { maximumFractionDigits: 3 });
  const { allergens, diets } = declarationLabels(member, words);
  const extraAllergens = member.modifiers.flatMap((group) =>
    group.kind === "extras" ? group.items.flatMap((item) => namedAllergenLabels(item, words)) : [],
  );
  return html`
    <p class="set-price"><strong>${dishPrice(member, language)}</strong></p>
    ${member.description ? html`<p class="description">${member.description}</p>` : nothing}
    ${
      member.variants.length
        ? html`<h3 lang=${words.language}>${words.text.variants}</h3>
            <ul class="choices" role="list">
              ${member.variants.map((value) =>
                choiceRow(
                  value.name,
                  `${money(value.price)}${unitRate(value.unit)}`,
                  value,
                  words,
                  excluded,
                ),
              )}
            </ul>`
        : nothing
    }
    ${member.modifiers.map((group) => {
      if (group.kind === "options") {
        return group.labels.length
          ? html`<h3>${group.name}</h3>
              <p class="description">${group.labels.join(" · ")}</p>`
          : nothing;
      }
      return group.items.length
        ? html`<h3>${group.name}</h3>
            <ul class="choices" role="list">
              ${group.items.map((value) => {
                const amount = Number(value.portion);
                let size = "";
                if (value.servingUnit !== undefined) {
                  if (amount !== 1) size = ` · ${quantity.format(amount)} × ${value.servingUnit}`;
                } else if (value.unit) {
                  size = ` · ${quantity.format(amount)} ${value.unit}`;
                }
                return choiceRow(
                  `${value.name}${size}`,
                  money(value.price),
                  value,
                  words,
                  excluded,
                  true,
                );
              })}
            </ul>`
        : nothing;
    })}
    ${detailDeclarations(words.text.allergens!, [...allergens, ...extraAllergens], words.language)}
    ${detailDeclarations(words.text.diet!, diets, words.language)}
    <p class="description" lang=${words.language}>${words.text.askAboutAllergens}</p>
  `;
}

function legend({ language, text }: Words) {
  const key = (codes: readonly string[], prefix: string) =>
    html` <ul class="key">
      ${codes.map((code) => html`<li><wt-icon name=${`${prefix}-${code}`}></wt-icon>${text[code]}</li>`)}
    </ul>`;
  return html`<footer lang=${language}>
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
        --menu-padding: var(--wt-space-4);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
        font-size: var(--wt-font-size-md);
        padding: var(--menu-padding);
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
        font-size: calc(1.65 * var(--wt-font-size-xl));
      }
      search {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .filter-button {
        --wt-action-radius: var(--wt-radius-full);
      }
      .filter-fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      .filter-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
      .choice-caution {
        grid-column: 1 / -1;
        font-size: var(--wt-font-size-sm);
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
      @media (forced-colors: active) {
        nav a {
          border-block-end-color: Canvas;
        }
        nav a[aria-current] {
          border-block-end-color: Highlight;
        }
      }
      nav a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }
      .no-results {
        margin-block-start: calc(var(--wt-space-2) + var(--wt-space-3));
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
      .section-title {
        font-size: calc(1.4 * var(--wt-font-size-lg));
      }
      h3 {
        font-size: var(--wt-font-size-lg);
      }
      section section > .section-title {
        font-size: var(--wt-font-size-md);
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
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .set-menu .set-price {
        white-space: nowrap;
      }
      .dish {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-content: start;
        align-items: start;
        gap: var(--wt-space-3);
      }
      .entry-name,
      .set-price {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
      .entry-name {
        background: transparent;
        border: 0;
        padding: 0;
        font-family: inherit;
        color: var(--wt-color-primary-text);
        text-align: start;
        cursor: pointer;
      }
      .entry-name:hover,
      .entry-name:focus-visible {
        text-decoration: underline;
      }
      .entry-name:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .back {
        --wt-action-text: var(--wt-color-primary-text);
        --wt-action-radius: var(--wt-radius-full);
      }
      .back[variant="ghost"] {
        /* Align the inset chevron with the title and leave room inside the hover outline. */
        --wt-button-padding-inline: var(--wt-space-2);
        margin-inline-start: calc(-1 * var(--wt-space-3));
      }
      img {
        display: block;
        inline-size: min(84px, 24cqi);
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: var(--wt-radius-md);
      }
      .detail-lead:has(img) {
        position: relative;
        margin-block-start: calc(-1 * var(--menu-padding));
        margin-inline: calc(-1 * var(--menu-padding));
        margin-block-end: var(--wt-space-4);
      }
      .detail-lead:has(img) .back {
        position: absolute;
        inset-block-start: var(--menu-padding);
        inset-inline-start: var(--menu-padding);
      }
      .detail-lead img {
        inline-size: 100%;
        max-block-size: 320px;
        aspect-ratio: 4 / 3;
        border-radius: calc(var(--wt-radius-lg) - 1px) calc(var(--wt-radius-lg) - 1px) 0 0;
      }
      .detail h2 {
        font-size: calc(1.4 * var(--wt-font-size-xl));
        margin-block-end: var(--wt-space-1);
      }
      .detail .set-price {
        margin: 0;
      }
      .detail h3 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        color: var(--wt-color-primary-text);
      }
      .description,
      .declarations,
      .dish .declarations wt-icon {
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
      .detail .declarations {
        column-gap: var(--wt-space-2);
      }
      .detail div.declarations {
        column-gap: var(--wt-space-4);
      }
      .detail .declarations wt-icon[name^="allergen-"] {
        color: inherit;
      }
      .choices .declarations {
        margin-inline-start: var(--wt-space-1);
        vertical-align: text-bottom;
      }
      .choices {
        padding: 0;
        list-style: none;
      }
      .choices li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: var(--wt-space-3);
        padding-block: var(--wt-space-2);
        border-block-end: 1px solid var(--wt-color-border);
      }
      .choices .description {
        grid-column: 1;
      }
      .choice-price {
        text-align: end;
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
          --menu-padding: var(--wt-space-6);
        }
        header {
          grid-template-columns: minmax(0, 1fr) minmax(0, 44%);
          align-items: center;
        }
        .members {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .dish {
          grid-template-columns: minmax(0, 1fr);
        }
        .dish-heading {
          display: flex;
          flex-wrap: wrap;
          column-gap: var(--wt-space-2);
          align-items: baseline;
        }
        .dish-name {
          flex: 1 1 50%;
        }
        .dish-heading > .price {
          margin-block-start: 0;
          margin-inline-start: auto;
          font-size: var(--wt-font-size-lg);
          text-align: end;
        }
        .dish-heading > .description {
          flex-basis: 100%;
          order: 1;
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
  @state() private excluded: string[] = [];
  @state() private diet = "";
  @state() private filtersOpen = false;
  @state() private detail?: OpenDetail;
  #source?: Element | Document;
  #jumpedAt?: number;
  #resize = new ResizeObserver(() => this.#watchScroll());

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize.observe(this);
    if (this.parentElement) this.#resize.observe(this.parentElement);
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
      this.#jumpedAt = undefined;
      source.addEventListener("scroll", this.#markSection, { passive: true });
    }
    this.#markSection();
  }

  #heading(link: HTMLAnchorElement) {
    return this.shadowRoot!.getElementById(link.hash.slice(1))!;
  }

  #markSection = (): void => {
    if (this.detail) return;
    const strip = this.renderRoot.querySelector("nav");
    if (!strip) return;
    const links = Array.from(strip.querySelectorAll("a"));
    const scroller = this.#scroller();
    if (this.#jumpedAt !== undefined && this.#jumpedAt === scroller?.scrollTop) return;
    this.#jumpedAt = undefined;
    const edge = strip.getBoundingClientRect().top + stripDepth(strip) + 1;
    const end = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    let current = links[0]!;
    if (scroller && end > 1 && scroller.scrollTop >= end - 1) current = links.at(-1)!;
    else {
      for (const link of links) {
        if (this.#heading(link).getBoundingClientRect().top > edge) break;
        current = link;
      }
    }
    this.#selectLink(strip, current);
  };

  #selectLink(strip: HTMLElement, current: HTMLAnchorElement): void {
    const previous = strip.querySelector("[aria-current]");
    if (previous === current) return;
    previous?.removeAttribute("aria-current");
    current.setAttribute("aria-current", "location");
    const stripLeft = strip.getBoundingClientRect().left;
    const { left, right } = current.getBoundingClientRect();
    const stripRight = stripLeft + strip.clientWidth;
    strip.scrollLeft += left < stripLeft ? left - stripLeft : Math.max(0, right - stripRight);
  }

  #scroller() {
    return this.#source instanceof Document ? this.#source.scrollingElement : this.#source;
  }

  #jump(event: MouseEvent): void {
    event.preventDefault();
    const link = event.currentTarget as HTMLAnchorElement;
    const heading = this.#heading(link);
    const strip = link.parentElement!;
    const scroller = this.#scroller();
    if (scroller) {
      const top = this.#source instanceof Document ? 0 : scroller.getBoundingClientRect().top;
      scroller.scrollTop += heading.getBoundingClientRect().top - top - stripDepth(strip);
      // A jump can clamp at the end. Keep the chosen link until the scroll position changes.
      this.#jumpedAt = scroller.scrollTop;
    }
    heading.focus({ preventScroll: true });
    this.#selectLink(strip, link);
  }

  async #openDetail(member: MenuEntry, event: MouseEvent): Promise<void> {
    const scroller = this.#scroller();
    this.detail = {
      member,
      button: event.currentTarget as HTMLElement,
      top: scroller?.scrollTop ?? 0,
      left: scroller?.scrollLeft ?? 0,
    };
    await this.updateComplete;
    const heading = this.renderRoot.querySelector<HTMLElement>(".detail h2")!;
    if (scroller) {
      const edge = this.#source instanceof Document ? 0 : scroller.getBoundingClientRect().top;
      scroller.scrollTop += heading.parentElement!.getBoundingClientRect().top - edge;
      scroller.scrollLeft = 0;
    }
    // A pointer click on the already-focused button can leave its keyboard focus ring visible.
    heading.focus({ preventScroll: true, focusVisible: event.detail === 0 });
  }

  async #closeDetail({ button, top, left }: OpenDetail): Promise<void> {
    this.detail = undefined;
    await this.updateComplete;
    this.#scroller()?.scrollTo(left, top);
    const box = button.getBoundingClientRect();
    const hit = this.shadowRoot!.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    if (hit !== button) button.scrollIntoView({ block: "center", inline: "nearest" });
    button.focus({ preventScroll: true });
  }

  #entryName(member: MenuEntry) {
    return html`<button
      class="entry-name"
      type="button"
      @click=${(event: MouseEvent) => void this.#openDetail(member, event)}
    >
      ${member.name}
    </button>`;
  }

  protected override updated(): void {
    const root = this.renderRoot.querySelector<HTMLElement>("article");
    if (root && !root.hasAttribute("data-wt-theme-root")) applyTokens(root);
    this.#jumpedAt = undefined;
    this.#watchScroll();
  }

  #filterDialog({ language, text }: Words) {
    return html`<wt-dialog
      .open=${this.filtersOpen}
      heading=${text.filters!}
      lang=${language}
      @wt-close=${() => {
        this.filtersOpen = false;
      }}
    >
      <div class="filter-fields">
        <wt-combobox
          name="exclude-allergens"
          label=${text.excludeAllergens!}
          multiple
          search="never"
          .values=${this.excluded}
          .options=${ALLERGEN_CODES.map((value) => ({ value, label: text[value]! }))}
          .countLabel=${(count: number) => text.selectedCount!.replace("{count}", new Intl.NumberFormat(language).format(count))}
          @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
            event.stopPropagation();
            this.excluded = event.detail.values;
          }}
        ></wt-combobox>
        <wt-combobox
          name="diet"
          label=${text.chooseDiet!}
          search="never"
          show-empty-option
          .value=${this.diet}
          .options=${[
            { value: "", label: text.anyDiet! },
            ...DIETARY_LABELS.map((value) => ({ value, label: text[value]! })),
          ]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.diet = event.detail.value;
          }}
        ></wt-combobox>
      </div>
      <div slot="footer" class="filter-actions">
        <wt-button
          variant="secondary"
          ?disabled=${!this.excluded.length && !this.diet}
          @click=${() => {
            this.excluded = [];
            this.diet = "";
          }}
          >${text.clearFilters}</wt-button
        >
        <wt-button
          variant="primary"
          @click=${() => {
            this.filtersOpen = false;
          }}
          >${text.closeFilters}</wt-button
        >
      </div>
    </wt-dialog>`;
  }

  protected override render() {
    const menu = this.menu;
    if (!menu) return nothing;
    const detail = this.detail;
    const words = guestMenuWords(menu.language, this.defaultLanguage);
    const query = this.query.trim().toLocaleLowerCase(menu.language);
    const { entries: visible, dishes } = filterCustomerMenu(
      menu.members,
      query,
      menu.language,
      this.diet,
      this.excluded,
    );
    const sections = visible.filter(({ member }) => member.kind === "section");
    const filtered = this.excluded.length > 0 || this.diet !== "";
    const noResults =
      (filtered && dishes === 0) || (!filtered && query.length > 0 && visible.length === 0);
    const emptyMessage = !filtered
      ? words.text.noDishes
      : query
        ? words.text.noDishesSearchAndFilters
        : words.text.noFilteredDishes;
    const money = (value: string) => formatMoney(value, menu.language);
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
                <div>
                  ${this.#entryName(member)}
                  ${filtered ? html`<p class="description" lang=${words.language}>${words.text.askAboutSetMenu}</p>` : nothing}
                  ${
                    member.lines.length
                      ? html`<p class="description">
                          ${member.lines.map((line) => courseLabel(line, menu.language)).join(", ")}
                        </p>`
                      : nothing
                  }
                </div>
                <strong class="set-price">${money(member.price)}</strong>
              </div>`;
            case "product": {
              const image = member.image && MEDIA_FILENAME.test(member.image) ? member.image : null;
              const eager = firstPhoto && image !== null;
              if (image !== null) firstPhoto = false;
              return html`<div class="dish">
                <div>
                  <div class="dish-heading">
                    <div class="dish-name">
                      ${this.#entryName(member)} ${declarations(member, words)}
                    </div>
                    ${member.description ? html`<p class="description">${member.description}</p>` : nothing}
                    ${hasCautionedChoice(member, this.excluded) ? html`<p class="description" lang=${words.language}>${words.text.checkChoices}</p>` : nothing}
                    <p class="price">${dishPrice(member, menu.language)}</p>
                  </div>
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
    const photo = detail?.member.kind === "product" ? detail.member.image : null;
    const detailImage = photo && MEDIA_FILENAME.test(photo) ? photo : null;
    return html`<article lang=${menu.language} data-theme=${this.theme}>
      ${
        detail
          ? html`<div class="detail" data-detail>
              <div class="detail-lead">
                ${detailImage ? html`<img src=${liveMediaImage(detailImage, "display")} alt="" />` : nothing}
                <wt-button
                  class="back"
                  variant=${detailImage ? "secondary" : "ghost"}
                  icon="chevron-left"
                  lang=${words.language}
                  aria-label=${words.text.backToMenu!}
                  @click=${() => void this.#closeDetail(detail)}
                  >${words.text.menu}</wt-button
                >
              </div>
              <h2 tabindex="-1">${detail.member.name}</h2>
              ${detailContent(detail.member, words, menu.language, this.excluded, filtered)}
            </div>`
          : nothing
      }
      <div ?hidden=${detail !== undefined}>
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
            <wt-button
              class="filter-button"
              variant=${filtered ? "primary" : "secondary"}
              aria-haspopup="dialog"
              aria-expanded=${String(this.filtersOpen)}
              @click=${() => {
                this.filtersOpen = true;
              }}
              >${words.text.filters}</wt-button
            >
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
        <div role="status" lang=${words.language} class=${noResults ? "no-results" : nothing}>
          ${noResults ? emptyMessage : nothing}
        </div>
        ${members(visible, 3)} ${legend(words)} ${this.#filterDialog(words)}
      </div>
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-customer-menu-page": CustomerMenuPage;
  }
}
