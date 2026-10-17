import { LitElement, css, html, nothing, type PropertyValues } from "lit";
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
import "@waitron/ui/src/components/wt-colour-chooser.js";
import { codeOf } from "@waitron/dashboard-kit";
import { isStationColour, type StationColour, type StationThresholds } from "@waitron/shared";
import { stationColourChoices, type StationColourUser } from "./station-colour-choices.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export interface StationEditorStation {
  id: string;
  name: string;
  colour: StationColour;
  active: boolean;
  showsRestOfOrder: boolean;
  /** Null follows the venue's choice. */
  printMovedSlips: boolean | null;
  printerIds: readonly string[];
  /** A null timing follows the venue default. */
  timingOverrides: { [K in TimingField]: number | null };
  timingDefaults: StationThresholds;
}
export interface StationEditorPrinter {
  id: string;
  name: string;
  active?: boolean;
}
/** Only what changed from the opened values; `printerIds` only when printers may be changed. */
export type StationEditorSave = {
  name?: string;
  colour?: StationColour;
  printerIds?: string[];
  showsRestOfOrder?: boolean;
  printMovedSlips?: boolean | null;
} & { [K in TimingField]?: number | null };

const TIMING_FIELDS = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;
type TimingField = (typeof TIMING_FIELDS)[number];
const TIMING_LABELS = {
  warmAfterMinutes: "prep.health.warm",
  overdueAfterMinutes: "prep.health.overdue",
  forgottenAfterMinutes: "prep.health.forgotten",
} as const;
const isTimingField = (value: unknown): value is TimingField =>
  (TIMING_FIELDS as readonly unknown[]).includes(value);
type Field = "name" | "colour" | "printers" | TimingField;

type Draft = {
  name: string;
  colour: StationColour;
  printerIds: string[];
  showsRestOfOrder: boolean;
  printMovedSlips: boolean | null;
} & { [K in TimingField]: string };
export type StationRefusal = { code: string; params?: Record<string, unknown> };
type Refusal = StationRefusal;

/** A rejected write as an editor reads it: its code and what the code names. */
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

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
const copy = (draft: Draft): Draft => ({ ...draft, printerIds: [...draft.printerIds] });
/** "05" reads as "5"; text that is not a number stays as typed, so it counts as a change. */
const timingText = (value: string) => {
  const text = value.trim();
  return text === "" || !Number.isFinite(Number(text)) ? text : String(Number(text));
};
const equal = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() &&
  a.colour === b.colour &&
  a.showsRestOfOrder === b.showsRestOfOrder &&
  a.printMovedSlips === b.printMovedSlips &&
  sameSet(a.printerIds, b.printerIds) &&
  TIMING_FIELDS.every((field) => timingText(a[field]) === timingText(b[field]));

/** Each timing's own check, then the order with a blank read as its venue default. */
function timingErrors(
  draft: Draft,
  defaults: StationThresholds,
): Partial<Record<TimingField, string>> {
  const errors: Partial<Record<TimingField, string>> = {};
  const minutes: Partial<Record<TimingField, number>> = {};
  for (const field of TIMING_FIELDS) {
    const text = draft[field].trim();
    const value = text === "" ? defaults[field] : Number(text);
    if (text !== "" && !(Number.isInteger(value) && value >= 1 && value <= 2_147_483_647))
      errors[field] = t("prep.threshold_invalid");
    else minutes[field] = value;
  }
  const {
    warmAfterMinutes: warm,
    overdueAfterMinutes: overdue,
    forgottenAfterMinutes: forgotten,
  } = minutes;
  if (warm !== undefined && overdue !== undefined && overdue <= warm)
    errors.overdueAfterMinutes = t("prep.threshold_invalid");
  if (overdue !== undefined && forgotten !== undefined && forgotten <= overdue)
    errors.forgottenAfterMinutes = t("prep.threshold_invalid");
  return errors;
}

/** The printers a station may print on: active ones, plus any it already has. */
export function stationPrinterOptions(
  printers: readonly StationEditorPrinter[],
  chosen: readonly string[],
) {
  return printers.map((printer) => {
    const disabled = printer.active === false;
    return {
      value: printer.id,
      label: printer.name,
      disabled: disabled && !chosen.includes(printer.id),
      description: disabled ? t("prep.health.disabled") : undefined,
    };
  });
}

/** The chosen printers still in the printer list. */
export function listedPrinterIds(
  ids: readonly string[],
  printers: readonly { id: string }[],
): string[] {
  return ids.filter((id) => printers.some((printer) => printer.id === id));
}

