import { type TemplateResult, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { WtButton } from "@waitron/ui";
import type { Printer } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { renderSwitchGroup } from "./device-profile-switch-group.js";

export type PrinterListKey =
  "receiptPrinterIds" | "paymentSlipPrinterIds" | "cashDrawerPrinterIds" | "invoicePrinterIds";
type PrinterDefaultKey =
  | "receiptPrinterDefaultId"
  | "paymentSlipPrinterDefaultId"
  | "cashDrawerPrinterDefaultId"
  | "invoicePrinterDefaultId";

export interface PrinterList {
  key: PrinterListKey;
  defaultKey: PrinterDefaultKey;
  test: string;
  heading: StringKey;
  defaultLabel: StringKey;
}

export interface PrinterChoice {
  printer: Pick<Printer, "id" | "name">;
  listed: boolean;
  label: string;
}

interface PrinterListEntry<L extends PrinterList> {
  list: L;
  choices: readonly PrinterChoice[];
  listError: string | undefined;
  defaultError: string;
  defaultValue: string;
}

interface PrinterListsProps<L extends PrinterList> {
  loading: boolean;
  reading: boolean;
  readFailed: boolean;
  lists: readonly PrinterListEntry<L>[];
  onPrinterToggle: (
    event: CustomEvent<{ checked: boolean }>,
    list: L,
    printerId: string,
    visible: readonly string[],
  ) => void;
  onMovePrinter: (
    list: L,
    drawn: readonly string[],
    visible: readonly string[],
    printerId: string,
    by: -1 | 1,
    button: WtButton,
  ) => void;
  onPrinterDefault: (event: CustomEvent<{ value: string }>, list: L) => void;
}

interface ReaderChoice {
  id: string;
  label: string;
  listed: boolean;
}

interface ReadersProps {
  choices: readonly ReaderChoice[];
  defaultValue: string;
  error: string;
  onReaderToggle: (
    event: CustomEvent<{ checked: boolean }>,
    readerId: string,
    visible: readonly string[],
  ) => void;
  onReaderDefault: (event: CustomEvent<{ value: string }>) => void;
}

const printerIdOf = ({ printer }: PrinterChoice) => printer.id;

function renderDefaultPicker(
  test: string,
  name: string,
  label: string,
  options: readonly { value: string; label: string }[],
  value: string,
  error: string,
  onChange: (event: CustomEvent<{ value: string }>) => void,
): TemplateResult {
  return html`<wt-combobox
    class="field"
    data-test=${test}
    name=${name}
    label=${label}
    search="auto"
    show-empty-option
    searchPlaceholder=${t("categories.combobox_search")}
    noResultsLabel=${t("categories.combobox_no_results")}
    .options=${[{ value: "", label: t("device_profiles.default_none") }, ...options]}
    .value=${value}
    .error=${error}
    .invalid=${error !== ""}
    @wt-change=${onChange}
  ></wt-combobox>`;
}

function renderMoveButton(
  test: string,
  direction: "up" | "down",
  printer: PrinterChoice["printer"],
  disabled: boolean,
  onClick: (button: WtButton) => void,
): TemplateResult {
  const label = t(`device_profiles.move_${direction}`);
  return html`<wt-button
    variant="ghost"
    size="sm"
    data-test="${test}-${direction}-${printer.id}"
    aria-label="${label} ${printer.name}"
    ?disabled=${disabled}
    @click=${(event: Event) => onClick(event.currentTarget as WtButton)}
    >${label}</wt-button
  >`;
}

function renderPrinterList<L extends PrinterList>(
  { list, choices, listError, defaultError, defaultValue }: PrinterListEntry<L>,
  { onPrinterToggle, onMovePrinter, onPrinterDefault }: PrinterListsProps<L>,
): TemplateResult {
  const visible = choices.map(printerIdOf);
  const drawn = choices.filter((choice) => choice.listed).map(printerIdOf);
  const move = (printerId: string, by: -1 | 1) => (button: WtButton) =>
    onMovePrinter(list, drawn, visible, printerId, by, button);
  return html`${renderSwitchGroup(
    list.test,
    t(list.heading),
    listError,
    html`${repeat(choices, printerIdOf, ({ printer, listed, label }) => {
      const position = drawn.indexOf(printer.id);
      return html`<div class="printer-choice">
        <wt-switch
          data-test="${list.test}-${printer.id}"
          data-printer-id=${printer.id}
          name=${list.key}
          label=${label}
          .checked=${listed}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
            onPrinterToggle(e, list, printer.id, visible)}
        ></wt-switch>
        ${
          listed
            ? html`<span class="order"
                >${renderMoveButton(list.test, "up", printer, position === 0, move(printer.id, -1))}
                ${renderMoveButton(
                  list.test,
                  "down",
                  printer,
                  position === drawn.length - 1,
                  move(printer.id, 1),
                )}</span
              >`
            : nothing
        }
      </div>`;
    })}`,
  )}
  ${renderDefaultPicker(
    `${list.test}-default`,
    list.defaultKey,
    t(list.defaultLabel),
    choices
      .filter((choice) => choice.listed)
      .map(({ printer, label }) => ({ value: printer.id, label })),
    defaultValue,
    defaultError,
    (e) => onPrinterDefault(e, list),
  )}`;
}

export function renderDeviceProfilePrinterLists<L extends PrinterList>(
  props: PrinterListsProps<L>,
): TemplateResult | typeof nothing {
  const { loading, reading, readFailed, lists } = props;
  const empty = lists.every(({ choices }) => choices.length === 0);
  const unread = empty && readFailed;
  // The failed read is the form's bottom message.
  if (unread && !reading) return nothing;
  if (loading || unread)
    return html`<p class="field" role="status" data-test="printers-loading">
      <wt-spinner decorative size="sm"></wt-spinner> ${t("device_profiles.printers_loading")}
    </p>`;
  if (empty)
    return html`<p class="field" data-test="no-printers">${t("device_profiles.no_printers")}</p>`;
  return html`${lists.map((entry) => renderPrinterList(entry, props))}`;
}

export function renderDeviceProfileReaders({
  choices,
  defaultValue,
  error,
  onReaderToggle,
  onReaderDefault,
}: ReadersProps): TemplateResult {
  const visible = choices.map(({ id }) => id);
  return html`${renderSwitchGroup(
    "profile-readers",
    t("device_profiles.card_readers"),
    undefined,
    html`${repeat(
      choices,
      ({ id }) => id,
      (reader) =>
        html`<wt-switch
          data-test="profile-reader-${reader.id}"
          name="readerIds"
          label=${reader.label}
          .checked=${reader.listed}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) =>
            onReaderToggle(e, reader.id, visible)}
        ></wt-switch>`,
    )}`,
  )}
  ${renderDefaultPicker(
    "profile-readers-default",
    "defaultReaderId",
    t("device_profiles.reader_default"),
    choices
      .filter(({ listed }) => listed)
      .map((reader) => ({ value: reader.id, label: reader.label })),
    defaultValue,
    error,
    onReaderDefault,
  )}`;
}
