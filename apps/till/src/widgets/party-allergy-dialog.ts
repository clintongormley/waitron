import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import type {
  AllergyDish,
  AllergyGuestInput,
  AllergyLineRef,
  AllergyMoveRead,
  AllergyPatch,
  PartyAllergyRead,
} from "@waitron/module";
import { ALLERGEN_CODES, allergenKinds, type Kind } from "@waitron/catalogue/src/allergens.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { allergenLabel, allergenName } from "../i18n/allergen-names.js";
import { currentLocale, t } from "../i18n/t.js";
import { allergyClashes } from "../state/party-allergy.js";
import { nutritionIcons, nutritionIconStyles } from "./nutrition-icons.js";
import { trackDialog } from "./track-dialog.js";

export interface AllergyConfirmDetail {
  scopeKey: string;
  expectedPartyRevision: number | null;
  patch: AllergyPatch;
}
export interface AllergyFieldRefusal {
  guestIndex: number;
  field: "who" | "allergens" | "note";
  message: string;
}
interface Draft {
  answer: "none" | "allergies" | null;
  guests: AllergyGuestInput[];
  ticks: Record<string, number | null>;
}
const lineKey = (line: AllergyLineRef): string =>
  line.kind === "submitted"
    ? `submitted:${line.groupIndex}:${line.lineIndex}`
    : `${line.kind}:${line.id}`;
const printable = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- kitchen fields use the seat's printable spelling
  value.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();
function normalized(draft: Draft): Draft {
  return {
    answer: draft.answer,
    guests: draft.guests.map((g) => ({
      ...(g.id === undefined ? {} : { id: g.id }),
      who: printable(g.who),
      allergens: Object.fromEntries(
        Object.entries(g.allergens)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, v]) => [code, v.kinds ? { kinds: [...v.kinds].sort() } : {}]),
      ),
      note: printable(g.note ?? "") || null,
    })),
    ticks: Object.fromEntries(Object.entries(draft.ticks).sort(([a], [b]) => a.localeCompare(b))),
  };
}
const equal = (a: Draft, b: Draft): boolean =>
  JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const clone = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft)) as Draft;

