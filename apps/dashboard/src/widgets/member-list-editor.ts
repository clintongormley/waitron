import { ReorderController, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import type { MenuStructureNode } from "../api/client.js";
import type { MemberRef, SectionMember, TileRef } from "@waitron/catalogue/src/section-types.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { byLabel } from "./category-form.js";
import { t } from "../i18n/t.js";

interface Choice {
  value: string;
  label: string;
}

/** A member's staff-facing name, or a placeholder when the product or section is not known here. */
export function memberName(
  ref: TileRef,
  productNames: ReadonlyMap<string, string>,
  sectionNames: ReadonlyMap<string, string>,
): string {
  if (ref.kind === "missing") return ref.name;
  const name =
    ref.kind === "product" ? productNames.get(ref.productId) : sectionNames.get(ref.sectionId);
  return name ?? t("members.missing");
}

export function memberKindLabel(ref: TileRef): string {
  if (ref.kind === "missing") return t("members.missing");
  return t(ref.kind === "product" ? "members.kind_product" : "members.kind_section");
}

export type SectionParents = ReadonlyMap<string, readonly string[]>;

export function sectionParents(
  sections: readonly { id: string; members: readonly SectionMember[] }[],
): SectionParents {
  const parents = new Map<string, string[]>();
  for (const section of sections)
    for (const { ref } of section.members)
      if (ref.kind === "section")
        parents.set(ref.sectionId, [...(parents.get(ref.sectionId) ?? []), section.id]);
  return parents;
}

export function sectionsHolding(parents: SectionParents, sectionId: string): string[] {
  const found = new Set([sectionId]);
  const pending = [sectionId];
  while (pending.length > 0)
    for (const parent of parents.get(pending.pop()!) ?? [])
      if (!found.has(parent)) {
        found.add(parent);
        pending.push(parent);
      }
  return [...found];
}

/**
 * One ordered list of products and sections. The host owns the list and every write: each action
 * leaves as an event, and a move is shown at once so a keyboard user's focus stays on the row.
 */
@customElement("dashboard-member-list-editor")
export class MemberListEditor extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      wt-row-actions a {
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        font: inherit;
        text-decoration: none;
        font-weight: var(--wt-font-weight-bold);
        width: 100%;
        border: 1px solid transparent;
        padding: var(--wt-space-2) var(--wt-space-4);
      }
      :host {
        display: block;
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      td.name {
        overflow-wrap: anywhere;
      }
      td.kind {
        color: var(--wt-color-text-muted);
      }
      .member-note {
        display: block;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
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
        align-items: flex-start;
        gap: var(--wt-space-2);
        max-width: var(--wt-field-max-width);
        margin-top: var(--wt-space-4);
      }
      .replacement .field,
      wt-form-actions {
        flex-basis: 100%;
      }
      .field {
        flex: 1;
        min-width: 0;
      }
    `,
  ];

  @property({ attribute: false }) members: SectionMember<TileRef>[] = [];
  @property({ attribute: false }) products: { id: string; name: string }[] = [];
  @property({ attribute: false }) nodes: MenuStructureNode[] = [];
  /** Sections the picker leaves out, such as ones that would contain this list. The server still
   * refuses a cycle; this only keeps the offer honest. */
  @property({ attribute: false }) excludeSectionIds: string[] = [];
  @property({ type: Boolean }) busy = false;
  /** The accessible name of the list, such as the section's own name. */
  @property() label = "";
  /** When set, a removal names the list it takes the member out of. */
  @property() listName = "";
  /** Whether a section member offers Open, which asks the host to edit that section. */
  @property({ type: Boolean }) openable = true;
  @property({ type: Boolean }) sectionChoices = false;
  /** A line of text shown under a member's name, by member id. */
  @property({ attribute: false }) notes: ReadonlyMap<string, string> = new Map();
  /** The members in display order, which a move rewrites before the host confirms it. */
  @state() private order: SectionMember<TileRef>[] = [];
  @property({ attribute: false }) replaceable: ReadonlySet<string> = new Set();
  @property() replacementScope = "";
  #replacementName = "";
  #replacementGeneration = 0;
  #focusReplacement = false;
  @state() private replacementAttempted = false;
  @state() private replacementError = "";
  @state() private replacementFieldError = "";
  @state() private addedMessage = "";
  #replacementDraft?: DraftScope<string>;
  #leave?: LeaveCoordinator;

  override disconnectedCallback(): void {
    this.#replacementDraft?.dispose();
    this.#replacementDraft = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #registerReplacement(): void {
    this.#replacementDraft?.dispose();
    this.#leave = leaveCoordinatorFor(this);
    this.#replacementDraft = this.#leave?.register<string>({
      id: this,
      current: () => this.choice,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.choice = value;
      },
    });
  }

  #clearReplacement(): void {
    this.#replacementDraft?.dispose();
    this.#replacementDraft = undefined;
    this.#replacementGeneration++;
    this.replacementAttempted = false;
    this.replacementError = "";
    this.replacementFieldError = "";
    this.replacing = null;
    this.choice = "";
    this.addError = false;
  }

  async #cancelReplacement(): Promise<void> {
    if (this.busy) return;
    const generation = this.#replacementGeneration;
    const proceed = () => {
      if (generation === this.#replacementGeneration && !this.busy) this.#clearReplacement();
    };
    if (this.#replacementDraft)
      await this.#leave!.request({ scopes: [this], reason: "cancel", proceed });
    else proceed();
  }

  replacementCompletion(memberId: string): (message: string, field?: boolean) => void {
    const generation = this.#replacementGeneration;
    const submitted = this.choice;
    return (message, field = false) => {
      if (generation !== this.#replacementGeneration || this.replacing !== memberId) return;
      if (message === "") {
        this.#replacementDraft?.commit(submitted);
        if (this.choice === submitted) this.#clearReplacement();
        this.addError = false;
        this.replacementAttempted = false;
        this.replacementError = "";
        this.replacementFieldError = "";
      } else {
        this.replacementError = field ? "" : message;
        this.replacementFieldError = field ? message : "";
        this.#focusReplacement = field;
      }
    };
  }
  @state() private replacing: string | null = null;
  @state() private choice = "";
  @state() private addError = false;
  #productNames = new Map<string, string>();
  #sectionNames = new Map<string, string>();
  #offer: { products: Choice[]; sections: Choice[] } = { products: [], sections: [] };

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.order.map((member) => member.id),
      move: (id, to, via) => this.#move(id, to, via),
      drop: (id) => this.#drop(id),
      label: (id) => this.#name(this.order.find((member) => member.id === id)!),
      busy: () => this.busy,
      get reorderLabel(): string {
        return t("members.reorder");
      },
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

  override willUpdate(changed: PropertyValues): void {
    if (
      this.replacing !== null &&
      (changed.has("members") || changed.has("replaceable") || changed.has("replacementScope"))
    ) {
      const target = this.members.find((member) => member.id === this.replacing);
      if (
        changed.has("replacementScope") ||
        !target ||
        !this.replaceable.has(target.id) ||
        target.ref.kind !== "missing" ||
        target.ref.name !== this.#replacementName
      ) {
        this.#replacementDraft?.dispose();
        this.#replacementDraft = undefined;
        this.replacing = null;
        this.#replacementGeneration++;
        this.replacementAttempted = false;
        this.replacementError = "";
        this.replacementFieldError = "";
        this.choice = "";
        this.addError = false;
      }
    }
    if (changed.has("members"))
      this.order = [...this.members].sort((a, b) => a.position - b.position);
    if (changed.has("products"))
      this.#productNames = new Map(this.products.map((product) => [product.id, product.name]));
    if (changed.has("nodes"))
      this.#sectionNames = new Map(
        this.nodes.flatMap((node) =>
          node.ref.kind === "section"
            ? [[node.ref.sectionId, node.internalName ?? t("members.missing")] as [string, string]]
            : [],
        ),
      );
    if (
      changed.has("order") ||
      changed.has("products") ||
      changed.has("nodes") ||
      changed.has("excludeSectionIds") ||
      changed.has("sectionChoices")
    ) {
      this.#offer = this.#choices();
      // A choice the list now holds, or that is now excluded, is no longer on offer.
      const offered = [...this.#offer.products, ...this.#offer.sections];
      if (this.choice && !offered.some((choice) => choice.value === this.choice)) {
        this.choice = "";
        this.#replacementDraft?.changed();
      }
      if (this.replacing !== null && this.replacementAttempted) this.addError = this.choice === "";
    }
  }

  override updated(): void {
    if (this.#focusReplacement && !this.busy) {
      this.#focusReplacement = false;
      if (this.replacing !== null && this.replacementFieldError) {
        const picker = this.shadowRoot!.querySelector<HTMLElement & LitElement>(
          'wt-combobox[name="member-ref"]',
        )!;
        // The dropdown takes this render's `disabled` in its own update, which has not run yet.
        void picker.updateComplete.then(() => picker.focus());
      }
    }
  }

  #name(member: SectionMember<TileRef>): string {
    const name = memberName(member.ref, this.#productNames, this.#sectionNames);
    return this.nodes.find((node) => node.memberId === member.id)?.includedMenuId
      ? t("menus.menu_prefix").replace("{name}", name)
      : name;
  }

  #choices(): { products: Choice[]; sections: Choice[] } {
    const held = new Set(
      this.order.flatMap(({ ref }) =>
        ref.kind === "missing"
          ? []
          : [ref.kind === "product" ? `product:${ref.productId}` : `section:${ref.sectionId}`],
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
      sections: this.sectionChoices
        ? offer([...this.#sectionNames].map(([id, label]) => ({ value: `section:${id}`, label })))
        : [],
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
    if (this.replacing !== null) {
      this.replacementAttempted = true;
      this.replacementError = "";
      this.replacementFieldError = "";
    }
    const at = this.choice.indexOf(":");
    if (at < 0) {
      this.addError = true;
      if (this.replacing !== null)
        this.shadowRoot!.querySelector<HTMLElement>('wt-combobox[name="member-ref"]')!.focus();
      return;
    }
    const id = this.choice.slice(at + 1);
    const ref: MemberRef = this.choice.startsWith("product:")
      ? { kind: "product", productId: id }
      : { kind: "section", sectionId: id };
    const memberId = this.replacing;
    if (memberId === null) this.choice = "";
    this.#emit(
      memberId === null ? "wt-member-add" : "wt-member-replace",
      memberId === null ? { ref } : { memberId, ref },
    );
  }

  #action(
    member: SectionMember<TileRef>,
    name: "open" | "remove" | "edit" | "delete",
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
        if (!this.busy) {
          if (name === "remove" || name === "delete") this.addedMessage = "";
          this.#emit(`wt-member-${name}`, detail);
        }
      }}
      >${text}</wt-button
    >`;
  }

  #row(member: SectionMember<TileRef>) {
    const name = this.#name(member);
    const { ref } = member;
    const included = this.nodes.find((node) => node.memberId === member.id)?.includedMenuId;
    return html`<tr data-member=${member.id}>
      <td class="handle-cell">${this.#reorder.handle(member.id)}</td>
      <td class="name" data-test="name">
        ${name}${
          this.notes.has(member.id)
            ? html`<span class="member-note" data-test="note">${this.notes.get(member.id)}</span>`
            : nothing
        }
      </td>
      <td class="kind" data-test="kind">${memberKindLabel(ref)}</td>
      <td class="actions-cell">
        <wt-row-actions
          align="end"
          data-test=${`actions-${member.id}`}
          label=${`${t("members.actions")}: ${name}`}
          >${
            ref.kind === "section" && this.openable && !included
              ? this.#action(member, "open", t("members.open"), { sectionId: ref.sectionId })
              : nothing
          }${ref.kind === "section" && this.openable && !included ? html`${this.#action(member, "edit", t("action.edit"), { sectionId: ref.sectionId })}${this.#action(member, "delete", t("action.delete"), { sectionId: ref.sectionId })}` : nothing}${included ? html`<a href=${`/manage/menus/menu/${included}/view/structure`}>${t("menus.edit_included").replace("{name}", this.#sectionNames.get(ref.kind === "section" ? ref.sectionId : "") ?? "")}</a>` : nothing}${
            ref.kind !== "section" || included || !this.openable
              ? this.#action(
                  member,
                  "remove",
                  included
                    ? t("menus.remove_included")
                    : this.listName
                      ? t("members.remove_from").replace("{list}", this.listName)
                      : t("members.remove"),
                  { memberId: member.id },
                )
              : nothing
          }${
            this.replaceable.has(member.id)
              ? html`<wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`replace-${member.id}`}
                  .disabled=${this.busy}
                  @click=${async (event: Event) => {
                    event.stopPropagation();
                    if (this.busy) return;
                    (event.currentTarget as HTMLElement).closest("wt-row-actions")?.hide();
                    this.#replacementGeneration++;
                    this.replacementAttempted = false;
                    this.replacementError = "";
                    this.replacementFieldError = "";
                    this.replacing = member.id;
                    this.#replacementName = member.ref.kind === "missing" ? member.ref.name : "";
                    this.choice = "";
                    this.addError = false;
                    this.#registerReplacement();
                    await this.updateComplete;
                    this.shadowRoot!.querySelector<HTMLElement>(
                      'wt-combobox[name="member-ref"]',
                    )!.focus();
                  }}
                  >${t("action.replace")}</wt-button
                >`
              : nothing
          }</wt-row-actions
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

  #options(prompt: string) {
    const grouped = (group: string, choices: Choice[]) =>
      choices.map((choice) => ({ ...choice, group }));
    return [
      ...(this.replacing === null ? [{ value: "", label: prompt }] : []),
      ...grouped(t("members.products"), this.#offer.products),
      ...(this.sectionChoices ? grouped(t("members.sections"), this.#offer.sections) : []),
    ];
  }

  #error(): string {
    if (this.replacing !== null)
      return this.addError ? t("members.tile_choose_first") : this.replacementFieldError;
    if (!this.addError) return "";
    return t(this.sectionChoices ? "members.tile_choose_first" : "members.choose_first");
  }

  override render() {
    const prompt = t(this.sectionChoices ? "members.tile_placeholder" : "members.add_placeholder");
    return html`${this.#reorder.liveRegion()}
      <div data-test="added-status" role="status" aria-live="polite" class="visually-hidden">
        ${this.addedMessage}
      </div>
      ${this.#list()}
      <div class=${this.replacing === null ? "add" : "add replacement"}>
        <wt-combobox
          class="field"
          name="member-ref"
          label=${this.replacing === null ? t("members.add_label") : t("action.replace")}
          ?required=${this.replacing !== null}
          search="auto"
          placeholder=${prompt}
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#options(prompt)}
          .value=${this.choice}
          error=${this.#error()}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (this.busy) return;
            this.choice = event.detail.value;
            this.#replacementDraft?.changed();
            if (this.replacing === null && this.choice) {
              const label = [...this.#offer.products, ...this.#offer.sections].find(
                (option) => option.value === this.choice,
              )?.label;
              this.#add(event);
              if (label) this.addedMessage = t("members.added").replace("{name}", label);
              (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = "";
            }
            this.addError =
              this.replacing !== null && this.replacementAttempted && this.choice === "";
            this.replacementFieldError = "";
          }}
        ></wt-combobox>
        ${
          this.replacing === null
            ? nothing
            : html`<wt-form-actions
                .error=${[this.replacementError, this.addError || this.replacementFieldError ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
              >
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="replace-cancel"
                  .disabled=${this.busy}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    void this.#cancelReplacement();
                  }}
                  >${t("action.cancel")}</wt-button
                >
                <wt-button
                  data-test="add"
                  .disabled=${this.busy || this.addError}
                  @click=${(event: Event) => this.#add(event)}
                  >${t("action.replace")}</wt-button
                >
              </wt-form-actions>`
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-member-list-editor": MemberListEditor;
  }
}
