import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, disabledStyles, selectStyles } from "@waitron/ui";
import type { MemberRef, SectionMember } from "@waitron/catalogue/src/section-types.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { byLabel } from "./category-form.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { t } from "../i18n/t.js";

interface Choice {
  value: string;
  label: string;
}

/**
 * One ordered list of products and sections. The host owns the list and every write: each action
 * leaves as an event, and a move is shown at once so a keyboard user's focus stays on the row.
 */
@customElement("dashboard-member-list-editor")
export class MemberListEditor extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: block;
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      td {
        vertical-align: middle;
      }
      td.name {
        overflow-wrap: anywhere;
      }
      td.kind {
        color: var(--wt-color-text-muted);
      }
      td.actions-cell {
        padding-inline: 0;
      }
      .notice {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .add {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-4);
      }
      .field {
        display: grid;
        flex: 1;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      /* Matches wt-input's own label, so a select beside one reads as the same kind of field. */
      .field-label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      select {
        min-height: var(--wt-tap-min);
      }
      select:disabled {
        ${disabledStyles}
      }
      select[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) members: SectionMember[] = [];
  @property({ attribute: false }) products: { id: string; name: string }[] = [];
  @property({ attribute: false }) sections: { id: string; internalName: string }[] = [];
  /** Sections the picker leaves out, such as ones that would contain this list. The server still
   * refuses a cycle; this only keeps the offer honest. */
  @property({ attribute: false }) excludeSectionIds: string[] = [];
  @property({ type: Boolean }) busy = false;
  /** The accessible name of the list, such as the section's own name. */
  @property() label = "";
  /** The members in display order, which a move rewrites before the host confirms it. */
  @state() private order: SectionMember[] = [];
  @state() private choice = "";
  @state() private addError = false;
  #productNames = new Map<string, string>();
  #sectionNames = new Map<string, string>();
  #offer: { products: Choice[]; sections: Choice[] } = { products: [], sections: [] };

  readonly #reorder = new ReorderController(this, {
    order: () => this.order.map((member) => member.id),
    move: (id, to, via) => this.#move(id, to, via),
    drop: (id) => this.#drop(id),
    label: (id) => this.#name(this.order.find((member) => member.id === id)!),
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("members.reorder");
    },
  } satisfies ReorderModel);

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("members"))
      this.order = [...this.members].sort((a, b) => a.position - b.position);
    if (changed.has("products"))
      this.#productNames = new Map(this.products.map((product) => [product.id, product.name]));
    if (changed.has("sections"))
      this.#sectionNames = new Map(
        this.sections.map((section) => [section.id, section.internalName]),
      );
    if (
      changed.has("order") ||
      changed.has("products") ||
      changed.has("sections") ||
      changed.has("excludeSectionIds")
    ) {
      this.#offer = this.#choices();
      // A choice the list now holds, or that is now excluded, is no longer on offer.
      const offered = [...this.#offer.products, ...this.#offer.sections];
      if (!offered.some((choice) => choice.value === this.choice)) this.choice = "";
    }
  }

  #name(member: SectionMember): string {
    const { ref } = member;
    const name =
      ref.kind === "product"
        ? this.#productNames.get(ref.productId)
        : this.#sectionNames.get(ref.sectionId);
    return name ?? t("members.missing");
  }

  #choices(): { products: Choice[]; sections: Choice[] } {
    const held = new Set(
      this.order.map(({ ref }) =>
        ref.kind === "product" ? `product:${ref.productId}` : `section:${ref.sectionId}`,
      ),
    );
    const excluded = new Set(this.excludeSectionIds.map((id) => `section:${id}`));
    const offer = (choices: Choice[]) =>
      choices
        .filter((choice) => !held.has(choice.value) && !excluded.has(choice.value))
        .sort((a, b) => byLabel(a.label, b.label));
    return {
      products: offer(
        this.products.map((product) => ({ value: `product:${product.id}`, label: product.name })),
      ),
      sections: offer(
        this.sections.map((section) => ({
          value: `section:${section.id}`,
          label: section.internalName,
        })),
      ),
    };
  }

  #emit(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Where the row being dragged started, so its drop reports one move rather than one per row
   * crossed. */
  #dragFrom: number | null = null;

  #move(memberId: string, to: number, via: "key" | "pointer"): void {
    const from = this.order.findIndex((member) => member.id === memberId);
    const next = reorder(this.order, from, to);
    // `reorder` leaves the list alone for an unknown member or an out-of-range `to`, which the
    // pointer path can produce mid-gesture; neither is a move to report.
    if (next[to]?.id !== memberId) return;
    this.order = next;
    if (via === "key") this.#emit("wt-member-move", { memberId, to });
    else this.#dragFrom ??= from;
  }

  #drop(memberId: string): void {
    const from = this.#dragFrom;
    this.#dragFrom = null;
    const to = this.order.findIndex((member) => member.id === memberId);
    if (from !== null && to >= 0 && to !== from) this.#emit("wt-member-move", { memberId, to });
  }

  #add(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const at = this.choice.indexOf(":");
    if (at < 0) {
      this.addError = true;
      return;
    }
    const id = this.choice.slice(at + 1);
    const ref: MemberRef = this.choice.startsWith("product:")
      ? { kind: "product", productId: id }
      : { kind: "section", sectionId: id };
    this.choice = "";
    this.#emit("wt-member-add", { ref });
  }

  #action(
    member: SectionMember,
    name: "open" | "remove",
    text: string,
    detail: Record<string, unknown>,
  ) {
    return html`<wt-button
      align="start"
      variant="ghost"
      data-test=${`${name}-${member.id}`}
      .disabled=${this.busy}
      @click=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.#emit(`wt-member-${name}`, detail);
      }}
      >${text}</wt-button
    >`;
  }

  #row(member: SectionMember) {
    const name = this.#name(member);
    const { ref } = member;
    return html`<tr data-member=${member.id}>
      <td class="handle-cell">${this.#reorder.handle(member.id)}</td>
      <td class="name" data-test="name">${name}</td>
      <td class="kind" data-test="kind">
        ${t(ref.kind === "product" ? "members.kind_product" : "members.kind_section")}
      </td>
      <td class="actions-cell">
        <wt-row-actions
          align="end"
          data-test=${`actions-${member.id}`}
          label=${`${t("members.actions")}: ${name}`}
          >${
            ref.kind === "section"
              ? this.#action(member, "open", t("members.open"), { sectionId: ref.sectionId })
              : nothing
          }${this.#action(member, "remove", t("members.remove"), { memberId: member.id })}</wt-row-actions
        >
      </td>
    </tr>`;
  }

  #list() {
    if (this.order.length === 0)
      return html`<p class="notice" data-test="empty">${t("members.empty")}</p>`;
    return html`<div class="table-wrap" tabindex="0" role="region" aria-label=${this.label}>
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">${t("members.reorder")}</span></th>
            <th scope="col">${t("members.name")}</th>
            <th scope="col">${t("members.kind")}</th>
            <th scope="col"><span class="visually-hidden">${t("members.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            this.order,
            (member) => member.id,
            (member) => this.#row(member),
          )}
        </tbody>
      </table>
    </div>`;
  }

  #group(label: string, choices: Choice[]) {
    if (choices.length === 0) return nothing;
    return html`<optgroup label=${label}>
      ${choices.map(
        (choice) =>
          html`<option value=${choice.value} .selected=${choice.value === this.choice}>
            ${choice.label}
          </option>`,
      )}
    </optgroup>`;
  }

  override render() {
    return html`${this.#reorder.liveRegion()} ${this.#list()}
      <div class="add">
        <label class="field">
          <span class="field-label">${t("members.add_label")}</span>
          <select
            name="member-ref"
            .disabled=${this.busy}
            aria-invalid=${this.addError ? "true" : "false"}
            aria-describedby=${this.addError ? "member-add-error" : nothing}
            @change=${(event: Event) => {
              event.stopPropagation();
              this.choice = (event.target as HTMLSelectElement).value;
              this.addError = false;
            }}
          >
            <option value="" .selected=${this.choice === ""}>
              ${t("members.add_placeholder")}
            </option>
            ${this.#group(t("members.products"), this.#offer.products)}
            ${this.#group(t("members.sections"), this.#offer.sections)}
          </select>
        </label>
        <wt-button
          data-test="add"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#add(event)}
          >${t("action.add")}</wt-button
        >
      </div>
      ${
        this.addError
          ? html`<p class="error" id="member-add-error" data-test="add-error">
              ${t("members.choose_first")}
            </p>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-member-list-editor": MemberListEditor;
  }
}
