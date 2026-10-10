import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { foldCache, languageDisplayName, searchFor } from "@waitron/shared";
import { tableNoMatches, QueryController } from "@waitron/dashboard-kit";
import { QUERY_DEPENDENCIES } from "../api/live-queries.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type {
  DashboardApi,
  TranslationBatch,
  TranslationPage,
  TranslationTarget,
  TranslationGapKind,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import { sameValue } from "./product-editor-model.js";
import {
  TranslationDrafts,
  translationKey,
  type FieldFault,
  type ReviewChoice,
} from "./content-translations-model.js";

const KINDS: readonly TranslationGapKind[] = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
];
const label = (row: TranslationTarget) =>
  row.parent && row.kind !== "menu" ? `${row.parent.name} › ${row.name}` : row.name;

function editorHref(row: TranslationTarget): string {
  const id = encodeURIComponent(row.id);
  const parent = encodeURIComponent(row.parent?.id ?? "");
  switch (row.kind) {
    case "product":
    case "variant":
      return `/manage/catalogue/product/${id}`;
    case "option_list":
      return `/manage/modifiers/view/options/list/${id}`;
    case "option_label":
      return `/manage/modifiers/view/options/list/${parent}`;
    case "extra_list":
      return `/manage/modifiers/view/extras/list/${id}`;
    case "menu":
    case "section":
    case "included_menu":
      return `/manage/menus/menu/${parent}/view/structure`;
    case "unit":
      return "/manage/units";
  }
}

