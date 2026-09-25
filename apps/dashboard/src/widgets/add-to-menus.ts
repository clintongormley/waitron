import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-modal.js";
import type {
  CatalogueSummary,
  LibrarySection,
  MenuStructure,
  MenuStructureNode,
} from "../api/client.js";
import { t } from "../i18n/t.js";

export interface PlacementSection {
  id: string;
  /** The section's internal name. */
  name: string;
  /** The other menus that reach this section, by name. */
  sharedWith: string[];
  children: PlacementSection[];
}

export interface PlacementMenu {
  id: string;
  name: string;
  rootSectionId: string;
  sections: PlacementSection[];
}

export interface PlacementFailure {
  sectionId: string;
  reason: string;
}

function reachedSections(nodes: readonly MenuStructureNode[], into: Set<string>): Set<string> {
  for (const node of nodes)
    if (node.ref.kind === "section") {
      into.add(node.ref.sectionId);
      reachedSections(node.children ?? [], into);
    }
  return into;
}

/** Each menu's sections as its structure nests them; `structures[i]` is `menus[i]`'s. */
export function placementMenus(
  menus: readonly CatalogueSummary[],
  structures: readonly MenuStructure[],
  sections: readonly LibrarySection[],
): PlacementMenu[] {
  const names = new Map(sections.map((section) => [section.id, section.internalName]));
  const reached = structures.map((structure) => reachedSections(structure.nodes, new Set()));
  const build = (nodes: readonly MenuStructureNode[], menuIndex: number): PlacementSection[] =>
    nodes.flatMap((node) => {
      if (node.ref.kind !== "section") return [];
      const id = node.ref.sectionId;
      return [
        {
          id,
          name: names.get(id) ?? t("editor.missing_choice"),
          sharedWith: menus.flatMap((menu, index) =>
            index !== menuIndex && reached[index]?.has(id) ? [menu.name] : [],
          ),
          children: build(node.children ?? [], menuIndex),
        },
      ];
    });
  return menus.flatMap((menu, index) => {
    const structure = structures[index];
    return structure
      ? [
          {
            id: menu.id,
            name: menu.name,
            rootSectionId: structure.rootSectionId,
            sections: build(structure.nodes, index),
          },
        ]
      : [];
  });
}

/**
 * The optional step after a product is created: which menu places to add it to. A section is one
 * list wherever it appears, so it is chosen by its id — ticking it under one menu ticks it under
 * every other — and is asked for once. The host performs the writes and reports refusals back
 * through `failures`.
 */