/** Where a station-write refusal belongs: a field it names, or the line above the buttons. */
export function stationRefusalField(refusal: Refusal | undefined): Field | undefined {
  if (refusal === undefined) return undefined;
  if (refusal.code === "station.name_taken") return "name";
  if (refusal.code === "management.request_invalid" && refusal.params?.field === "colour")
    return "colour";
  if (
    (refusal.code === "station.thresholds_invalid" ||
      refusal.code === "management.request_invalid") &&
    isTimingField(refusal.params?.field)
  )
    return refusal.params.field;
  if (
    refusal.code === "printer.not_found" ||
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
    case "colour":
      return t("prep.colour_invalid");
    case "printers":
      return refusal.code === "authorization.not_permitted"
        ? t("prep.printers_not_permitted")
        : t("prep.printers_refused");
    case undefined:
      return refusal.code === "station.not_found"
        ? `${t("prep.save_error")} ${t("prep.station_not_found")}`
        : t("prep.save_error");
    default:
      return t("prep.threshold_invalid");
  }
}

const movedChoice = (value: boolean | null) =>
  value === null ? "venue" : value ? "print" : "dont-print";
const movedValue = (choice: string) =>
  choice === "print" ? true : choice === "dont-print" ? false : null;

function movedOptions(venuePrints: boolean) {
  return [
    {
      value: "venue",
      label: t(venuePrints ? "prep.moved_slips_venue_print" : "prep.moved_slips_venue_dont_print"),
    },
    { value: "print", label: t("prep.moved_slips_print") },
    { value: "dont-print", label: t("prep.moved_slips_dont_print") },
  ];
}