@customElement("dashboard-content-translations-dialog")
export class ContentTranslationsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .filters > * {
        flex: 1;
        min-width: 14ch;
      }
      .counts,
      .pages {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
      }
      .help {
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(translation-meta) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(translation-row) {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 24ch), 1fr));
        gap: var(--wt-space-4);
        inline-size: min(70ch, 50dvw);
      }
      wt-data-table::part(translation-fields) {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      wt-data-table::part(translation-link) {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary);
      }
      wt-data-table::part(translation-name) {
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property() language = "";
  @property({ type: Boolean }) open = false;
  @state() private loading = false;
  @state() private readError = "";
  @state() private actionError = "";
  @state() private busy = false;
  @state() private attempted = false;
  @state() private search = "";
  @state() private kinds: string[] = [];
  @state() private why = "";
  @state() private editedOnly = false;
  @state() private page = 0;
  @state() private model?: TranslationDrafts;
  @state() private refused: FieldFault[] = [];
  @state() private reviewing = false;
  @state() private reviewRows: TranslationTarget[] = [];
  #choices = new Map<string, ReviewChoice>();
  #snapshotRevision = 0;
  #generation = 0;
  readonly #queries = new QueryController(
    this,
    () => this.api?.liveData,
    () => {
      if (this.open) {
        this.readError = t("content_gaps.load_error");
        this.loading = false;
      }
    },
  );
  #scope?: DraftScope<TranslationBatch>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.busy &&
    (!this.#leave ||
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
    if (this.open && this.model) void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#snapshotRevision++;
    this.busy = false;
    this.reviewing = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("open") || (changed.has("language") && this.open)) {
      this.#generation++;
      this.#snapshotRevision++;
      this.#queries.release("translations");
      this.reviewing = false;
      this.reviewRows = [];
      this.#choices.clear();
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.model = undefined;
      this.search = "";
      this.kinds = [];
      this.why = "";
      this.page = 0;
      this.editedOnly = false;
      this.busy = false;
      this.attempted = false;
      this.refused = [];
      this.actionError = "";
      this.readError = "";
      if (this.open) void this.#load();
    }
    if (this.open && this.model && this.isConnected && !this.#scope) {
      const { coordinator, scope } = draftScopeFor<TranslationBatch>(this, {
        id: this,
        current: () => this.model!.submission(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: () => {
          this.model!.reset();
          this.refused = [];
          this.attempted = false;
          this.requestUpdate();
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit({ edits: [] });
    }
  }

  async #scan(generation: number) {
    const revision = ++this.#snapshotRevision;
    const language = this.language;
    const client = this.api.background ?? this.api;
    const read = async (query: Parameters<DashboardApi["getContentTranslationTargets"]>[1]) => {
      try {
        return await client.getContentTranslationTargets(language, query);
      } catch (error) {
        if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
          return undefined;
        throw error;
      }
    };
    const rows: TranslationTarget[] = [];
    const retained: TranslationTarget[] = [];
    let next: string | null = null;
    let first: TranslationPage | undefined;
    const seen = new Set<string>();
    const check = (value: TranslationPage) => {
      if (
        value.language !== language ||
        (first &&
          (!sameValue([...value.config.languages].sort(), [...first.config.languages].sort()) ||
            value.config.defaultLanguage !== first.config.defaultLanguage ||
            !sameValue([...value.required].sort(), [...first.required].sort())))
      )
        throw new Error("translation scan changed");
      first ??= value;
    };
    do {
      const value = await read(next === null ? {} : { after: next });
      if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
        return undefined;
      if (!value) return undefined;
      check(value);
      rows.push(...value.rows);
      next = value.next;
      if (next !== null && seen.has(next)) throw new Error("translation scan repeated");
      if (next !== null) seen.add(next);
    } while (next !== null);
    const refs =
      this.model?.rows
        .filter((row) => this.model!.isEdited(row))
        .map(({ kind, id }) => ({ kind, id })) ?? [];
    for (let offset = 0; offset < refs.length; offset += 50) {
      const value = await read({ targets: refs.slice(offset, offset + 50) });
      if (generation !== this.#generation || revision !== this.#snapshotRevision || !this.open)
        return undefined;
      if (!value) return undefined;
      check(value);
      retained.push(...value.rows);
    }
    return { generation, revision, rows, retained, config: first!.config };
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    this.loading = !this.model;
    try {
      await this.#queries.watch(
        "translations",
        {
          key: JSON.stringify(["translation-scan", this.language, generation]),
          dependencies: QUERY_DEPENDENCIES.getContentTranslationTargets.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => this.#scan(generation),
        },
        (value) => {
          if (
            !value ||
            generation !== this.#generation ||
            value.revision !== this.#snapshotRevision ||
            !this.open
          )
            return;
          if (this.model)
            this.model.snapshot(value.rows, value.retained, value.config.defaultLanguage);
          else
            this.model = new TranslationDrafts(
              this.language,
              value.config.defaultLanguage,
              value.rows,
            );
          this.page = Math.min(this.page, Math.max(0, Math.ceil(this.#visible().length / 50) - 1));
          this.readError = "";
          this.loading = false;
          this.reviewRows = this.reviewRows.length
            ? [
                ...value.rows,
                ...value.retained.filter(
                  (row) => !value.rows.some((gap) => translationKey(gap) === translationKey(row)),
                ),
              ]
            : [];
          this.reviewing = false;
          this.#choices.clear();
          this.requestUpdate();
        },
      );
    } catch {
      if (generation === this.#generation && this.open)
        this.readError = t("content_gaps.load_error");
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }
  async #review(): Promise<void> {
    if (this.busy || this.reviewing || !this.model) return;
    const generation = this.#generation;
    this.reviewing = true;
    const pending = this.#scan(generation);
    const revision = this.#snapshotRevision;
    try {
      const value = await pending;
      if (!value || generation !== this.#generation || value.revision !== this.#snapshotRevision)
        return;
      this.model.snapshot(value.rows, value.retained, value.config.defaultLanguage);
      this.reviewRows = [
        ...value.rows,
        ...value.retained.filter(
          (row) => !value.rows.some((gap) => translationKey(gap) === translationKey(row)),
        ),
      ];
      this.#choices.clear();
      this.readError = "";
      const changed = this.model.rows.find((row) => this.model!.changed(row));
      if (!changed) this.#applyReview();
      else if (!this.#visible().includes(changed))
        await this.#reveal({
          target: { kind: changed.kind, id: changed.id },
          field: "text",
          message: "review",
        });
      this.requestUpdate();
    } catch {
      if (generation === this.#generation && revision === this.#snapshotRevision && this.open)
        this.readError = t("content_gaps.load_error");
    } finally {
      if (generation === this.#generation && revision === this.#snapshotRevision)
        this.reviewing = false;
    }
  }
  #applyReview(): void {
    this.model!.review(this.reviewRows, this.#choices);
    if (!this.model!.rows.some((row) => this.model!.changed(row))) this.reviewRows = [];
    this.#scope?.changed();
    this.refused = [];
    this.attempted = false;
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.#visible().length / 50) - 1));
    this.requestUpdate();
  }
  #choose(row: TranslationTarget, choice: ReviewChoice): void {
    this.#choices.set(translationKey(row), choice);
    this.#applyReview();
  }
  readonly #folded = foldCache<TranslationTarget>();
  #visible(): TranslationTarget[] {
    const rows = this.model?.rows ?? [];
    if (this.editedOnly) return rows.filter((row) => this.model!.isEdited(row));
    return searchFor(this.search)(
      rows
        .filter(
          (row) =>
            (this.kinds.length === 0 || this.kinds.includes(row.kind)) &&
            (!this.why || row.reason === this.why),
        )
        .map((row) => [row, this.#folded(row, label(row))] as const),
    );
  }
  #showEdited(): void {
    this.editedOnly = !this.editedOnly;
    this.page = 0;
  }
  #change(
    row: TranslationTarget,
    field: "text" | "defaultText",
    event: CustomEvent<{ value: string }>,
  ): void {
    event.stopPropagation();
    this.model!.edit(row, field, event.detail.value);
    this.refused = this.refused.filter(
      (f) => translationKey(f.target) !== translationKey(row) || f.field !== field,
    );
    this.#scope?.changed();
    this.requestUpdate();
  }
  #faults(): FieldFault[] {
    return [...(this.attempted ? (this.model?.validate() ?? []) : []), ...this.refused];
  }
  async #reveal(fault: FieldFault): Promise<void> {
    this.search = "";
    this.kinds = [];
    this.why = "";
    this.editedOnly = false;
    this.page = Math.floor(
      this.model!.rows.findIndex((row) => translationKey(row) === translationKey(fault.target)) /
        50,
    );
    await this.updateComplete;
    const table = this.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const input = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[name="translation-${fault.field}-${fault.target.kind}-${CSS.escape(fault.target.id)}"]`,
    );
    await input?.updateComplete;
    input?.focus();
  }
  async #save(): Promise<void> {
    if (
      this.busy ||
      this.loading ||
      this.reviewing ||
      !this.model ||
      saveActionState(this.#scope).unchanged
    )
      return;
    this.attempted = true;
    this.refused = [];
    this.actionError = "";
    const faults = this.model.validate();
    if (faults.length) {
      await this.#reveal(faults[0]!);
      return;
    }
    const submitted = this.model.submission();
    const generation = this.#generation;
    this.busy = true;
    try {
      const result = await this.api.saveContentTranslations(this.language, submitted);
      if (generation !== this.#generation || !this.open) return;
      this.#queries.release("translations");
      this.#scope?.commit(submitted);
      this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
      this.open = false;
      this.dispatchEvent(
        new CustomEvent("translations-saved", { detail: result, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation !== this.#generation || !this.open) return;
      const params = (error as { params?: Record<string, unknown> }).params ?? {};
      const row = this.model.rows.find((row) => row.kind === params.kind && row.id === params.id);
      const field = params.field;
      const expectedLanguage = field === "defaultText" ? this.model.defaultLanguage : this.language;
      const message = codeMessage(
        typeof params.causeCode === "string" ? params.causeCode : codeOf(error),
      );
      if (
        row &&
        (field === "text" || field === "defaultText") &&
        (params.language === undefined || params.language === expectedLanguage) &&
        (field !== "defaultText" || this.model.needsDefault(row))
      ) {
        const fault: FieldFault = { target: { kind: row.kind, id: row.id }, field, message };
        this.refused = [fault];
        await this.#reveal(fault);
      } else this.actionError = message;
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("translations-closed", { bubbles: true, composed: true }));
  }
  #openEditor(event: MouseEvent, row: TranslationTarget): void {
    if ((row.kind !== "product" && row.kind !== "variant") || leftToBrowser(event)) return;
    event.preventDefault();
    const proceed = () => {
      this.dispatchEvent(
        new CustomEvent("wt-edit-product", {
          detail: { productId: row.id },
          bubbles: true,
          composed: true,
        }),
      );
    };
    if (this.#leave) void this.#leave.request({ scopes: [this], reason: "navigation", proceed });
    else proceed();
  }
  #name(language: string): string {
    return languageDisplayName(language, currentLocale());
  }
  #heldColumns?: { key: string; value: DataTableColumn<TranslationTarget>[] };
  #columns(): DataTableColumn<TranslationTarget>[] {
    const key = JSON.stringify([currentLocale(), this.language, this.model?.defaultLanguage]);
    if (this.#heldColumns?.key === key) return this.#heldColumns.value;
    const value: DataTableColumn<TranslationTarget>[] = [
      {
        key: "name",
        label: t("content_gaps.name"),
        cell: (row) =>
          html`<div part="translation-row">
            <div>
              <span part="translation-name">${label(row)}</span>
              <span part="translation-meta"
                >${t(`content_gaps.kind_${row.kind}`)} · ${t(`content_gaps.${row.reason}`)}</span
              >
              <span part="translation-meta"
                >${t(row.kind === "included_menu" ? "translations.scope_include" : row.kind === "menu" || row.kind === "section" ? "translations.scope_menu" : "translations.scope_shared")}</span
              >
              ${this.model!.changed(row) ? html`<span part="translation-meta" data-test=${`changed-${row.kind}-${row.id}`}>${t("translations.changed")}</span>` : nothing}
              ${row.eligible && this.model!.current(row)?.eligible !== false ? nothing : html`<span part="translation-meta" data-test=${`unavailable-${row.kind}-${row.id}`}>${t("translations.unavailable")}</span>`}
            </div>
            <div part="translation-fields">
              ${this.#input(row, "text")}
              ${this.reviewRows.length && this.model!.changed(row) ? this.#reviewCell(row) : nothing}
              ${this.model!.needsDefault(row) && (this.model!.value(row, "text").trim() || this.model!.value(row, "defaultText").trim()) ? html`<span part="translation-meta">${t("translations.default_needed").replace("{language}", this.#name(this.model!.defaultLanguage))}</span>${this.#input(row, "defaultText")}` : nothing}
            </div>
          </div>`,
      },
      {
        key: "open",
        label: t("content_gaps.open"),
        pinned: "end",
        cell: (row) =>
          html`<a
            part="translation-link"
            ?data-own-click=${row.kind === "product" || row.kind === "variant"}
            href=${editorHref(row)}
            aria-label=${t("content_gaps.open_named").replace("{name}", label(row))}
            @click=${(event: MouseEvent) => this.#openEditor(event, row)}
            >${t("content_gaps.open")}</a
          >`,
      },
    ];
    this.#heldColumns = { key, value };
    return value;
  }
  #reviewCell(row: TranslationTarget) {
    const current = this.model!.current(row);
    return html`<div part="translation-meta" data-test=${`review-${row.kind}-${row.id}`}>
      <p>${t("translations.old")}: ${row.selectedText ?? "—"}</p>
      <p>
        ${t("translations.current")}:
        ${current?.effectiveSelectedText ?? current?.selectedText ?? "—"}
      </p>
      <p>${t("translations.draft")}: ${this.model!.value(row, "text")}</p>
      ${this.model!.needsDefault(row) ? html`<p>${this.#name(this.model!.defaultLanguage)} · ${t("translations.old")}: ${row.effectiveDefaultText ?? "—"} · ${t("translations.current")}: ${current?.effectiveDefaultText ?? "—"} · ${t("translations.draft")}: ${this.model!.value(row, "defaultText")}</p>` : nothing}
      ${(["keep", "replace", "discard"] as const).map(
        (choice) =>
          html`<wt-button
            data-test=${`${choice}-${row.kind}-${row.id}`}
            variant="secondary"
            ?disabled=${choice === "keep" && (!current?.eligible || !sameValue(current.owners, row.owners))}
            @click=${() => this.#choose(row, choice)}
            >${t(`translations.${choice}`)}</wt-button
          >`,
      )}
    </div>`;
  }
  #input(row: TranslationTarget, field: "text" | "defaultText") {
    const language = field === "text" ? this.language : this.model!.defaultLanguage;
    const fault = this.#faults().find(
      (f) => translationKey(f.target) === translationKey(row) && f.field === field,
    );
    const message = fault
      ? ["required", "name_bytes", "batch_bytes", "review"].includes(fault.message)
        ? t(`translations.${fault.message}` as "translations.required")
        : fault.message
      : "";
    return html`<wt-input
      name=${`translation-${field}-${row.kind}-${row.id}`}
      lang=${language}
      required
      label=${this.#name(language)}
      placeholder=${row.name}
      .value=${this.model!.value(row, field)}
      .error=${message}
      ?disabled=${this.busy || !row.eligible || (this.model!.count >= 100 && !this.model!.isEdited(row))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(row, field, event)}
    ></wt-input>`;
  }
  override render() {
    const visible = this.#visible();
    const shown = visible.slice(this.page * 50, (this.page + 1) * 50);
    const count = this.model?.count ?? 0;
    const hidden =
      this.model?.rows.filter((row) => this.model!.isEdited(row) && !shown.includes(row)).length ??
      0;
    const action = saveActionState(this.#scope);
    const faults = this.#faults();
    return html`<wt-modal
      data-test="translations-dialog"
      size="wide"
      .open=${this.open}
      .beforeClose=${this.#beforeClose}
      heading=${`${t("content_languages.edit_translations")} · ${this.language ? this.#name(this.language) : ""}`}
      @wt-close=${this.#closed}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
    >
      <p class="help">${t("translations.help")}</p>
      ${this.loading ? html`<p role="status" data-test="loading">${t("content_gaps.loading")}</p>` : nothing}
      ${
        this.readError
          ? html`<p role="alert" data-test="read-error">${this.readError}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("content_languages.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.model
          ? html`
              <div class="filters">
                <wt-combobox
                  name="kind"
                  searchPlaceholder=${t("categories.combobox_search")}
                  noResultsLabel=${t("categories.combobox_no_results")}
                  label=${t("content_gaps.kind")}
                  multiple
                  show-empty-option
                  .values=${this.kinds}
                  .countLabel=${(count: number) => t("content_gaps.kind_count").replace("{count}", String(count))}
                  .options=${[{ value: "", label: t("content_gaps.kind_all") }, ...KINDS.filter((kind) => this.model!.rows.some((row) => row.kind === kind)).map((kind) => ({ value: kind, label: t(`content_gaps.kind_${kind}`) }))]}
                  @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
                    event.stopPropagation();
                    this.kinds = event.detail.values;
                    this.editedOnly = false;
                    this.page = 0;
                  }}
                ></wt-combobox>
                <wt-combobox
                  name="why"
                  searchPlaceholder=${t("categories.combobox_search")}
                  noResultsLabel=${t("categories.combobox_no_results")}
                  label=${t("content_gaps.reason")}
                  show-empty-option
                  .value=${this.why}
                  .options=${[{ value: "", label: t("content_gaps.reason_all") }, ...["partial", "absent"].filter((reason) => this.model!.rows.some((row) => row.reason === reason)).map((reason) => ({ value: reason, label: t(`content_gaps.${reason}` as "content_gaps.partial") }))]}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.why = event.detail.value;
                    this.editedOnly = false;
                    this.page = 0;
                  }}
                ></wt-combobox>
                <wt-input
                  name="search"
                  label=${t("content_gaps.search")}
                  .value=${this.search}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.search = event.detail.value;
                    this.editedOnly = false;
                    this.page = 0;
                  }}
                ></wt-input>
              </div>
              <p class="help">${t("translations.reasons")}</p>
              <div class="counts">
                ${this.model.arrivals ? html`<span data-test="arrivals">${t("translations.arrivals").replace("{count}", String(this.model.arrivals))}</span>` : nothing}
                <wt-button
                  data-test="review"
                  ?disabled=${this.reviewing || this.busy}
                  variant="secondary"
                  @click=${() => void this.#review()}
                  >${t("translations.review_latest")}</wt-button
                >
                <span data-test="edited-count"
                  >${t("translations.edited").replace("{count}", String(count))}</span
                ><span data-test="hidden-count"
                  >${t("translations.hidden").replace("{count}", String(hidden))}</span
                ><wt-button
                  data-test="show-edited"
                  variant=${count ? "primary" : "secondary"}
                  ?disabled=${count === 0}
                  @click=${this.#showEdited}
                  >${t(this.editedOnly ? "translations.show_all" : "translations.show_edited")}</wt-button
                >
              </div>
              ${count >= 100 ? html`<p role="status">${t("translations.capacity")}</p>` : nothing}
              ${this.model.rows.length === 0 ? html`<p data-test="complete">${t("content_gaps.complete").replace("{language}", languageDisplayName(this.language, currentLocale(), false))}</p>` : html`<wt-data-table aria-label=${t("content_gaps.table").replace("{language}", this.#name(this.language))} emptyMessage=${tableNoMatches()} noMatchesMessage=${tableNoMatches()} .rows=${shown} .columns=${this.#columns()} .rowKey=${translationKey}></wt-data-table>`}
              ${
                visible.length > 50
                  ? html`<div class="pages">
                      <wt-button
                        data-test="previous"
                        variant="secondary"
                        ?disabled=${this.page === 0}
                        @click=${() => this.page--}
                        >${t("translations.previous")}</wt-button
                      ><span
                        >${t("translations.page")
                          .replace("{page}", String(this.page + 1))
                          .replace("{pages}", String(Math.ceil(visible.length / 50)))}</span
                      ><wt-button
                        data-test="next"
                        variant="secondary"
                        ?disabled=${(this.page + 1) * 50 >= visible.length}
                        @click=${() => this.page++}
                        >${t("translations.next")}</wt-button
                      >
                    </div>`
                  : nothing
              }
            `
          : nothing
      }
      <wt-form-actions
        slot="footer"
        .error=${[faults.length ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
      >
        <wt-button
          data-test="close"
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("action.close")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.loading || this.busy || this.reviewing || (this.attempted && Boolean(this.model?.validate().length))}
          @click=${() => void this.#save()}
          >${t("translations.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-translations-dialog": ContentTranslationsDialog;
  }
}