@customElement("till-party-allergy-dialog")
export class TillPartyAllergyDialog extends LitElement {
  static override styles = [
    baseStyles,
    nutritionIconStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .content {
        display: grid;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      .guest,
      .dish {
        display: grid;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .codes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--wt-space-2);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
        flex-shrink: 0;
      }
      fieldset {
        margin: 0;
        padding: var(--wt-space-2);
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        min-width: 0;
      }
      legend {
        font-weight: var(--wt-font-weight-bold);
      }
      .kinds {
        padding-inline-start: var(--wt-space-3);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .error,
      [data-clash] {
        color: var(--wt-color-danger);
      }
      .clash {
        border-color: var(--wt-color-danger);
      }
      [data-extra] {
        padding-inline-start: var(--wt-space-3);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .guest h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      p {
        margin: 0;
      }
    `,
  ];
  @property({ attribute: false }) view!: PartyAllergyRead | AllergyMoveRead;
  @property() mode: "send" | "edit" = "send";
  @property() scopeKey = "";
  @property({ attribute: false }) draftParent?: object;
  @property({ type: Boolean }) busy = false;
  @property() refusal = "";
  @property({ attribute: false }) fieldRefusal: AllergyFieldRefusal | null = null;
  @state() private draft: Draft = { answer: null, guests: [], ticks: {} };
  @state() private page: "question" | "guests" | "ticks" | "editor" = "question";
  @state() private active = true;
  @state() private attempted = false;
  @state() private editingGuest: number | null = null;
  @state() private confirmation: { kind: "delete"; index: number } | { kind: "none" } | null = null;
  #opening?: { key: string; partyId: string | null; revision: number | null };
  #baseline!: Draft;
  #submitted?: Draft;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || this.confirmation) return false;
    if (!this.#leave) return true;
    const key = this.#opening?.key;
    return (
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded" &&
      this.active &&
      this.isConnected &&
      key === this.#opening?.key
    );
  };
  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.view) return;
    if (
      !this.#opening ||
      this.#opening.key !== this.scopeKey ||
      this.#opening.partyId !== this.view.partyId
    )
      this.#open();
    else if (changed.has("view") && !this.#scope?.isDirty() && !this.busy && !this.#submitted)
      this.#load();
  }
  #load(): void {
    const snapshot = this.view.snapshot;
    this.draft = {
      answer: snapshot?.answer ?? null,
      guests:
        snapshot?.guests.map(({ id, who, allergens, note }) => ({
          id,
          who,
          allergens: JSON.parse(JSON.stringify(allergens)),
          note,
        })) ?? [],
      ticks: {},
    };
    for (const tick of snapshot?.ticks ?? []) {
      const index = snapshot!.guests.findIndex((g) => g.id === tick.guestId);
      this.draft.ticks[
        `${tick.draftLineId === null ? "working" : "draft"}:${tick.draftLineId ?? tick.workingLineId}`
      ] = index;
    }
    this.#opening!.revision = snapshot?.revision ?? null;
    this.#baseline = clone(this.draft);
    this.#scope?.commit(this.#baseline);
    this.page =
      this.mode === "edit" ? "editor" : this.draft.answer === "allergies" ? "ticks" : "question";
  }
  #open(): void {
    this.#scope?.dispose();
    this.#opening = { key: this.scopeKey, partyId: this.view.partyId, revision: null };
    this.#submitted = undefined;
    this.active = true;
    this.attempted = false;
    this.confirmation = null;
    this.editingGuest = null;
    this.#load();
    const { scope, coordinator } = draftScopeFor<Draft>(this, {
      id: this,
      parent: this.draftParent,
      current: () => this.draft,
      snapshot: clone,
      equal,
      restore: (value) => {
        this.draft = value;
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.#baseline);
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#submitted = undefined;
    this.#opening = undefined;
    this.active = false;
    this.draft = { answer: null, guests: [], ticks: {} };
    super.disconnectedCallback();
  }
  override async firstUpdated(): Promise<void> {
    const dialog = this.shadowRoot!.querySelector<WtDialog>("wt-dialog");
    await dialog?.updateComplete;
    await this.#focusPage();
  }
  override updated(changed: PropertyValues): void {
    if (changed.has("page") || changed.has("editingGuest")) void this.#focusPage();
  }
  async #focusPage(): Promise<void> {
    const key = this.#opening?.key;
    const page = this.page;
    const index = this.editingGuest;
    const target = this.shadowRoot!.querySelector<HTMLElement>(
      page === "ticks"
        ? "[data-tick], [data-primary]"
        : page === "question"
          ? "[data-none]"
          : index !== null
            ? `[data-guest="${index}"] wt-input`
            : "wt-input, [data-edit], [data-none]",
    );
    if (target && "updateComplete" in target) await target.updateComplete;
    if (
      this.isConnected &&
      this.active &&
      key === this.#opening?.key &&
      page === this.page &&
      index === this.editingGuest &&
      target?.isConnected
    )
      target.focus();
  }
  commitConfirmed(scopeKey: string): void {
    if (!this.isConnected || !this.active || scopeKey !== this.#opening?.key || !this.#submitted)
      return;
    this.#baseline = clone(this.#submitted);
    this.#scope?.commit(this.#submitted);
    this.#submitted = undefined;
  }
  #change(change: (draft: Draft) => void): void {
    if (!this.isConnected || !this.active || this.busy || this.confirmation) return;
    const next = clone(this.draft);
    change(next);
    this.draft = next;
    this.#scope?.changed();
  }
  #field(index: number, field: AllergyFieldRefusal["field"], value: string): void {
    this.#change((d) => {
      if (field === "who") d.guests[index]!.who = value;
      else if (field === "note") d.guests[index]!.note = value;
    });
    if (this.fieldRefusal?.guestIndex === index && this.fieldRefusal.field === field)
      this.fieldRefusal = null;
  }
  #toggleCode(index: number, code: string, checked: boolean): void {
    this.#change((d) => {
      if (checked)
        d.guests[index]!.allergens[code] = allergenKinds(code).length ? { kinds: [] } : {};
      else delete d.guests[index]!.allergens[code];
    });
    if (this.fieldRefusal?.guestIndex === index && this.fieldRefusal.field === "allergens")
      this.fieldRefusal = null;
  }
  #toggleKind(index: number, code: string, kind: Kind, checked: boolean): void {
    this.#change((d) => {
      const kinds = d.guests[index]!.allergens[code]!.kinds!;
      d.guests[index]!.allergens[code] = {
        kinds: checked ? [...kinds, kind] : kinds.filter((k) => k !== kind),
      };
    });
    if (this.fieldRefusal?.guestIndex === index && this.fieldRefusal.field === "allergens")
      this.fieldRefusal = null;
  }
  #errors(index: number): Record<AllergyFieldRefusal["field"], string> {
    const guest = this.draft.guests[index]!;
    const who = printable(guest.who);
    const allergens = guest.allergens;
    const invalidKinds = Object.entries(allergens).some(
      ([code, v]) => allergenKinds(code).length > 0 && !v.kinds?.length,
    );
    return {
      who: !who || who.length > 40 ? t("allergy.who_invalid") : "",
      allergens: !Object.keys(allergens).length || invalidKinds ? t("allergy.avoid_invalid") : "",
      note: printable(guest.note ?? "").length > 2000 ? t("allergy.note_invalid") : "",
    };
  }
  #invalid(): boolean {
    return this.draft.guests.some((_, i) => Object.values(this.#errors(i)).some(Boolean));
  }
  #error(index: number, field: AllergyFieldRefusal["field"]): string {
    return (
      (this.attempted ? this.#errors(index)[field] : "") ||
      (this.fieldRefusal?.guestIndex === index && this.fieldRefusal.field === field
        ? this.fieldRefusal.message
        : "")
    );
  }
  #add(): void {
    this.#change((d) => {
      d.answer = "allergies";
      d.guests.push({ who: "", allergens: {}, note: null });
    });
    this.editingGuest = this.draft.guests.length - 1;
  }
  #none(): void {
    if (this.busy || this.confirmation) return;
    if (Object.values(this.draft.ticks).some((v) => v !== null)) {
      this.confirmation = { kind: "none" };
      return;
    }
    this.#setNone();
  }
  #setNone(): void {
    this.#change((d) => {
      d.answer = "none";
      d.guests = [];
      for (const k of Object.keys(d.ticks)) d.ticks[k] = null;
    });
    if (this.mode === "send") void this.#submit();
  }
  #delete(index: number): void {
    if (this.busy || this.confirmation) return;
    if (Object.values(this.draft.ticks).includes(index))
      this.confirmation = { kind: "delete", index };
    else this.#remove(index);
  }
  #remove(index: number): void {
    this.#change((d) => {
      d.guests.splice(index, 1);
      for (const [k, v] of Object.entries(d.ticks))
        d.ticks[k] = v === index ? null : v !== null && v > index ? v - 1 : v;
    });
    this.editingGuest = null;
    this.fieldRefusal = null;
  }
  #confirm(): void {
    if (this.busy) return;
    const action = this.confirmation;
    this.confirmation = null;
    if (action?.kind === "delete") this.#remove(action.index);
    else if (action) this.#setNone();
  }
  #dishes(): AllergyDish[] {
    return this.view.dishes.filter((d) => this.mode === "edit" || !d.offeredBefore);
  }
  #patch(): AllergyPatch {
    const draft = normalized(this.draft);
    const baseline = normalized(this.#baseline);
    const partyChanged =
      draft.answer !== baseline.answer ||
      JSON.stringify(draft.guests) !== JSON.stringify(baseline.guests);
    return {
      ...(partyChanged && draft.answer !== null
        ? { party: { answer: draft.answer, guests: draft.guests } }
        : {}),
      ticks: this.#dishes()
        .filter(
          (d) =>
            (draft.ticks[lineKey(d.line)] ?? null) !== (baseline.ticks[lineKey(d.line)] ?? null),
        )
        .map((d) => ({ line: d.line, guestIndex: draft.ticks[lineKey(d.line)] ?? null })),
    };
  }
  async #submit(): Promise<void> {
    if (
      !this.active ||
      !this.isConnected ||
      this.busy ||
      this.confirmation ||
      this.draft.answer === null ||
      (this.mode === "edit" && saveActionState(this.#scope).unchanged)
    )
      return;
    this.attempted = true;
    this.refusal = "";
    this.fieldRefusal = null;
    if (this.#invalid()) {
      this.editingGuest = this.draft.guests.findIndex((_, i) =>
        Object.values(this.#errors(i)).some(Boolean),
      );
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (this.page === "guests" && this.mode === "send") {
      this.page = "ticks";
      this.attempted = false;
      return;
    }
    this.#submitted = clone(this.draft);
    this.dispatchEvent(
      new CustomEvent<AllergyConfirmDetail>("allergy-confirm", {
        detail: {
          scopeKey: this.#opening!.key,
          expectedPartyRevision: this.#opening!.revision,
          patch: this.#patch(),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.active || !this.isConnected) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#submitted = undefined;
    this.dispatchEvent(
      new CustomEvent("allergy-cancel", {
        detail: { scopeKey: this.#opening?.key },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #guest(guest: AllergyGuestInput, index: number) {
    const editing = this.page === "guests" || this.editingGuest === index;
    const errors = {
      who: this.#error(index, "who"),
      allergens: this.#error(index, "allergens"),
      note: this.#error(index, "note"),
    };
    return html`<section class="guest" data-guest=${index}>
      <h3>${guest.who || t("allergy.who")}</h3>
      ${
        editing
          ? html`
              <wt-input
                name=${`guest-${index}-who`}
                autocomplete="off"
                required
                .label=${t("allergy.who")}
                .value=${live(guest.who)}
                .error=${errors.who}
                ?disabled=${this.busy || this.confirmation !== null}
                @wt-change=${(e: CustomEvent<{ value: string }>) => {
                  e.stopPropagation();
                  this.#field(index, "who", e.detail.value);
                }}
              ></wt-input>
              <fieldset
                tabindex="-1"
                ?disabled=${this.busy || this.confirmation !== null}
                aria-invalid=${errors.allergens ? "true" : "false"}
                aria-describedby=${errors.allergens ? `guest-${index}-error` : nothing}
              >
                <legend>${t("allergy.avoid")} *</legend>
                <div class="codes">
                  ${ALLERGEN_CODES.map(
                    (code) =>
                      html`<div>
                        <label
                          ><input
                            type="checkbox"
                            name=${`guest-${index}-allergen-${code}`}
                            data-code=${code}
                            .checked=${live(Object.hasOwn(guest.allergens, code))}
                            @change=${(e: Event) => {
                              e.stopPropagation();
                              this.#toggleCode(index, code, (e.target as HTMLInputElement).checked);
                            }}
                          />${allergenName(code, currentLocale())}</label
                        >
                        ${
                          guest.allergens[code] && allergenKinds(code).length
                            ? html`<div class="kinds">
                                ${allergenKinds(code).map(
                                  (kind) =>
                                    html`<label
                                      ><input
                                        type="checkbox"
                                        name=${`guest-${index}-${code}-${kind}`}
                                        data-kind=${kind}
                                        .checked=${live(guest.allergens[code]!.kinds?.includes(kind as Kind) ?? false)}
                                        @change=${(e: Event) => {
                                          e.stopPropagation();
                                          this.#toggleKind(
                                            index,
                                            code,
                                            kind as Kind,
                                            (e.target as HTMLInputElement).checked,
                                          );
                                        }}
                                      />${allergenLabel(code, { kinds: [kind] }, currentLocale())}</label
                                    >`,
                                )}
                              </div>`
                            : nothing
                        }
                      </div>`,
                  )}
                </div>
                ${errors.allergens ? html`<p class="error" id=${`guest-${index}-error`}>${errors.allergens}</p>` : nothing}
              </fieldset>
              <wt-textarea
                name=${`guest-${index}-note`}
                autocomplete="off"
                .label=${t("allergy.note")}
                .value=${live(guest.note ?? "")}
                .error=${errors.note}
                ?disabled=${this.busy || this.confirmation !== null}
                @wt-change=${(e: CustomEvent<{ value: string }>) => {
                  e.stopPropagation();
                  this.#field(index, "note", e.detail.value);
                }}
              ></wt-textarea>
            `
          : html`<p>
                ${Object.entries(guest.allergens)
                  .map(([code, v]) => allergenLabel(code, v, currentLocale()))
                  .join(", ")}
              </p>
              ${guest.note ? html`<p>${guest.note}</p>` : nothing}`
      }
      <div class="actions">
        ${
          this.mode === "edit"
            ? html`<wt-button
                data-edit=${index}
                variant="secondary"
                ?disabled=${this.busy || this.confirmation !== null}
                @click=${() => {
                  this.editingGuest = index;
                }}
                >${t("allergy.edit")}</wt-button
              >`
            : nothing
        }<wt-button
          data-delete=${index}
          variant="danger"
          ?disabled=${this.busy || this.confirmation !== null}
          @click=${() => this.#delete(index)}
          >${t("allergy.delete")}</wt-button
        >
      </div>
    </section>`;
  }
  #dish(dish: AllergyDish, index: number) {
    const assigned = this.draft.ticks[lineKey(dish.line)] ?? null;
    const guest = assigned === null ? undefined : this.draft.guests[assigned];
    const codes = guest ? allergyClashes(dish.allergens, guest.allergens) : [];
    return html`<section data-dish=${index} class=${codes.length ? "dish clash" : "dish"}>
      <p>
        <strong>${dish.quantity} × ${dish.name}</strong>
        ${nutritionIcons(dish.allergens, [])}${dish.allergens === null ? html`<span class="muted">${t("allergy.unknown")}</span>` : nothing}
      </p>
      ${dish.sentAt ? html`<p class="muted" data-sent>${t("allergy.sent").replace("{time}", () => new Date(dish.sentAt!).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" }))}</p>` : nothing}
      ${dish.extras.map((extra, i) => html`<p data-extra=${`${index}:${i}`}>+ ${extra.quantity} × ${extra.name} ${nutritionIcons(extra.allergens, [])}${extra.allergens === null ? html`<span class="muted">${t("allergy.unknown")}</span>` : nothing}</p>`)}
      ${this.draft.guests.map(
        (g, i) =>
          html`<label
            ><input
              type="checkbox"
              name=${`dish-${index}-guest-${i}`}
              data-tick=${`${i}:${index}`}
              .checked=${live(assigned === i)}
              ?disabled=${this.busy || this.confirmation !== null}
              @change=${(e: Event) => {
                e.stopPropagation();
                const checked = (e.target as HTMLInputElement).checked;
                this.#change((d) => {
                  d.ticks[lineKey(dish.line)] = checked ? i : null;
                });
              }}
            />${t("allergy.eats").replace("{who}", () => g.who)}</label
          >`,
      )}
      ${codes.length ? html`<p data-clash>${t("allergy.contains").replace(/\{allergens\}|\{who\}/g, (key) => (key === "{who}" ? guest!.who : codes.map((code) => allergenLabel(code, dish.allergens![code]!, currentLocale())).join(", ")))}</p>` : nothing}
    </section>`;
  }
  override render() {
    if (!this.view || !this.active) return nothing;
    const save = saveActionState(this.#scope);
    const fieldError = (this.attempted && this.#invalid()) || this.fieldRefusal !== null;
    const clash = this.#dishes().some((d) => {
      const guest = this.draft.guests[this.draft.ticks[lineKey(d.line)] ?? -1];
      return guest && allergyClashes(d.allergens, guest.allergens).length > 0;
    });
    const disabled = this.busy || this.confirmation !== null;
    return html`<wt-dialog
        ${trackDialog()}
        .open=${this.active}
        .heading=${this.page === "question" ? t("allergy.question") : t("allergy.title")}
        .beforeClose=${this.#beforeClose}
        @wt-close=${(e: Event) => this.#closed(e)}
      >
        <div
          class="content"
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-primary]"))}
        >
          ${
            this.page === "question"
              ? html`<div class="actions">
                  <wt-button data-none ?disabled=${disabled} @click=${() => this.#none()}
                    >${t("allergy.none")}</wt-button
                  ><wt-button
                    data-allergies
                    ?disabled=${disabled}
                    @click=${() => {
                      this.#add();
                      this.page = this.mode === "edit" ? "editor" : "guests";
                    }}
                    >${t("allergy.title")}</wt-button
                  >
                </div>`
              : html`
                  ${
                    this.page !== "ticks"
                      ? html`${this.draft.guests.map((g, i) => this.#guest(g, i))}${!this.draft.guests.length ? html`<p>${t("allergy.empty")}</p>` : nothing}
                          <div class="actions">
                            <wt-button
                              data-add
                              variant="secondary"
                              ?disabled=${disabled}
                              @click=${() => this.#add()}
                              >${t("allergy.another")}</wt-button
                            ><wt-button
                              data-none
                              variant="secondary"
                              ?disabled=${disabled}
                              @click=${() => this.#none()}
                              >${t("allergy.none")}</wt-button
                            >
                          </div>`
                      : nothing
                  }
                  ${this.page === "ticks" || this.page === "editor" ? this.#dishes().map((d, i) => this.#dish(d, i)) : nothing}
                `
          }
          <wt-form-actions
            .error=${[fieldError ? t("form.fix_fields") : "", this.refusal].filter(Boolean).join(" ")}
          >
            <wt-button
              slot="cancel"
              data-cancel
              variant="secondary"
              ?disabled=${disabled}
              @click=${() => void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
              >${t("action.cancel")}</wt-button
            >
            ${
              this.page === "ticks"
                ? html`<wt-button
                    slot="secondary"
                    data-back
                    variant="secondary"
                    ?disabled=${disabled}
                    @click=${() => {
                      this.page = "guests";
                    }}
                    >${t("allergy.back")}</wt-button
                  >`
                : nothing
            }
            ${this.page !== "question" ? html`<wt-button data-primary variant=${this.mode === "edit" ? save.variant : "primary"} ?disabled=${disabled || (this.mode === "edit" && save.unchanged) || (this.attempted && this.#invalid())} @click=${() => void this.#submit()}>${this.mode === "edit" ? t("allergy.save") : this.page === "guests" ? t("allergy.next") : clash ? t("allergy.anyway") : t("allergy.send")}</wt-button>` : nothing}
          </wt-form-actions>
        </div>
      </wt-dialog>
      ${
        this.confirmation
          ? html`<wt-dialog
              ${trackDialog()}
              .open=${true}
              .heading=${this.confirmation.kind === "none" ? t("allergy.none_title") : t("allergy.delete_title")}
              @wt-close=${(e: Event) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) this.confirmation = null;
              }}
              ><p>
                ${this.confirmation.kind === "none" ? t("allergy.none_message") : t("allergy.delete_message")}
              </p>
              <wt-form-actions
                ><wt-button
                  slot="cancel"
                  data-confirm-cancel
                  variant="secondary"
                  @click=${() => {
                    this.confirmation = null;
                  }}
                  >${t("action.cancel")}</wt-button
                ><wt-button
                  data-confirm-delete
                  variant="danger"
                  ?disabled=${this.busy}
                  @click=${() => this.#confirm()}
                  >${this.confirmation.kind === "none" ? t("allergy.none") : t("allergy.delete")}</wt-button
                ></wt-form-actions
              ></wt-dialog
            >`
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-party-allergy-dialog": TillPartyAllergyDialog;
  }
}
