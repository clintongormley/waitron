import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeOf } from "@waitron/dashboard-kit";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export interface StationEditorStation {
  id: string;
  name: string;
  active: boolean;
  showsRestOfOrder: boolean;
  printerIds: readonly string[];
}
export interface StationEditorPrinter {
  id: string;
  name: string;
  active?: boolean;
  watcherId?: string | null;
}
/** Only what changed from the opened values; `printerIds` only when printers may be changed. */
export type StationEditorSave = {
  name?: string;
  printerIds?: string[];
  showsRestOfOrder?: boolean;
};

type Draft = { name: string; printerIds: string[]; showsRestOfOrder: boolean };
export type StationRefusal = { code: string; params?: Record<string, unknown> };
type Refusal = StationRefusal;

/** A rejected station write as the editor reads it: its code and what the code names. */
export function refusalOf(error: unknown): StationRefusal {
  const params =
    typeof error === "object" && error !== null
      ? (error as { params?: unknown }).params
      : undefined;
  return {
    code: codeOf(error),
    ...(typeof params === "object" && params !== null
      ? { params: params as Record<string, unknown> }
      : {}),
  };
}

const PRINTER_REFUSALS = new Set(["printer.not_found", "printer.makes_and_watches"]);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
const copy = (draft: Draft): Draft => ({ ...draft, printerIds: [...draft.printerIds] });
const equal = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() &&
  a.showsRestOfOrder === b.showsRestOfOrder &&
  sameSet(a.printerIds, b.printerIds);

/** The printers a station may print on: active ones no watcher uses, plus any it already has. */
export function stationPrinterOptions(
  printers: readonly StationEditorPrinter[],
  watchers: readonly { id: string; name: string; printerIds: readonly string[] }[],
  chosen: readonly string[],
) {
  return printers.map((printer) => {
    const watcher = watchers.find(
      (row) => row.printerIds.includes(printer.id) || row.id === printer.watcherId,
    );
    const watched = !!watcher || !!printer.watcherId;
    return {
      value: printer.id,
      label: printer.name,
      disabled: (printer.active === false || watched) && !chosen.includes(printer.id),
      description:
        printer.active === false
          ? t("prep.health.disabled")
          : watched
            ? format("prep.tickets.watcher_printer", { name: watcher?.name ?? printer.watcherId! })
            : undefined,
    };
  });
}

/** Where a station-write refusal belongs: a field it names, or the line above the buttons. */
export function stationRefusalField(refusal: Refusal | undefined): "name" | "printers" | undefined {
  if (refusal === undefined) return undefined;
  if (refusal.code === "station.name_taken") return "name";
  if (
    PRINTER_REFUSALS.has(refusal.code) ||
    (refusal.code === "management.request_invalid" && refusal.params?.field === "printerIds") ||
    (refusal.code === "authorization.not_permitted" &&
      refusal.params?.permission === "printer.manage")
  )
    return "printers";
  return undefined;
}

function refusalText(refusal: Refusal): string {
  switch (stationRefusalField(refusal)) {
    case "name":
      return t("prep.name_taken");
    case "printers":
      return refusal.code === "authorization.not_permitted"
        ? t("prep.printers_not_permitted")
        : t("prep.printers_refused");
    default:
      return refusal.code === "station.not_found"
        ? `${t("prep.save_error")} ${t("prep.station_not_found")}`
        : t("prep.save_error");
  }
}

