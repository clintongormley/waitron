import { css, html, nothing, type TemplateResult } from "lit";
import { encodePathSegment, leftToBrowser } from "@waitron/ui";
import type { Printer } from "../api/client.js";
import { t } from "../i18n/t.js";

export type ReceiptPrinterSettings = Pick<
  Printer,
  "paperWidth" | "resolution" | "hasCashDrawer" | "portable" | "pickupRoles"
>;

export function receiptPrinterSettings(printer: Printer): ReceiptPrinterSettings {
  const { paperWidth, resolution, hasCashDrawer, portable, pickupRoles } = printer;
  return { paperWidth, resolution, hasCashDrawer, portable, pickupRoles: [...pickupRoles] };
}

export function samePickupRoles(a: Printer["pickupRoles"], b: Printer["pickupRoles"]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
}

const scalarSettings = ["paperWidth", "resolution", "hasCashDrawer", "portable"] as const;

export function receiptPrinterSettingsPatch(
  edited: ReceiptPrinterSettings,
  opening: ReceiptPrinterSettings,
  saved: ReceiptPrinterSettings,
): Partial<ReceiptPrinterSettings> {
  const patch: Partial<ReceiptPrinterSettings> = {};
  for (const field of scalarSettings) {
    if (edited[field] !== opening[field] && edited[field] !== saved[field])
      Object.assign(patch, { [field]: edited[field] });
  }
  if (
    !samePickupRoles(edited.pickupRoles, opening.pickupRoles) &&
    !samePickupRoles(edited.pickupRoles, saved.pickupRoles)
  )
    patch.pickupRoles = edited.pickupRoles;
  return patch;
}

export function sameReceiptPrinterSettings(
  a: ReceiptPrinterSettings | undefined,
  b: ReceiptPrinterSettings | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    scalarSettings.every((field) => a[field] === b[field]) &&
    samePickupRoles(a.pickupRoles, b.pickupRoles)
  );
}

export const printerEditStyles = css`
  .printer-edit-paper {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-3);
    max-width: var(--wt-field-max-width);
  }
  .printer-edit-paper [name="printer-paper-width"] {
    flex: 1 0 min(100%, calc(var(--wt-space-6) * 4.5));
  }
  .printer-edit-paper [name="printer-resolution"] {
    flex: 1 0 min(100%, calc(var(--wt-space-6) * 6));
  }
  .printer-edit-calibration {
    margin: 0;
    color: var(--wt-color-text-muted);
  }
  .printer-edit-calibration a {
    color: var(--wt-color-primary-text);
  }
`;

export function printerPickupRolesField(
  values: Printer["pickupRoles"],
  disabled: boolean,
  change: (values: Printer["pickupRoles"]) => void,
): TemplateResult {
  return html`<wt-combobox
    name="printer-pickup-roles"
    searchPlaceholder=${t("categories.combobox_search")}
    noResultsLabel=${t("categories.combobox_no_results")}
    label=${t("printers.pickup_roles")}
    multiple
    show-empty-option
    ?disabled=${disabled}
    .values=${values}
    .countLabel=${() => t("printers.pickup_both")}
    .options=${[
      { value: "", label: t("printers.pickup_none") },
      { value: "receipt", label: t("devices.receipt_printer_now") },
      { value: "payment_slip", label: t("devices.slip_printer_now") },
    ]}
    @wt-change=${(event: CustomEvent<{ values: Printer["pickupRoles"] }>) => {
      event.stopPropagation();
      if ((event.currentTarget as HTMLElement).isConnected) change(event.detail.values);
    }}
  ></wt-combobox>`;
}

export function printerEditForm(options: {
  id: string;
  settings: ReceiptPrinterSettings;
  saving: boolean;
  change: (patch: Partial<ReceiptPrinterSettings>) => void;
  calibrate: () => void;
}): TemplateResult {
  const { id, settings, saving, change, calibrate } = options;
  const update = (event: Event, patch: Partial<ReceiptPrinterSettings>) => {
    event.stopPropagation();
    if ((event.currentTarget as HTMLElement).isConnected) change(patch);
  };
  return html`
    <div class="printer-edit-paper">
      <wt-combobox
        name="printer-paper-width"
        label=${t("printers.paper_width")}
        ?disabled=${saving}
        .value=${settings.paperWidth}
        .options=${[
          { value: "58mm", label: t("printers.paper_width_58") },
          { value: "80mm", label: t("printers.paper_width_80") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: Printer["paperWidth"] }>) =>
          update(event, { paperWidth: event.detail.value })}
      ></wt-combobox>
      <wt-combobox
        name="printer-resolution"
        label=${t("printers.resolution")}
        ?disabled=${saving}
        .value=${settings.resolution}
        .options=${[
          { value: "180dpi", label: t("printers.resolution_180") },
          { value: "203dpi", label: t("printers.resolution_203") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: Printer["resolution"] }>) =>
          update(event, { resolution: event.detail.value })}
      ></wt-combobox>
    </div>
    <p class="printer-edit-calibration">
      <a
        data-test="edit-printer-calibrate"
        data-own-click
        href="/printers/view/printers/printer/${encodePathSegment(id)}/editor/calibrate/step/1"
        aria-disabled=${saving ? "true" : nothing}
        tabindex=${saving ? -1 : nothing}
        @click=${(event: MouseEvent) => {
          if (!saving && leftToBrowser(event)) return;
          event.preventDefault();
          if (!saving) calibrate();
        }}
        >${t("printers.calibrate")}</a
      >
      ${t("printers.edit_calibrate_hint")}
    </p>
    <wt-switch
      name="printer-cash-drawer"
      label=${t("printers.drawer_attached")}
      ?disabled=${saving}
      .checked=${settings.hasCashDrawer}
      @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
        update(event, { hasCashDrawer: event.detail.checked })}
    ></wt-switch>
    <div class="switch-field">
      <wt-switch
        name="printer-portable"
        label=${t("printers.portable")}
        description=${t("printers.portable_hint")}
        ?disabled=${saving}
        .checked=${settings.portable}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
          update(event, { portable: event.detail.checked })}
      ></wt-switch>
      <p class="hint" aria-hidden="true">${t("printers.portable_hint")}</p>
    </div>
    ${
      settings.portable
        ? printerPickupRolesField(settings.pickupRoles, saving, (pickupRoles) =>
            change({ pickupRoles }),
          )
        : nothing
    }
  `;
}