function timingDraft(overrides: StationEditorStation["timingOverrides"]) {
  return Object.fromEntries(
    TIMING_FIELDS.map((field) => [
      field,
      overrides[field] === null ? "" : String(overrides[field]),
    ]),
  ) as { [K in TimingField]: string };
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
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
      }
      legend {
        padding: 0;
        font-weight: var(--wt-font-weight-bold);
      }
      .timing-fields {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-2);
      }
      .timing-fields wt-input {
        min-width: 0;
      }
      .moved-slips wt-combobox {
        margin-block-start: var(--wt-space-2);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) station?: StationEditorStation;
  @property({ attribute: false }) printers: readonly StationEditorPrinter[] = [];
  /** The active stations, whose names the colour picker shows; the edited one is left out. */
  @property({ attribute: false }) stations: readonly StationColourUser[] = [];
  /** Whether the person holds `printer.manage`; without it the printers are a read-out. */
  @property({ type: Boolean }) canManagePrinters = false;
  @property({ attribute: false }) refusal?: Refusal;
  /** The venue's MOVED slips choice, which a station left as the venue follows. */
  @property({ attribute: false }) venuePrintsMovedSlips = true;

  @state() private draft: Draft = {
    name: "",
    colour: "red",
    printerIds: [],
    showsRestOfOrder: false,
    printMovedSlips: null,
    warmAfterMinutes: "",
    overdueAfterMinutes: "",
    forgottenAfterMinutes: "",
  };
  @state() private attempted = false;
  /** A chosen printer left the printer list, so the draft lost it. */
  @state() private printerDropped = false;
  private scope?: DraftScope<Draft>;
  private leave?: LeaveCoordinator;
  private identity?: object;
  private openedId?: string;
  private baseline?: Draft;
  private submitted?: Draft;
  private generation = {};
  private readonly colourUsedByLabel = (colour: string, stations: string) =>
    format("prep.colour_used_by", { colour, stations });

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

  protected override willUpdate(changed: PropertyValues<this>) {
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
        colour: station.colour,
        printerIds: [...station.printerIds],
        showsRestOfOrder: station.showsRestOfOrder,
        printMovedSlips: station.printMovedSlips,
        ...timingDraft(station.timingOverrides),
      };
      this.baseline = copy(this.draft);
      this.attempted = false;
      this.printerDropped = false;
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
    if (changed.has("printers")) this.dropUnlistedPrinters();
  }

  private dropUnlistedPrinters(): void {
    const baseline = this.baseline!;
    const draft = listedPrinterIds(this.draft.printerIds, this.printers);
    const base = listedPrinterIds(baseline.printerIds, this.printers);
    if (base.length < baseline.printerIds.length) {
      this.baseline = { ...baseline, printerIds: base };
      this.scope?.commit(this.baseline);
    }
    if (draft.length < this.draft.printerIds.length) {
      this.changed({ ...this.draft, printerIds: draft }, "printers");
      this.printerDropped = true;
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

  private fieldErrors(): Partial<Record<"name" | TimingField, string>> {
    return {
      ...(this.draft.name.trim() === "" ? { name: t("prep.name_required") } : {}),
      ...timingErrors(this.draft, this.station!.timingDefaults),
    };
  }

  private changed(draft: Draft, field: Field | "rest" | "printMovedSlips") {
    this.draft = draft;
    this.printerDropped = false;
    if (stationRefusalField(this.refusal) === field) this.refusal = undefined;
    this.scope?.changed();
  }

  private sendable(): StationEditorSave {
    const base = this.baseline!;
    const draft = this.draft;
    return {
      ...(draft.name.trim() !== base.name.trim() ? { name: draft.name.trim() } : {}),
      ...(draft.colour !== base.colour ? { colour: draft.colour } : {}),
      ...(this.printersEditable && !sameSet(draft.printerIds, base.printerIds)
        ? { printerIds: [...draft.printerIds] }
        : {}),
      ...(draft.showsRestOfOrder !== base.showsRestOfOrder
        ? { showsRestOfOrder: draft.showsRestOfOrder }
        : {}),
      ...(draft.printMovedSlips !== base.printMovedSlips
        ? { printMovedSlips: draft.printMovedSlips }
        : {}),
      ...Object.fromEntries(
        TIMING_FIELDS.filter((field) => timingText(draft[field]) !== timingText(base[field])).map(
          (field) => [field, draft[field].trim() === "" ? null : Number(draft[field].trim())],
        ),
      ),
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
    this.printerDropped = false;
    if (Object.keys(this.fieldErrors()).length > 0) {
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
      .options=${stationPrinterOptions(this.printers, this.draft.printerIds)}
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
    const errors = this.attempted ? this.fieldErrors() : {};
    const invalid = Object.keys(errors).length > 0;
    const nameError = errors.name ?? "";
    const refusal = this.refusal;
    const refusedField = stationRefusalField(refusal);
    const fieldMessage = refusal && refusedField ? refusalText(refusal) : "";
    const marked = invalid || refusedField !== undefined;
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
          <wt-colour-chooser
            name="colour"
            label=${t("prep.colour")}
            required
            .value=${this.draft.colour}
            .choices=${stationColourChoices(this.stations, this.station!.id)}
            .usedByLabel=${this.colourUsedByLabel}
            .error=${refusedField === "colour" ? fieldMessage : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (current() && isStationColour(event.detail.value))
                this.changed({ ...this.draft, colour: event.detail.value }, "colour");
            }}
          ></wt-colour-chooser>
          ${this.printersField(current, refusedField === "printers" ? fieldMessage : "")}
          ${
            this.canManagePrinters && !this.station.active
              ? html`<p class="note">${t("prep.printers_need_active")}</p>`
              : nothing
          }
          <fieldset aria-describedby="timing-inheritance">
            <legend>${t("prep.late_flags")}</legend>
            <div class="timing-fields">
              ${TIMING_FIELDS.map(
                (field) =>
                  html`<wt-input
                    name=${field}
                    label=${t(TIMING_LABELS[field])}
                    type="number"
                    placeholder=${String(this.station!.timingDefaults[field])}
                    .value=${this.draft[field]}
                    .error=${errors[field] || (refusedField === field ? fieldMessage : "")}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      if (current())
                        this.changed({ ...this.draft, [field]: event.detail.value }, field);
                    }}
                    @keydown=${(event: KeyboardEvent) =>
                      submitOnEnter(
                        event,
                        this.shadowRoot!.querySelector("[data-test=save-station-edit]"),
                      )}
                  ></wt-input>`,
              )}
            </div>
            <p id="timing-inheritance" class="note">${t("prep.timing_inheritance")}</p>
          </fieldset>
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
          <p class="note" data-test="rest-of-order-hint">${t("prep.shows_rest_of_order_hint")}</p>
          <fieldset class="moved-slips" data-test="moved-slips-group">
            <legend>${t("prep.moved_slips")}</legend>
            <wt-combobox
              name="printMovedSlips"
              label=${t("prep.moved_slips")}
              hide-label
              search="never"
              .value=${movedChoice(this.draft.printMovedSlips)}
              .options=${movedOptions(this.venuePrintsMovedSlips)}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (current())
                  this.changed(
                    { ...this.draft, printMovedSlips: movedValue(event.detail.value) },
                    "printMovedSlips",
                  );
              }}
            ></wt-combobox>
          </fieldset>
        </div>
        <wt-form-actions
          slot="footer"
          .error=${[
            unplaced,
            marked ? t("prep.fix_fields") : "",
            this.printerDropped ? t("prep.printer_deleted") : "",
          ]
            .filter(Boolean)
            .join(" ")}
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
            ?disabled=${s.unchanged || this.nothingToSend || this.busy || invalid}
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
