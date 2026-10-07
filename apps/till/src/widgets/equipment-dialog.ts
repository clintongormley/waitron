import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./equipment-scanner.js";
import { trackDialog } from "./track-dialog.js";
import { carriedText, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  EquipmentRole,
  RoleEquipment,
} from "../api/client.js";

type Field = "receiptPrinterId" | "paymentSlipPrinterId" | "cardReaderId" | "cashDrawerPrinterId";

/** The rows in the order staff use them; the cash drawer has no label to scan. */
const ROWS: { role: EquipmentRole; field: Field; scan: "printer" | "reader" | null }[] = [
  { role: "receipt", field: "receiptPrinterId", scan: "printer" },
  { role: "payment_slip", field: "paymentSlipPrinterId", scan: "printer" },
  { role: "card_terminal", field: "cardReaderId", scan: "reader" },
  { role: "cash_drawer", field: "cashDrawerPrinterId", scan: null },
];

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

function optionLabel(item: EquipmentItem): string {
  if (item.busy) return fill(t("equipment.option_busy"), { item: item.name });
  if (item.heldBy !== null)
    return fill(t("equipment.option_held"), { item: item.name, device: item.heldBy.deviceName });
  if (!item.available) return fill(t("equipment.switched_off"), { item: item.name });
  return item.name;
}

