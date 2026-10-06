import { codeOf } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  LOCAL_HOLIDAY_NAME_MAX,
  type HolidayGeography,
  type LocalHoliday,
  type LocalHolidayModel,
} from "../holiday-types.js";
import { holidayAddressKey, localHolidayName } from "../holiday-rules.js";
import type { LocalDate } from "../hours-types.js";
import type { HoursApi } from "./hours-client.js";
import { browserToday, format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";

type ReturnTo = () => HTMLElement | null;
type Editor =
  | {
      kind: "entry";
      id: string | null;
      date: string;
      name: string;
      /**
       * A new entry's address when the dialog opened, or the last one the dialog warned about, by
       * `holidayAddressKey`: the server files it under the address current when it arrives.
       */
      address?: string | null;
    }
  | { kind: "remove"; entry: LocalHoliday }
  | { kind: "forget"; geography: HolidayGeography };

const yearOf = (date: LocalDate) => Number(date.slice(0, 4));

/** The limit sentence for `year`, or for any year when the refusal named none. */
function limitSentence(limit: number, year?: number): string {
  if (year === undefined)
    return format(limit === 1 ? "holidays.local_limit_any_one" : "holidays.local_limit_any", {
      limit: String(limit),
    });
  return format(limit === 1 ? "holidays.local_limit_one" : "holidays.local_limit", {
    limit: String(limit),
    year: String(year),
  });
}

/**
 * The venue's own local holidays: the address they belong to, its holiday area where the official
 * list needs one, the year's allowance, the entries, and notices for an earlier address's entries.
 */
@customElement("local-holidays-editor")
export class LocalHolidaysEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        margin-block-start: var(--wt-space-5);
      }
      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .note {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      [role="alert"] {
        color: var(--wt-color-danger);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .area {
        margin-block: var(--wt-space-3);
      }
      .retained {
        display: grid;
        gap: var(--wt-space-2);
        margin: var(--wt-space-3) 0 0;
        padding: 0;
        list-style: none;
      }
      .retained li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) api!: HoursApi;
  @property({ type: Boolean }) readOnly = false;
  /** The venue's date, whose year the allowance line counts; the browser's while it is unknown. */
  @property({ attribute: false }) today: LocalDate | null = null;
  @state() private model?: LocalHolidayModel;
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private attempted = false;
  /** The server's refusal of a field, until the operator changes that field or saves again. */
  @state() private refused: Record<string, string> = {};
  /** A refusal that names no field the editor shows, until the operator saves again. */
  @state() private bottomRefusal = "";
  @state() private busy = false;
  @state() private areaError = "";
  @state() private areaBusy = false;

  #detach?: () => void;
  /** Each editor opened or closed is a new generation; an answer for an older one is dropped. */
  #generation = 0;
  #areaGeneration = 0;
  #returnTo?: ReturnTo;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#detach = this.api.watchLocalHolidays(
      (model) => {
        if (this.model && holidayAddressKey(this.model.venue) !== holidayAddressKey(model.venue)) {
          this.#areaGeneration++;
          this.areaError = "";
          this.areaBusy = false;
        }
        this.model = model;
        this.readError = "";
      },
      () => {
        this.readError = t("holidays.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detach?.();
    this.#detach = undefined;
  }

  #resolved(model: LocalHolidayModel): boolean {
    return model.venue.city !== null && model.venue.provinceCode !== null;
  }

  #canEnter(model: LocalHolidayModel): boolean {
    return this.#resolved(model) && model.localEntryLimit > 0;
  }

  #year(): number {
    return yearOf(this.today ?? browserToday());
  }

  // --- Editors -------------------------------------------------------------------------------

  #open(editor: Editor, returnTo: ReturnTo): void {
    this.#generation++;
    this.#returnTo = returnTo;
    this.editor = editor;
    this.attempted = false;
    this.refused = {};
    this.bottomRefusal = "";
    this.busy = false;
  }

  #close(): void {
    this.#generation++;
    this.editor = undefined;
    this.attempted = false;
    this.refused = {};
    this.bottomRefusal = "";
    this.busy = false;
    const returnTo = this.#returnTo;
    void this.updateComplete.then(() => returnTo?.()?.focus());
  }

  #menuTrigger(event: Event): ReturnTo {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    menu.hide();
    const trigger = menu.shadowRoot!.querySelector<HTMLElement>("button");
    return () => trigger;
  }

  #check(editor: Editor): Record<string, string> {
    if (editor.kind !== "entry") return {};
    const errors: Record<string, string> = {};
    const others = (this.model?.entries ?? []).filter((entry) => entry.id !== editor.id);
    const limit = this.model?.localEntryLimit ?? 0;
    if (editor.date === "") errors.holidayDate = t("hours.date_required");
    else if (others.some((entry) => entry.date === editor.date))
      errors.holidayDate = format("holidays.date_taken", { date: formatDate(editor.date) });
    else if (others.filter((entry) => yearOf(entry.date) === yearOf(editor.date)).length >= limit)
      errors.holidayDate = limitSentence(limit, yearOf(editor.date));
    if (editor.name.trim() === "") errors.holidayName = t("hours.name_required");
    else if (localHolidayName(editor.name) === null)
      errors.holidayName = format("holidays.name_too_long", {
        max: String(LOCAL_HOLIDAY_NAME_MAX),
      });
    return errors;
  }

  #submit(): void {
    const editor = this.editor!;
    this.attempted = true;
    this.refused = {};
    this.bottomRefusal = "";
    if (Object.keys(this.#check(editor)).length > 0) {
      void this.#focusInvalid();
      return;
    }
    if (editor.kind === "entry" && editor.id === null) {
      const { venue } = this.model!;
      const address = holidayAddressKey(venue);
      if (address !== null && address !== editor.address) {
        this.editor = { ...editor, address };
        this.bottomRefusal = format("holidays.address_moved", { city: venue.city! });
        return;
      }
    }
    void this.#write(editor);
  }

  #send(editor: Editor): Promise<unknown> {
    switch (editor.kind) {
      case "entry":
        return this.api.saveLocalHoliday(editor.id, {
          date: editor.date,
          name: editor.name.trim(),
        });
      case "remove":
        return this.api.deleteLocalHoliday(editor.entry.id);
      case "forget":
        return this.api.deleteRetainedGeography(editor.geography.id);
    }
  }

  async #write(editor: Editor): Promise<void> {
    const generation = this.#generation;
    this.busy = true;
    try {
      await this.#send(editor);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.busy = false;
      this.#refuse(editor, error);
      return;
    }
    if (generation === this.#generation) this.#close();
    this.api.rereadWatches();
  }

  #refuse(editor: Editor, error: unknown): void {
    const code = codeOf(error);
    const params = ((error as { params?: Record<string, unknown> }).params ?? {}) as {
      field?: string;
      date?: string;
      limit?: number;
      year?: number;
    };
    const field = (name: string, sentence: string) => {
      this.refused = { [name]: sentence };
      void this.#focusInvalid();
    };
    if (code === "holiday.not_found") this.bottomRefusal = t("holidays.not_found");
    else if (code === "holiday_geography.not_found")
      this.bottomRefusal = t("holidays.geography_not_found");
    else if (code === "holiday.geography_current")
      this.bottomRefusal = t("holidays.geography_current");
    else if (editor.kind !== "entry") this.bottomRefusal = t("hours.save_error");
    else if (code === "holiday.date_taken")
      field(
        "holidayDate",
        format("holidays.date_taken", { date: formatDate(params.date ?? editor.date) }),
      );
    else if (code === "holiday.local_limit") {
      const limit = params.limit ?? 0;
      if (limit === 0) this.bottomRefusal = t("holidays.unsupported");
      else if (params.year === undefined) this.bottomRefusal = limitSentence(limit);
      else field("holidayDate", limitSentence(limit, params.year));
    } else if (code === "holiday.invalid" && params.field === "date")
      field("holidayDate", t("holidays.check_date"));
    else if (code === "holiday.invalid" && params.field === "name")
      field("holidayName", t("holidays.check_name"));
    else if (code === "holiday.invalid" && params.field === "id")
      this.bottomRefusal = t("holidays.stale_id");
    else if (code === "holiday.invalid" && params.field === "geography")
      this.bottomRefusal = t("holidays.needs_address");
    else this.bottomRefusal = t("hours.save_error");
  }

  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector("wt-modal")!);
  }

  #setEntry(patch: { date?: string; name?: string }, name: string): void {
    const editor = this.editor as Extract<Editor, { kind: "entry" }>;
    if (name in this.refused)
      this.refused = Object.fromEntries(
        Object.entries(this.refused).filter(([field]) => field !== name),
      );
    this.editor = { ...editor, ...patch };
  }

  #content(editor: Editor, errors: Record<string, string>) {
    switch (editor.kind) {
      case "entry": {
        const city = this.model!.venue.city;
        return {
          heading:
            editor.id !== null
              ? t("holidays.edit_heading")
              : city === null
                ? t("holidays.add_heading")
                : format("holidays.add_heading_city", { city }),
          body: html`<wt-input
              type="date"
              name="holidayDate"
              required
              label=${t("hours.date")}
              .value=${editor.date}
              error=${errors.holidayDate ?? ""}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) =>
                this.#setEntry({ date: event.detail.value }, "holidayDate")}
            ></wt-input>
            <wt-input
              name="holidayName"
              required
              label=${t("hours.name")}
              hint=${t("holidays.name_hint")}
              .value=${editor.name}
              error=${errors.holidayName ?? ""}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) =>
                this.#setEntry({ name: event.detail.value }, "holidayName")}
            ></wt-input>`,
          save: t("hours.save"),
          danger: false,
        };
      }
      case "remove":
        return {
          heading: t("holidays.remove_heading"),
          body: html`<p data-test="confirm-text">
            ${format("holidays.remove_confirm", {
              name: editor.entry.name,
              date: formatDate(editor.entry.date),
            })}
          </p>`,
          save: t("hours.remove"),
          danger: true,
        };
      case "forget":
        return {
          heading: t("holidays.forget_heading"),
          body: html`<p data-test="confirm-text">
            ${format("holidays.forget_confirm", { city: editor.geography.city })}
          </p>`,
          save: t("hours.remove"),
          danger: true,
        };
    }
  }

  #modal() {
    const editor = this.editor;
    if (editor === undefined) return nothing;
    const own = this.attempted ? this.#check(editor) : {};
    const errors = { ...this.refused, ...own };
    const content = this.#content(editor, errors);
    const marked = Object.keys(errors).length > 0;
    return keyed(
      this.#generation,
      html`<wt-modal
        open
        size="compact"
        heading=${content.heading}
        .dismissible=${!this.busy}
        @wt-close=${() => this.#close()}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector('[data-test="save-local"]'))}
      >
        <div class="form">${content.body}</div>
        <wt-form-actions
          slot="footer"
          .error=${[this.bottomRefusal, marked ? t("hours.fix_fields") : ""]
            .filter((message) => message !== "")
            .join(" ")}
        >
          <wt-button
            slot="cancel"
            variant="secondary"
            data-test="cancel-local"
            ?disabled=${this.busy}
            @click=${() => {
              if (!this.busy) this.#close();
            }}
            >${t("hours.cancel")}</wt-button
          >
          <wt-button
            data-test="save-local"
            variant=${content.danger ? "danger" : "primary"}
            ?disabled=${this.busy || Object.keys(own).length > 0}
            @click=${() => this.#submit()}
            >${content.save}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`,
    );
  }

  // --- The holiday area ----------------------------------------------------------------------

  async #saveArea(areaKey: string): Promise<void> {
    const generation = ++this.#areaGeneration;
    this.areaError = "";
    this.areaBusy = true;
    try {
      await this.api.saveHolidayArea(areaKey);
    } catch (error) {
      if (generation !== this.#areaGeneration) return;
      this.areaBusy = false;
      const field = (error as { params?: { field?: string } }).params?.field;
      this.areaError =
        codeOf(error) !== "holiday.invalid"
          ? t("hours.save_error")
          : field === "geography"
            ? t("holidays.needs_address")
            : t("holidays.area_refused");
      return;
    }
    if (generation === this.#areaGeneration) this.areaBusy = false;
    this.api.rereadWatches();
  }

  #area(model: LocalHolidayModel) {
    if (model.areaOptions.length === 0) return nothing;
    const chosen = model.geographies.find((geography) => geography.matchesVenue)?.areaKey ?? null;
    const note = html`<p class="note" data-test="area-note">${t("holidays.area_note")}</p>`;
    if (this.readOnly) {
      const name = model.areaOptions.find(({ key }) => key === chosen)?.name;
      return html`${note}
        <p data-test="area-chosen">
          ${name === undefined ? t("holidays.area_none") : format("holidays.area_chosen", { name })}
        </p>`;
    }
    return html`${note}
      <div class="area">
        <wt-combobox
          name="holidayArea"
          search="never"
          label=${t("holidays.area")}
          hint=${t("holidays.area_hint")}
          ?required=${model.areaRequired}
          .options=${model.areaOptions.map(({ key, name }) => ({ value: key, label: name }))}
          .value=${chosen ?? ""}
          error=${this.areaError}
          ?disabled=${!this.#resolved(model) || this.areaBusy}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            void this.#saveArea(event.detail.value)}
        ></wt-combobox>
      </div>`;
  }

  // --- The section ---------------------------------------------------------------------------

  #addressText(model: LocalHolidayModel): string {
    const { city, provinceCode } = model.venue;
    if (model.localEntryLimit === 0) return t("holidays.unsupported");
    if (provinceCode === null)
      return t(city === null ? "holidays.needs_address" : "holidays.needs_province");
    if (city === null)
      return t(model.areaOptions.length > 0 ? "holidays.needs_city_area" : "holidays.needs_city");
    return format(model.localEntryLimit === 1 ? "holidays.address_one" : "holidays.address", {
      city,
      limit: String(model.localEntryLimit),
    });
  }

  #table(model: LocalHolidayModel) {
    const rowActions = (entry: LocalHoliday) =>
      html`<wt-row-actions label=${format("hours.row_actions", { name: entry.name })}>
        <wt-button
          variant="secondary"
          data-test="edit-local"
          @click=${(event: Event) =>
            this.#open(
              { kind: "entry", id: entry.id, date: entry.date, name: entry.name },
              this.#menuTrigger(event),
            )}
          >${t("hours.edit")}</wt-button
        >
        <wt-button
          variant="secondary"
          data-test="remove-local"
          @click=${(event: Event) =>
            this.#open({ kind: "remove", entry }, this.#menuTrigger(event))}
          >${t("hours.remove")}</wt-button
        >
      </wt-row-actions>`;
    const actions: DataTableColumn<LocalHoliday> = {
      key: "actions",
      label: t("hours.actions"),
      pinned: "end",
      cell: rowActions,
    };
    const columns: DataTableColumn<LocalHoliday>[] = [
      { key: "date", label: t("hours.date"), cell: (entry) => formatDate(entry.date) },
      {
        key: "name",
        label: t("hours.name"),
        cell: (entry) => html`<span part="name">${entry.name}</span>`,
      },
      ...(this.readOnly ? [] : [actions]),
    ];
    return html`<wt-data-table
      data-test="local-entries"
      aria-label=${t("holidays.heading")}
      .columns=${columns}
      .rows=${model.entries}
      .rowKey=${(entry: LocalHoliday) => entry.id}
      .emptyMessage=${t("holidays.empty")}
    ></wt-data-table>`;
  }

  #retained(model: LocalHolidayModel) {
    const retained = model.geographies.filter((geography) => !geography.matchesVenue);
    if (retained.length === 0) return nothing;
    return html`<ul class="retained" data-test="retained">
      ${retained.map(
        (geography) =>
          html`<li>
            <span>${format("holidays.retained", { city: geography.city })}</span>
            ${
              this.readOnly
                ? nothing
                : html`<wt-button
                    variant="secondary"
                    data-test=${`forget-${geography.id}`}
                    aria-label=${format("holidays.forget_label", { city: geography.city })}
                    @click=${(event: Event) => {
                      const trigger = event.currentTarget as HTMLElement;
                      this.#open({ kind: "forget", geography }, () =>
                        trigger.isConnected
                          ? trigger
                          : this.renderRoot.querySelector<HTMLElement>('[data-test="add-local"]'),
                      );
                    }}
                    >${t("hours.remove")}</wt-button
                  >`
            }
          </li>`,
      )}
    </ul>`;
  }

  override render() {
    const model = this.model;
    const year = this.#year();
    const count =
      model === undefined ? 0 : model.entries.filter(({ date }) => yearOf(date) === year).length;
    return html`<section>
      <h2 data-test="local-heading">${t("holidays.heading")}</h2>
      ${
        this.readError
          ? html`<p role="alert" data-test="local-alert">${this.readError}</p>`
          : nothing
      }
      ${
        model === undefined
          ? this.readError
            ? nothing
            : html`<p class="note" data-test="local-loading">${t("holidays.loading")}</p>`
          : html`<p data-test="local-address">${this.#addressText(model)}</p>
              ${this.#area(model)}
              ${
                this.#canEnter(model)
                  ? html`<p class="note" data-test="local-allowance">
                      ${format(
                        model.localEntryLimit === 1
                          ? "holidays.allowance_one"
                          : "holidays.allowance",
                        {
                          year: String(year),
                          count: String(count),
                          limit: String(model.localEntryLimit),
                        },
                      )}
                    </p>`
                  : nothing
              }
              ${
                this.#canEnter(model) && !this.readOnly
                  ? html`<div class="controls">
                      <wt-button
                        variant="secondary"
                        data-test="add-local"
                        @click=${() =>
                          this.#open(
                            {
                              kind: "entry",
                              id: null,
                              date: "",
                              name: "",
                              address: holidayAddressKey(model.venue),
                            },
                            () =>
                              this.renderRoot.querySelector<HTMLElement>('[data-test="add-local"]'),
                          )}
                        >${t("holidays.add")}</wt-button
                      >
                    </div>`
                  : nothing
              }
              ${this.#canEnter(model) || model.entries.length > 0 ? this.#table(model) : nothing}
              ${this.#retained(model)}`
      }
      ${this.#modal()}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "local-holidays-editor": LocalHolidaysEditor;
  }
}
