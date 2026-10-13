import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { parseEquipmentCode } from "@waitron/shared";
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

interface NfcRecord {
  recordType: string;
  encoding: string;
  data: DataView;
}
interface NfcReading extends Event {
  message: { records: NfcRecord[] };
}
interface NfcReader extends EventTarget {
  scan(options: { signal: AbortSignal }): Promise<void>;
}
function nfcReader(): (new () => NfcReader) | undefined {
  return (window as Window & { NDEFReader?: new () => NfcReader }).NDEFReader;
}

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
  @state() private qrScanning = false;
  @state() private nfcPermission: PermissionState | null = null;
  @state() private nfcMessage:
    | "equipment.scan_not_ours"
    | "equipment.scan_not_printer"
    | "equipment.scan_not_reader"
    | "equipment.nfc_read_error"
    | "equipment.nfc_unavailable"
    | null = null;
  #nfcAbort?: AbortController;
  #permissionAbort?: AbortController;
  #opening = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && this.open) void this.#discoverNfc();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopNfcPermission();
  }

  #stopNfc(): void {
    this.#nfcAbort?.abort();
    this.#nfcAbort = undefined;
  }

  #stopNfcPermission(): void {
    this.#opening++;
    this.#stopNfc();
    this.#permissionAbort?.abort();
    this.#permissionAbort = undefined;
    this.nfcPermission = null;
    this.nfcMessage = null;
  }

  async #discoverNfc(): Promise<void> {
    this.#stopNfcPermission();
    if (nfcReader() === undefined) return;
    const opening = this.#opening;
    let permission: PermissionStatus;
    try {
      permission = await navigator.permissions.query({ name: "nfc" as PermissionName });
    } catch {
      return;
    }
    if (opening !== this.#opening || !this.open || !this.isConnected) return;
    const abort = new AbortController();
    this.#permissionAbort = abort;
    const update = () => {
      this.nfcPermission = permission.state;
      if (permission.state === "granted" && !this.qrScanning) void this.#startNfc();
      else this.#stopNfc();
    };
    permission.addEventListener("change", update, { signal: abort.signal });
    update();
  }

  async #startNfc(): Promise<void> {
    const Reader = nfcReader();
    if (
      Reader === undefined ||
      this.#nfcAbort !== undefined ||
      !this.open ||
      !this.isConnected ||
      this.qrScanning
    )
      return;
    const abort = new AbortController();
    this.#nfcAbort = abort;
    this.nfcMessage = null;
    try {
      const reader = new Reader();
      reader.addEventListener(
        "reading",
        (event) => {
          if (
            this.#nfcAbort !== abort ||
            abort.signal.aborted ||
            !this.open ||
            !this.isConnected ||
            this.qrScanning ||
            this.asking !== null
          )
            return;
          this.#readNfc(event as NfcReading);
        },
        { signal: abort.signal },
      );
      reader.addEventListener(
        "readingerror",
        () => {
          this.nfcMessage = "equipment.nfc_read_error";
        },
        { signal: abort.signal },
      );
      await reader.scan({ signal: abort.signal });
      if (this.#nfcAbort === abort && !abort.signal.aborted) this.nfcPermission = "granted";
    } catch (error) {
      if (this.#nfcAbort !== abort || abort.signal.aborted) return;
      this.#stopNfc();
      if ((error as { name?: string }).name === "NotAllowedError") this.nfcPermission = "denied";
      else this.nfcMessage = "equipment.nfc_unavailable";
    }
  }

  #readNfc(event: NfcReading): void {
    const codes = event.message.records.flatMap((record) => {
      if (record.recordType !== "text") return [];
      try {
        const code = parseEquipmentCode(
          new TextDecoder(record.encoding || "utf-8", { fatal: true }).decode(record.data),
        );
        return code === null ? [] : [code];
      } catch {
        return [];
      }
    });
    const code = codes.length === 1 ? codes[0] : undefined;
    if (code === undefined) {
      this.nfcMessage = "equipment.scan_not_ours";
      return;
    }
    const row = this.scanning;
    if (row !== null && code.kind !== row.scan) {
      this.nfcMessage =
        row.scan === "printer" ? "equipment.scan_not_printer" : "equipment.scan_not_reader";
      return;
    }
    const permitted = this.equipment?.roles.some(
      (role) =>
        (row === null
          ? code.kind === "reader"
            ? role.role === "card_terminal"
            : role.role === "receipt" || role.role === "payment_slip"
          : role.role === row.role) && role.choices.some((item) => item.id === code.id),
    );
    if (!permitted) {
      this.nfcMessage = "equipment.scan_not_ours";
      return;
    }
    this.nfcMessage = null;
    this.scanning = null;
    this.#change(
      row === null
        ? { kind: code.kind, selection: { id: code.id }, via: "scan" }
        : { role: row.role, selection: { id: code.id }, via: "scan", takeOver: false },
    );
  }

  #close(): void {
    this.#stopNfcPermission();
    this.#emit("close");
  }

  #scanRow(row: (typeof ROWS)[number]): void {
    this.scanning = row;
    this.nfcMessage = null;
    this.qrScanning = this.nfcPermission === null || this.nfcPermission === "denied";
    if (this.qrScanning) this.#stopNfc();
  }

  #backToList(): void {
    this.scanning = null;
    this.qrScanning = false;
    this.nfcMessage = null;
    if (this.nfcPermission === "granted") void this.#startNfc();
  }

  #renderNfc(): TemplateResult | typeof nothing {
    if (this.nfcPermission === null || this.nfcPermission === "denied" || this.qrScanning)
      return nothing;
    return html`<div class="scanning" data-equipment-nfc>
      <p data-equipment-nfc-message role="status">
        ${this.nfcMessage === null ? t("equipment.nfc_hint") : t(this.nfcMessage)}
      </p>
      ${this.nfcPermission === "prompt" ? html`<wt-button data-equipment-nfc-allow variant="primary" @click=${() => void this.#startNfc()}>${t("equipment.nfc_allow")}</wt-button>` : nothing}
    </div>`;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && !this.open) {
      this.asking = null;
      this.scanning = null;
      this.qrScanning = false;
      this.#stopNfcPermission();
    } else if (changed.has("open") && this.open) {
      void this.#discoverNfc();
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
          row.scan !== null &&
          (canScan() || this.nfcPermission === "granted" || this.nfcPermission === "prompt")
            ? html`<wt-button
                data-equipment-scan
                variant="secondary"
                aria-label=${`${t("equipment.scan")}: ${label}`}
                @click=${() => this.#scanRow(row)}
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
      ${
        this.qrScanning
          ? html`<till-equipment-scanner
              .kind=${row.scan!}
              @equipment-scanned=${(event: CustomEvent<{ id: string }>) => {
                event.stopPropagation();
                this.#backToList();
                this.#change({
                  role: row.role,
                  selection: { id: event.detail.id },
                  via: "scan",
                  takeOver: false,
                });
              }}
            ></till-equipment-scanner>`
          : html`
              ${
                canScan()
                  ? html`<wt-button
                      data-equipment-qr
                      variant="secondary"
                      @click=${() => {
                        this.qrScanning = true;
                        this.#stopNfc();
                      }}
                      >${t("equipment.scan_qr")}</wt-button
                    >`
                  : nothing
              }
            `
      }
      <div>
        <wt-button data-equipment-scan-back variant="secondary" @click=${() => this.#backToList()}
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
        @wt-close=${() => this.#close()}
      >
        ${
          this.scanning === null
            ? html`<div class="fields">${ROWS.map((row) => this.#row(row))}</div>`
            : this.#renderScanning(this.scanning)
        }
        ${this.#renderNfc()}
        <wt-form-actions slot="footer" .error=${this.#bottomMessage()}>
          <wt-button data-equipment-close variant="secondary" @click=${() => this.#close()}>
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