function canScan(): boolean {
  return (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia !== undefined;
}

/**
 * Shows what the device prints receipts and payment slips on, pays cards on and opens as its cash
 * drawer, and lets staff choose each from a list or by scanning its label. Choosing an item another
 * device carries asks first. The dialog only reports a choice; the app owns the request.
 */
@customElement("till-equipment-dialog")
export class TillEquipmentDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      .row {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .label {
        font-weight: var(--wt-font-weight-bold);
      }

      .resolved {
        overflow-wrap: anywhere;
      }

      .context {
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
      }

      .choose {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-2);
      }

      .choose wt-combobox {
        flex: 1;
        min-width: 0;
      }

      .scanning {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  /** As the server last said; `null` before it has been read. */
  @property({ attribute: false }) equipment: DeviceEquipment | null = null;
  /** A refused choice; `field` names the role it refused. */
  @property({ attribute: false }) error: { code: string; field?: string } | null = null;
  /** A held item picked from a list, waiting for the person to say whether to take it. */
  @state() private asking: { role: EquipmentRole; item: EquipmentItem } | null = null;
  @state() private scanning: (typeof ROWS)[number] | null = null;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) {
      this.asking = null;
      this.scanning = null;
    }
  }

  #emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #change(change: EquipmentChange): void {
    this.#emit<EquipmentChange>("equipment-change", change);
  }

  #role(role: EquipmentRole): RoleEquipment | undefined {
    const found = this.equipment?.roles.find((each) => each.role === role);
    return found !== undefined &&
      (found.choices.length > 0 || found.chosen !== null || found.default !== null)
      ? found
      : undefined;
  }

  /** The field a refusal is shown under, when this dialog shows that row. A busy reader's refusal
   * names the reader rather than a field. */
  #refusedField(): Field | null {
    const error = this.error;
    if (error === null) return null;
    const field = error.code === "reader.payment_in_progress" ? "cardReaderId" : error.field;
    const row = ROWS.find((each) => each.field === field);
    return row !== undefined && this.#role(row.role) !== undefined ? row.field : null;
  }

  #bottomMessage(): string {
    if (this.error === null) return "";
    return this.#refusedField() === null ? codeMessage(this.error.code) : t("form.fix_fields");
  }

  #context(equipment: RoleEquipment): string {
    const shown = equipment.selection === "item" ? equipment.chosen : equipment.default;
    if (shown?.heldBy)
      return carriedText(shown.name, shown.heldBy, "equipment.held_by", "equipment.held_by_person");
    if (equipment.resolved !== null && !equipment.resolved.available)
      return fill(t("equipment.switched_off"), { item: equipment.resolved.name });
    return t(
      equipment.selection === "default" ? "equipment.from_default" : "equipment.chosen_here",
    );
  }

  #onPick(equipment: RoleEquipment, value: string): void {
    const current = equipment.selection === "default" ? "" : (equipment.chosenId ?? "");
    if (value === current) return;
    if (value === "") {
      this.#change({ role: equipment.role, selection: "default", via: "list", takeOver: false });
      return;
    }
    const picked =
      equipment.choices.find((choice) => choice.id === value) ??
      (equipment.chosen?.id === value ? equipment.chosen : undefined);
    // Taking a busy reader cannot succeed, so it is not asked about: it is sent, and the server's
    // answer, refusal or not, is what the app shows.
    if (picked?.heldBy && !picked.busy) {
      this.asking = { role: equipment.role, item: picked };
      return;
    }
    this.#change({ role: equipment.role, selection: { id: value }, via: "list", takeOver: false });
  }

  #row(row: (typeof ROWS)[number]): TemplateResult | typeof nothing {
    const equipment = this.#role(row.role);
    if (equipment === undefined) return nothing;
    const label = t(`equipment.${row.role}`);
    const useDefault = fill(t("equipment.use_default"), {
      name: equipment.default?.name ?? t("equipment.none"),
    });
    const options = [
      { value: "", label: useDefault },
      ...equipment.choices.map((choice) => ({ value: choice.id, label: optionLabel(choice) })),
    ];
    // A choice the device may not newly make (switched off, off the list) stays shown as chosen.
    const chosen = equipment.chosen;
    if (
      equipment.selection === "item" &&
      chosen !== null &&
      !equipment.choices.some((choice) => choice.id === chosen.id)
    )
      options.push({ value: chosen.id, label: optionLabel(chosen) });
    const error = this.#refusedField() === row.field ? codeMessage(this.error!.code) : "";
    return html`<div class="row" data-equipment-row=${row.role}>
      <span class="label" data-equipment-label>${label}</span>
      <span class="resolved" data-equipment-resolved
        >${equipment.resolved?.name ?? t("equipment.none")}</span
      >
      <span class="context" data-equipment-context>${this.#context(equipment)}</span>
      <div class="choose">
        <wt-combobox
          name=${row.field}
          search="auto"
          hide-label
          label=${label}
          placeholder=${useDefault}
          searchPlaceholder=${t("form.combobox_search")}
          noResultsLabel=${t("form.combobox_no_results")}
          .options=${options}
          .value=${live(equipment.selection === "default" ? "" : (equipment.chosenId ?? ""))}
          .error=${error}
          .invalid=${error !== ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#onPick(equipment, event.detail.value);
          }}
        ></wt-combobox>
        ${
          row.scan !== null && canScan()
            ? html`<wt-button
                data-equipment-scan
                variant="secondary"
                aria-label=${`${t("equipment.scan")}: ${label}`}
                @click=${() => (this.scanning = row)}
                >${t("equipment.scan")}</wt-button
              >`
            : nothing
        }
      </div>
    </div>`;
  }

  #renderScanning(row: (typeof ROWS)[number]): TemplateResult {
    return html`<div class="scanning">
      <span class="label">${t(`equipment.${row.role}`)}</span>
      <till-equipment-scanner
        .kind=${row.scan!}
        @equipment-scanned=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          this.scanning = null;
          this.#change({
            role: row.role,
            selection: { id: event.detail.id },
            via: "scan",
            takeOver: false,
          });
        }}
      ></till-equipment-scanner>
      <div>
        <wt-button
          data-equipment-scan-back
          variant="secondary"
          @click=${() => (this.scanning = null)}
          >${t("equipment.scan_back")}</wt-button
        >
      </div>
    </div>`;
  }

  #renderAsking(): TemplateResult | typeof nothing {
    const asking = this.asking;
    if (asking === null) return nothing;
    const question = carriedText(
      asking.item.name,
      asking.item.heldBy!,
      "equipment.take_question",
      "equipment.take_question_person",
    );
    return html`<wt-dialog
      ${trackDialog()}
      data-equipment-confirm
      .open=${true}
      .heading=${t("equipment.take_title")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.asking = null;
      }}
    >
      <p>${question}</p>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-equipment-cancel
          variant="secondary"
          @click=${() => (this.asking = null)}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-equipment-take
          variant="primary"
          @click=${() => {
            this.asking = null;
            this.#change({
              role: asking.role,
              selection: { id: asking.item.id },
              via: "list",
              takeOver: true,
            });
          }}
          >${t("equipment.take")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  override render() {
    if (!this.open) return nothing;
    return html`<wt-dialog
        ${trackDialog()}
        .open=${true}
        .heading=${t("equipment.title")}
        @wt-close=${() => this.#emit("close")}
      >
        ${
          this.scanning === null
            ? html`<div class="fields">${ROWS.map((row) => this.#row(row))}</div>`
            : this.#renderScanning(this.scanning)
        }
        <wt-form-actions slot="footer" .error=${this.#bottomMessage()}>
          <wt-button data-equipment-close variant="secondary" @click=${() => this.#emit("close")}>
            ${t("equipment.close")}
          </wt-button>
        </wt-form-actions>
      </wt-dialog>
      ${this.#renderAsking()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-equipment-dialog": TillEquipmentDialog;
  }
}