@customElement("prep-station-editor")
export class StationEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .readout {
        display: grid;
        gap: var(--wt-space-1);
        margin: 0;
      }
      .readout dt {
        font-weight: var(--wt-font-weight-bold);
      }
      .readout dd {
        margin: 0;
      }
      .note {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) station?: StationEditorStation;
  @property({ attribute: false }) printers: readonly StationEditorPrinter[] = [];
  @property({ attribute: false }) watchers: readonly {
    id: string;
    name: string;
    printerIds: readonly string[];
  }[] = [];
  /** Whether the person holds `printer.manage`; without it the printers are a read-out. */
  @property({ type: Boolean }) canManagePrinters = false;
  @property({ attribute: false }) refusal?: Refusal;

  @state() private draft: Draft = { name: "", printerIds: [], showsRestOfOrder: false };
  @state() private attempted = false;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private openedId?: string;
  private baseline?: Draft;
  private submitted?: Draft;
  private generation = {};

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }

  protected override willUpdate() {
    const station = this.station;
    if (!this.open || station === undefined) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = undefined;
      this.baseline = undefined;
      this.generation = {};
      return;
    }
    if (!this.identity || this.openedId !== station.id) {
      this.scope?.dispose();
      this.scope = undefined;
      this.leave = undefined;
      this.identity = {};
      this.openedId = station.id;
      this.generation = {};
      this.draft = {
        name: station.name,
        printerIds: [...station.printerIds],
        showsRestOfOrder: station.showsRestOfOrder,
      };
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.refusal = undefined;
    }
    if (this.isConnected && !this.scope) {
      const { coordinator, scope } = draftScopeFor(this, {
        id: this.identity,
        current: () => this.draft,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      this.leave = coordinator;
      scope.commit(this.baseline!);
    }
  }

  get dirty(): boolean {
    return this.baseline !== undefined && !equal(this.draft, this.baseline);
  }

  /**
   * The host calls this once the last save is written: those values become the opened ones, and the
   * editor closes unless it was changed again meanwhile. Answers whether it closed.
   */
  saved(): boolean {
    if (this.submitted === undefined) return false;
    this.baseline = copy(this.submitted);
    this.submitted = undefined;
    this.scope?.commit(this.baseline);
    this.requestUpdate();
    if (this.dirty) return false;
    this.shadowRoot?.querySelector("wt-modal")?.closeAfter("saved");
    this.open = false;
    return true;
  }

  private get printersEditable(): boolean {
    return this.canManagePrinters && this.station?.active === true;
  }

  private nameError(): string {
    return this.draft.name.trim() === "" ? t("prep.name_required") : "";
  }

  private changed(draft: Draft, field: "name" | "printers" | "rest") {
    this.draft = draft;
    if (stationRefusalField(this.refusal) === field) this.refusal = undefined;
    this.scope?.changed();
  }

  /**
   * What a save would send. Printers chosen before the station was switched off, or before the
   * read-out took their field away, cannot be sent, so they are left out.
   */
  private sendable(): StationEditorSave {
    const base = this.baseline!;
    const draft = this.draft;
    return {
      ...(draft.name.trim() !== base.name.trim() ? { name: draft.name.trim() } : {}),
      ...(this.printersEditable && !sameSet(draft.printerIds, base.printerIds)
        ? { printerIds: [...draft.printerIds] }
        : {}),
      ...(draft.showsRestOfOrder !== base.showsRestOfOrder
        ? { showsRestOfOrder: draft.showsRestOfOrder }
        : {}),
    };
  }

  private get nothingToSend(): boolean {
    return this.baseline !== undefined && Object.keys(this.sendable()).length === 0;
  }

  private save() {
    if (
      !this.open ||
      !this.isConnected ||
      this.busy ||
      saveActionState(this.scope).unchanged ||
      this.nothingToSend
    )
      return;
    this.attempted = true;
    this.refusal = undefined;
    if (this.nameError()) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const detail = this.sendable();
    this.submitted = {
      ...copy(this.draft),
      printerIds: [...(detail.printerIds ?? this.baseline!.printerIds)],
    };
    this.dispatchEvent(new CustomEvent("station-save", { detail, bubbles: true, composed: true }));
  }

  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (!this.isConnected || this.busy) return false;
    if (!this.scope || !this.leave) return true;
    const generation = this.generation;
    const outcome = await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} });
    return this.isConnected && generation === this.generation && outcome === "proceeded";
  };

  private printerNames(printerIds: readonly string[]): string {
    return (
      printerIds
        .map((id) => this.printers.find((printer) => printer.id === id)?.name ?? id)
        .join(", ") || t("prep.none")
    );
  }

  private printersField(current: () => boolean, error: string) {
    if (!this.printersEditable)
      return html`<dl class="readout" data-test="station-printers">
        <dt>${t("prep.printers")}</dt>
        <dd>${this.printerNames(this.station!.printerIds)}</dd>
      </dl>`;
    return html`<wt-combobox
      name="printerIds"
      label=${t("prep.printers")}
      multiple
      .values=${this.draft.printerIds}
      .options=${stationPrinterOptions(this.printers, this.watchers, this.draft.printerIds)}
      .error=${error}
      .countLabel=${() => this.printerNames(this.draft.printerIds)}
      .searchPlaceholder=${t("prep.printers")}
      .noResultsLabel=${t("venue.combobox_no_results")}
      @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
        event.stopPropagation();
        if (current())
          this.changed({ ...this.draft, printerIds: [...event.detail.values] }, "printers");
      }}
    ></wt-combobox>`;
  }

  override render(): unknown {
    if (!this.open || this.station === undefined) return nothing;
    const s = saveActionState(this.scope);
    const nameError = this.attempted ? this.nameError() : "";
    const refusal = this.refusal;
    const refusedField = stationRefusalField(refusal);
    const fieldMessage = refusal && refusedField ? refusalText(refusal) : "";
    const marked = nameError !== "" || refusedField !== undefined;
    const unplaced = refusal && !refusedField ? refusalText(refusal) : "";
    const generation = this.generation;
    // Fields stay editable while a save is sent: a newer edit stays as the draft once it is written.
    const current = () => generation === this.generation && this.isConnected && this.open;
    return keyed(
      generation,
      html`<wt-modal
        open
        size="standard"
        data-test="station-editor"
        heading=${t("prep.edit_station")}
        .dismissible=${!this.busy}
        .beforeClose=${this.beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (generation !== this.generation || !this.isConnected) return;
          this.open = false;
          this.dispatchEvent(new CustomEvent("station-close", { bubbles: true, composed: true }));
        }}
      >
        <div class="form">
          <wt-input
            name="stationName"
            label=${t("prep.name")}
            required
            .value=${this.draft.name}
            .error=${nameError || (refusedField === "name" ? fieldMessage : "")}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current()) this.changed({ ...this.draft, name: event.detail.value }, "name");
            }}
            @keydown=${(event: KeyboardEvent) =>
              submitOnEnter(event, this.shadowRoot!.querySelector("[data-test=save-station-edit]"))}
          ></wt-input>
          ${this.printersField(current, refusedField === "printers" ? fieldMessage : "")}
          ${
            this.canManagePrinters && !this.station.active
              ? html`<p class="note">${t("prep.printers_need_active")}</p>`
              : nothing
          }
          <wt-switch
            name="showsRestOfOrder"
            label=${t("prep.shows_rest_of_order")}
            .checked=${this.draft.showsRestOfOrder}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              if (current())
                this.changed({ ...this.draft, showsRestOfOrder: event.detail.checked }, "rest");
            }}
          ></wt-switch>
          <p class="note">${t("prep.shows_rest_of_order_hint")}</p>
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[unplaced, marked ? t("prep.fix_fields") : ""].filter(Boolean).join(" ")}
        >
          <wt-button
            slot="cancel"
            data-test="cancel-station-edit"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current() && !this.busy)
                void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            }}
            >${t("prep.cancel")}</wt-button
          >
          <wt-button
            data-test="save-station-edit"
            variant=${this.nothingToSend ? "secondary" : s.variant}
            ?disabled=${s.unchanged || this.nothingToSend || this.busy || nameError !== ""}
            ?loading=${this.busy}
            @click=${() => {
              if (current()) this.save();
            }}
            >${t("prep.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "prep-station-editor": StationEditor;
  }
}