@customElement("dashboard-add-to-menus")
export class AddToMenus extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
      fieldset {
        min-width: 0;
        margin: 0 0 var(--wt-space-4);
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      legend {
        padding-inline: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      ul ul {
        padding-inline-start: var(--wt-space-5);
        border-inline-start: 1px solid var(--wt-color-border);
      }
      label.pick {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding-block: var(--wt-space-1);
        cursor: pointer;
      }
      input[type="checkbox"] {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      .name {
        overflow-wrap: anywhere;
      }
      .mark {
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .notice {
        color: var(--wt-color-text-muted);
      }
      .error {
        margin-block-end: var(--wt-space-3);
        color: var(--wt-color-danger);
      }
      .error ul {
        margin-block-start: var(--wt-space-2);
        padding-inline-start: var(--wt-space-5);
        list-style: disc;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  /** The product's staff name. */
  @property() productName = "";
  /** Null while the menus are loading. */
  @property({ attribute: false }) menus: PlacementMenu[] | null = null;
  @property({ attribute: false }) loadError: string | null = null;
  @property({ attribute: false }) failures: PlacementFailure[] = [];
  @state() private selected: ReadonlySet<string> = new Set();
  @state() private noneChosen = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) {
      this.selected = new Set();
      this.noneChosen = false;
    }
    if (changed.has("failures") && this.failures.length)
      this.selected = new Set(this.failures.map(({ sectionId }) => sectionId));
  }

  /** Every place in the order shown, each section once. */
  #places(): string[] {
    const ids = new Set<string>();
    const walk = (sections: readonly PlacementSection[]) => {
      for (const section of sections) {
        ids.add(section.id);
        walk(section.children);
      }
    };
    for (const menu of this.menus ?? []) {
      ids.add(menu.rootSectionId);
      walk(menu.sections);
    }
    return [...ids];
  }

  #placeName(sectionId: string): string {
    for (const menu of this.menus ?? []) {
      if (menu.rootSectionId === sectionId)
        return t("add_to_menus.place_top_level").replace("{menu}", menu.name);
      const found = this.#find(menu.sections, sectionId);
      if (found) return found.name;
    }
    return t("editor.missing_choice");
  }

  #find(sections: readonly PlacementSection[], id: string): PlacementSection | null {
    for (const section of sections) {
      if (section.id === id) return section;
      const found = this.#find(section.children, id);
      if (found) return found;
    }
    return null;
  }

  #toggle(event: Event, sectionId: string): void {
    event.stopPropagation();
    const selected = new Set(this.selected);
    if (!selected.delete(sectionId)) selected.add(sectionId);
    this.selected = selected;
    this.noneChosen = false;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const sectionIds = this.#places().filter((id) => this.selected.has(id));
    if (!sectionIds.length) {
      this.noneChosen = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { sectionIds }, bubbles: true, composed: true }),
    );
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  #pick(sectionId: string, name: string, sharedWith: readonly string[] = []) {
    return html`<label class="pick">
      <input
        type="checkbox"
        name="section"
        value=${sectionId}
        .checked=${this.selected.has(sectionId)}
        .disabled=${this.busy}
        @change=${(event: Event) => this.#toggle(event, sectionId)}
      />
      <span class="name">${name}</span>
      ${
        sharedWith.length
          ? html`<span class="mark" data-test="shared"
              >${t("add_to_menus.shared").replace("{menus}", sharedWith.join(", "))}</span
            >`
          : nothing
      }
    </label>`;
  }

  #tree(sections: readonly PlacementSection[]): TemplateResult {
    return html`<ul>
      ${sections.map(
        (section) =>
          html`<li>
            <div>${this.#pick(section.id, section.name, section.sharedWith)}</div>
            ${section.children.length ? this.#tree(section.children) : nothing}
          </li>`,
      )}
    </ul>`;
  }

  #failures() {
    if (!this.failures.length) return nothing;
    return html`<div class="error" role="alert" data-test="placement-error">
      <p>${t("add_to_menus.failed").replace("{name}", this.productName)}</p>
      <ul>
        ${this.failures.map(
          ({ sectionId, reason }) => html`<li>${this.#placeName(sectionId)}: ${reason}</li>`,
        )}
      </ul>
    </div>`;
  }

  #body() {
    if (this.loadError !== null)
      return html`<p class="error" role="alert" data-test="load-error">
        ${t("add_to_menus.load_error").replace("{name}", this.productName)} ${this.loadError}
      </p>`;
    if (this.menus === null)
      return html`<p class="notice" role="status" data-test="loading">
        ${t("add_to_menus.loading")}
      </p>`;
    const errors = this.noneChosen ? [t("add_to_menus.none_chosen")] : [];
    return html`<wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${errors}
      ></wt-form-error-summary>
      ${this.#failures()}
      <p>${t("add_to_menus.intro").replace("{name}", this.productName)}</p>
      ${
        this.menus.some((menu) => this.#hasShared(menu.sections))
          ? html`<p class="notice">${t("add_to_menus.shared_note")}</p>`
          : nothing
      }
      ${this.menus.map(
        (menu) =>
          html`<fieldset
            data-menu=${menu.id}
            aria-describedby=${this.noneChosen ? "none-chosen" : nothing}
          >
            <legend>${menu.name}</legend>
            ${this.#pick(menu.rootSectionId, t("add_to_menus.top_level"))}
            ${menu.sections.length ? this.#tree(menu.sections) : nothing}
          </fieldset>`,
      )}
      ${
        this.noneChosen
          ? html`<p class="error" id="none-chosen" data-test="none-chosen">
              ${t("add_to_menus.none_chosen")}
            </p>`
          : nothing
      }`;
  }

  #hasShared(sections: readonly PlacementSection[]): boolean {
    return sections.some(
      (section) => section.sharedWith.length > 0 || this.#hasShared(section.children),
    );
  }

  override render() {
    const choosing = this.menus !== null && this.loadError === null;
    const attempted = this.failures.length > 0 || this.loadError !== null;
    return html`<wt-modal
      .open=${this.open}
      heading=${t("add_to_menus.heading").replace("{name}", this.productName)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        if (event.target === event.currentTarget && this.open) this.#cancel(event);
      }}
    >
      ${this.open ? this.#body() : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="skip"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${attempted ? t("action.close") : t("add_to_menus.skip")}</wt-button
        >${
          choosing
            ? html`<wt-button
                data-test="add-to-menus"
                .loading=${this.busy}
                .disabled=${this.busy}
                @click=${(event: Event) => this.#confirm(event)}
                >${t("add_to_menus.confirm")}</wt-button
              >`
            : nothing
        }</wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-add-to-menus": AddToMenus;
  }
}
