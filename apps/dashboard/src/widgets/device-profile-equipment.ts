import { type TemplateResult, html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { WtButton } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { renderGroupError, renderSwitchGroup } from "./device-profile-switch-group.js";

interface PrinterList {
  key: string;
  defaultKey: string;
  test: string;
  heading: StringKey;
  defaultLabel: StringKey;
}

interface PrinterChoice {
  printer: { id: string; name: string };
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

function renderPrinterList<L extends PrinterList>(
  { list, choices, listError, defaultError, defaultValue }: PrinterListEntry<L>,
  { onPrinterToggle, onMovePrinter, onPrinterDefault }: PrinterListsProps<L>,
): TemplateResult {
  const visible = choices.map(printerIdOf);
  const drawn = choices.filter((choice) => choice.listed).map(printerIdOf);
  return html`<div
      class="field"
      role="group"
      aria-labelledby="${list.test}-heading"
      aria-describedby=${listError ? `${list.test}-error` : nothing}
      data-test=${list.test}
    >
      <span class="panel-subtitle" id="${list.test}-heading">${t(list.heading)}</span>
      <div class="toggles">
        ${repeat(choices, printerIdOf, ({ printer, listed, label }) => {
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
                    ><wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-up-${printer.id}"
                      aria-label="${t("device_profiles.move_up")} ${printer.name}"
                      ?disabled=${position === 0}
                      @click=${(event: Event) => onMovePrinter(list, drawn, visible, printer.id, -1, event.currentTarget as WtButton)}
                      >${t("device_profiles.move_up")}</wt-button
                    >
                    <wt-button
                      variant="ghost"
                      size="sm"
                      data-test="${list.test}-down-${printer.id}"
                      aria-label="${t("device_profiles.move_down")} ${printer.name}"
                      ?disabled=${position === drawn.length - 1}
                      @click=${(event: Event) => onMovePrinter(list, drawn, visible, printer.id, 1, event.currentTarget as WtButton)}
                      >${t("device_profiles.move_down")}</wt-button
                    ></span
                  >`
                : nothing
            }
          </div>`;
        })}
      </div>
      ${renderGroupError(list.test, listError)}
    </div>
    <wt-combobox
      class="field"
      data-test="${list.test}-default"
      name=${list.defaultKey}
      label=${t(list.defaultLabel)}
      search="auto"
      show-empty-option
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .options=${[
        { value: "", label: t("device_profiles.default_none") },
        ...choices
          .filter((choice) => choice.listed)
          .map(({ printer, label }) => ({ value: printer.id, label })),
      ]}
      .value=${defaultValue}
      .error=${defaultError}
      .invalid=${defaultError !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => onPrinterDefault(e, list)}
    ></wt-combobox>`;
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
    <wt-combobox
      class="field"
      data-test="profile-readers-default"
      name="defaultReaderId"
      label=${t("device_profiles.reader_default")}
      search="auto"
      show-empty-option
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .options=${[
        { value: "", label: t("device_profiles.default_none") },
        ...choices
          .filter(({ listed }) => listed)
          .map((reader) => ({ value: reader.id, label: reader.label })),
      ]}
      .value=${defaultValue}
      .error=${error}
      .invalid=${error !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => onReaderDefault(e)}
    ></wt-combobox>`;
}
