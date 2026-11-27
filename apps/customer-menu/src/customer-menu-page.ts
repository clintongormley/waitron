import {
  ALLERGEN_CODES,
  DIETARY_LABELS,
  MEDIA_FILENAME,
  formatMoney,
  guestMenuWords,
  type CustomerMenuPhotoSize,
  type GuestChoice,
  type GuestDeclarations,
  type GuestMember,
  type PublicGuestMenu,
} from "@waitron/shared";
import { registerIcons } from "@waitron/ui/src/components/wt-icon.js";
import { NUTRITION_ICONS } from "@waitron/ui/src/nutrition-icons.js";
import { applyTokens } from "@waitron/ui/src/tokens/index.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import { LitElement, html, nothing, type TemplateResult } from "lit";
import type { DirectiveResult } from "lit/directive.js";
import { styleMap } from "lit/directives/style-map.js";
import { html as staticHtml, literal, type StaticValue } from "lit/static-html.js";
import type { PreparedMenuAppearance } from "./customer-menu-snapshot.js";
import { customerMenuPageStyles } from "./customer-menu-page-styles.js";
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

function subheading(tag: StaticValue, text: string, language?: string) {
  return staticHtml`<${tag} class="subheading" lang=${language ?? nothing}>${text}</${tag}>`;
}

function detailDeclarations(
  tag: StaticValue,
  heading: string,
  labels: { icon: string; label: string; category?: string }[],
  language: string,
) {
  return labels.length
    ? html`<div lang=${language}>
        ${subheading(tag, heading)}
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
  tag: StaticValue,
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
          html`${subheading(tag, courseLabel(line, language))}
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
      ${detailDeclarations(tag, words.text.allergens!, allergens, words.language)}`;
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
        ? html`${subheading(tag, words.text.variants!, words.language)}
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
          ? html`${subheading(tag, group.name)}
              <p class="description">${group.labels.join(" · ")}</p>`
          : nothing;
      }
      return group.items.length
        ? html`${subheading(tag, group.name)}
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
    ${detailDeclarations(tag, words.text.allergens!, [...allergens, ...extraAllergens], words.language)}
    ${detailDeclarations(tag, words.text.diet!, diets, words.language)}
    <p class="description" lang=${words.language}>${words.text.askAboutAllergens}</p>
  `;
}

function legend(tag: StaticValue, { language, text }: Words) {
  const key = (codes: readonly string[], prefix: string) =>
    html` <ul class="key">
      ${codes.map((code) => html`<li><wt-icon name=${`${prefix}-${code}`}></wt-icon>${text[code]}</li>`)}
    </ul>`;
  return html`<footer lang=${language}>
    ${subheading(tag, text.key!)} ${key(ALLERGEN_CODES, "allergen")} ${subheading(tag, text.diet!)}
    ${key(DIETARY_LABELS, "diet")}
  </footer>`;
}

@customElement("customer-menu-page")
export class CustomerMenuPage extends LitElement {
  static override styles = customerMenuPageStyles;

  @property({ attribute: false }) menu?: PublicGuestMenu;
  @property({ type: Boolean, reflect: true }) standalone = false;
  @property({ attribute: false }) photoSource?: (
    image: string,
  ) => string | DirectiveResult | undefined;
  @property({ reflect: true }) photos: CustomerMenuPhotoSize = "large";
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: false }) appearance?: PreparedMenuAppearance;

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
    const heading = this.renderRoot.querySelector<HTMLElement>(".detail .menu-title")!;
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

  #photo(reference: string | null) {
    if (this.photos !== "none" && reference && MEDIA_FILENAME.test(reference))
      return this.photoSource?.(reference);
    return undefined;
  }

  protected override render() {
    const menu = this.menu;
    if (!menu) return nothing;
    const detail = this.detail;
    const titleTag = this.standalone ? literal`h1` : literal`h2`;
    const subtitleTag = this.standalone ? literal`h2` : literal`h3`;
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
              const image = this.#photo(member.image);
              const eager = firstPhoto && image !== undefined;
              if (image !== undefined) firstPhoto = false;
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
                  image === undefined
                    ? nothing
                    : html`<img
                        src=${image}
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
    const detailImage = this.#photo(photo);
    return html`<article
      lang=${menu.language}
      data-theme=${this.appearance?.scheme ?? "light"}
      style=${styleMap(this.appearance?.tokens ?? {})}
    >
      ${
        detail
          ? html`<div class="detail" data-detail>
              <div class="detail-lead">
                ${detailImage ? html`<img src=${detailImage} alt="" />` : nothing}
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
              ${staticHtml`<${titleTag} class="menu-title" tabindex="-1">${detail.member.name}</${titleTag}>`}
              ${detailContent(subtitleTag, detail.member, words, menu.language, this.excluded, filtered)}
            </div>`
          : nothing
      }
      <div ?hidden=${detail !== undefined}>
        <header>
          <div class="title-row">
            ${staticHtml`<${titleTag} class="menu-title">${menu.name}</${titleTag}>`}
            <slot name="header-actions"></slot>
          </div>
          <search lang=${words.language}>
            <wt-input
              name="dish-search"
              type="search"
              variant="outlined"
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
        ${members(visible, this.standalone ? 2 : 3)} ${legend(subtitleTag, words)}
        ${this.#filterDialog(words)}
      </div>
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "customer-menu-page": CustomerMenuPage;
  }
}
