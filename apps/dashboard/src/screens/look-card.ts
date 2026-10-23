import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import {
  CATEGORY_PALETTE,
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import {
  BACKGROUNDS,
  BUILT_IN_THEME_NAME,
  CORNER_CHOICES,
  MODES,
  THEME_COLOURS,
  WAITRON_CHOICES,
  canFixAll,
  fixAll,
  normaliseChoices,
  type Background,
  type Corners,
  type DerivedTheme,
  type Mode,
  type ThemeChoices,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { colorField, colorFieldStyles } from "../widgets/color-field.js";
import { fixLineStyles } from "../widgets/fix-line-styles.js";
import { repaintVenueTheme } from "../widgets/venue-theme-repaint.js";
import {
  codeInvalid,
  invalidHandCodes,
  isWaitronLook,
  openDraft,
  pickBrand,
  sameDraft,
  setBackground,
  setCorners,
  setHand,
  typeCode,
  typeHandCode,
  useWorkedOut,
  waitronLook,
  type HandField,
  type LookDraft,
} from "../widgets/look-draft.js";
import "../widgets/theme-advanced.js";
import type { HandAction } from "../widgets/theme-advanced.js";
import { copyName } from "../widgets/theme-names.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";
import "../widgets/hard-to-read-dialog.js";
import "../widgets/theme-name-dialog.js";
import type { ThemeNameDialog } from "../widgets/theme-name-dialog.js";
import "../widgets/theme-preview.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { ThemeEdit, ThemesChanged } from "./themes-card.js";
import {
  brandFixLabel,
  brandFixedText,
  brandWarningText,
  fixAllText,
  handNames,
  saveDialogLine,
  savedWarningLine,
} from "../widgets/theme-words.js";

const PRIMARY = "--wt-color-primary";

type Editing = { id: string; name: string } | { id: null; from: "in-use" | "new" };
type Target = "save" | "save-as-new";

function chip(colour: string): TemplateResult {
  return html`<span class="chip" aria-hidden="true" style="background:${colour}"></span>`;
}

function brandRow(view: ThemeView | undefined, choices: ThemeChoices): TemplateResult {
  const { brandColor } = choices;
  if (brandColor === null) {
    return html`${chip(WAITRON_DEFAULTS.light[PRIMARY]!)}${t("appearance.brand_waitron")}`;
  }
  const value = (CATEGORY_PALETTE as readonly string[]).includes(brandColor)
    ? brandColor
    : fill("appearance.brand_custom", { colour: brandColor });
  const fixes = MODES.flatMap((mode: Mode) => {
    const shade = choices.brandFix[mode] ? view?.[mode]?.[PRIMARY] : undefined;
    return shade === undefined
      ? []
      : [html` · ${t(`appearance.saved_fix_${mode}`)} ${chip(shade)}${shade}`];
  });
  return html`${chip(brandColor)}${value}${fixes}`;
}

const HAND_FIELDS: ReadonlySet<unknown> = new Set(
  MODES.flatMap((mode) => THEME_COLOURS.map((key): HandField => `handSet.${mode}.${key}`)),
);

function isHandField(field: unknown): field is HandField {
  return HAND_FIELDS.has(field);
}

function handRow(choices: ThemeChoices): string {
  const names = handNames(choices);
  return names.length === 0 ? t("appearance.none") : names.join(", ");
}

@customElement("dashboard-look-card")
export class LookCard extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    colorFieldStyles,
    fixLineStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .chip {
        display: inline-block;
        vertical-align: middle;
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        margin-inline-end: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .chip:not(:first-child) {
        margin-inline-start: var(--wt-space-1);
      }
      wt-button.link::part(button) {
        font-weight: var(--wt-font-weight-normal);
        text-decoration: underline;
      }
      .note {
        margin: var(--wt-space-4) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .editing-line {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      form {
        container-type: inline-size;
      }
      .editor {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-5);
        align-items: start;
      }
      .choices {
        display: grid;
        gap: var(--wt-space-4);
        min-width: 0;
      }
      .buttons {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-4);
      }
      .buttons > wt-form-actions {
        flex: 1 1 auto;
        width: auto;
      }
      .buttons > wt-form-actions.with-message {
        flex-basis: 100%;
      }
      /* Room on a phone for fonts wider than macOS's system font, such as Linux's DejaVu Sans. */
      @container (width < 300px) {
        .buttons wt-button::part(button) {
          padding-inline: var(--wt-space-2);
        }
      }
      @container (min-width: 900px) {
        .editor {
          grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        }
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) list: ThemeList | undefined;
  @property({ attribute: false }) canEdit = false;
  @state() private draft?: LookDraft;
  @state() private submitted = false;
  @state() private refusedCode = "";
  @state() private refusedHand: HandField | "" = "";
  @state() private actionError = "";
  @state() private submitting = false;
  @state() private asking = false;
  #editing?: Editing;
  #expected?: LookDraft;
  #derived?: DerivedTheme;
  #derivedFrom?: ThemeChoices;
  #scope?: DraftScope<LookDraft>;
  #leave?: LeaveCoordinator;
  #generation = 0;
  #target: Target = "save";
  /** Keys the Advanced section, so every edit session starts with it closed. */
  #session = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    this.#registerDraft();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.submitting = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("canEdit") && !this.canEdit) this.#cancel();
    if (changed.has("list")) {
      this.#followName();
      this.#adopt();
    }
    const choices = this.draft?.choices;
    if (choices && choices !== this.#derivedFrom) {
      this.#derivedFrom = choices;
      this.#derived = deriveTheme(choices);
    }
  }
  edit(target: ThemeEdit): void {
    if (!this.canEdit || this.submitting) return;
    let open: () => void;
    if ("kind" in target) {
      open = () => this.#begin({ id: null, from: "new" }, null);
    } else {
      const view = this.list?.themes.find((theme) => theme.id === target.id);
      if (!view) return;
      if (this.draft && this.#editing?.id === view.id) {
        this.#scrollIntoPlace();
        return;
      }
      open = () => {
        // Deleted while the question was open, it still opens as last read (D19).
        const latest = this.list?.themes.find((theme) => theme.id === view.id) ?? view;
        this.#begin({ id: latest.id, name: latest.name }, latest.choices);
      };
    }
    const leave = this.#leave;
    if (!this.#scope || !leave) {
      open();
      this.#scrollIntoPlace();
      return;
    }
    // A Discard closes the editor through the scope's restore before `proceed`; closing it any
    // other way while the question is open disposes the scope, and the coordinator drops the answer.
    void leave.request({
      scopes: [this],
      reason: "navigation",
      proceed: () => {
        open();
        this.#scrollIntoPlace();
      },
    });
  }
  #scrollIntoPlace(): void {
    this.scrollIntoView({ block: "start" });
  }
  #begin(editing: Editing, choices: ThemeChoices | null): void {
    this.#nameDialog()?.dismiss();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#editing = editing;
    this.#expected = openDraft(choices);
    this.draft = this.#expected;
    this.#session++;
    this.submitted = false;
    this.refusedCode = "";
    this.refusedHand = "";
    this.actionError = "";
    this.asking = false;
    this.#registerDraft();
    this.#announce(editing.id);
  }
  #announce(id: string | null): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string | null }>("look-editing", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #changed(detail: ThemesChanged): void {
    this.dispatchEvent(
      new CustomEvent<ThemesChanged>("themes-changed", { detail, bubbles: true, composed: true }),
    );
  }
  #nameDialog(): ThemeNameDialog | null {
    return this.shadowRoot?.querySelector("dashboard-theme-name-dialog") ?? null;
  }
  /** Whether the editor's theme is the one every screen shows, by the latest read. */
  #inUse(editing: Editing): boolean {
    const inUse = this.list?.inUse;
    return editing.id === null ? editing.from === "in-use" && inUse === null : inUse === editing.id;
  }
  /** Keeps the last name the list gave the open theme, which outlives its deletion elsewhere (D19). */
  #followName(): void {
    const editing = this.#editing;
    if (!editing || editing.id === null) return;
    const name = this.list?.themes.find((theme) => theme.id === editing.id)?.name;
    if (name !== undefined) editing.name = name;
  }
  #adopt(): void {
    const editing = this.#editing;
    const expected = this.#expected;
    if (!this.draft || !editing || editing.id === null || !expected) return;
    if (!sameDraft(this.draft, expected)) return;
    const view = this.list?.themes.find((theme) => theme.id === editing.id);
    if (!view) return;
    const next = openDraft(view.choices);
    if (sameDraft(next, expected)) return;
    this.#expected = next;
    this.draft = next;
    this.#scope?.commit(next);
  }
  #registerDraft(): void {
    if (!this.isConnected || !this.draft || !this.#expected || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<LookDraft>(this, {
      id: this,
      current: () => this.draft!,
      snapshot: (value) => value,
      equal: sameDraft,
      restore: () => this.#cancel(),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#expected);
  }
  #cancel(): void {
    const wasEditing = this.#editing !== undefined;
    this.#nameDialog()?.dismiss();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.#expected = undefined;
    this.#editing = undefined;
    this.submitted = false;
    this.refusedCode = "";
    this.refusedHand = "";
    this.actionError = "";
    this.asking = false;
    if (wasEditing) this.#announce(null);
  }
  #requestCancel(): void {
    if (this.submitting) return;
    const scope = this.#scope;
    if (!scope || !this.#leave) {
      this.#cancel();
      return;
    }
    void this.#leave.request({
      scopes: [this],
      reason: "cancel",
      proceed: () => {
        if (this.#scope === scope) this.#cancel();
      },
    });
  }
  #change(next: (draft: LookDraft) => LookDraft, codeChanged = false): void {
    if (!this.draft || this.submitting) return;
    this.draft = next(this.draft);
    if (codeChanged) this.refusedCode = "";
    this.actionError = "";
    this.#scope?.changed();
  }
  #hand(action: HandAction): void {
    this.#change((d) => {
      switch (action.kind) {
        case "pick":
          return setHand(d, action.mode, action.key, action.colour);
        case "type":
          return typeHandCode(d, action.mode, action.key, action.text);
        case "worked-out":
          return useWorkedOut(d, action.mode, action.key);
        default:
          return d;
      }
    });
    this.refusedHand = "";
  }
  #handErrors(draft: LookDraft): Partial<Record<HandField, string>> {
    const errors: Partial<Record<HandField, string>> = {};
    if (this.submitted) {
      for (const field of invalidHandCodes(draft)) errors[field] = t("appearance.bad_code");
    }
    if (this.refusedHand) errors[this.refusedHand] = t("appearance.bad_code");
    return errors;
  }
  #setBrandFix(mode: Mode, taken: boolean): void {
    this.#change((d) => {
      const brandFix = Object.fromEntries(
        MODES.filter((m) => (m === mode ? taken : d.choices.brandFix[m])).map((m) => [m, true]),
      ) as ThemeChoices["brandFix"];
      return { ...d, choices: { ...d.choices, brandFix } };
    });
  }
  #brandLines(draft: LookDraft, busy: boolean): TemplateResult[] {
    const derived = this.#derived!;
    return MODES.flatMap((mode: Mode) => {
      if (draft.choices.brandFix[mode]) {
        return [
          html`<p class="undo-line">
            <span class="fixed-text" data-test="brand-fixed-${mode}"
              >${brandFixedText(mode, derived[mode][PRIMARY]!)} </span
            ><span class="dot" aria-hidden="true">· </span
            ><wt-button
              data-test="brand-undo-${mode}"
              class="link"
              variant="ghost"
              size="sm"
              ?disabled=${busy}
              @click=${() => this.#setBrandFix(mode, false)}
              >${t("appearance.undo")}</wt-button
            >
          </p>`,
        ];
      }
      const warning = derived.warnings.find((w) => w.field === "brandColor" && w.mode === mode);
      if (!warning) return [];
      return [
        html`<p class="warning" data-test="brand-warning-${mode}">
            <wt-icon name="warning"></wt-icon><span>${brandWarningText(mode)}</span>
          </p>
          ${
            warning.fix === null
              ? nothing
              : html`<p class="fixed">
                  <wt-button
                    data-test="brand-fix-${mode}"
                    size="sm"
                    ?disabled=${busy}
                    @click=${() => this.#setBrandFix(mode, true)}
                    >${brandFixLabel(mode, warning.fix)}</wt-button
                  >
                </p>`
          }`,
      ];
    });
  }
  #fixAllLine(busy: boolean): TemplateResult | typeof nothing {
    const warnings = this.#derived!.warnings;
    if (warnings.filter((warning) => warning.fix !== null).length < 2) return nothing;
    return html`<p class="warning">
      <wt-icon name="warning"></wt-icon
      ><span data-test="fix-all-line">${fixAllText(warnings.length)}</span>
      <wt-button
        data-test="fix-all"
        size="sm"
        ?disabled=${busy}
        @click=${() =>
          this.#change((d) => ({ ...d, choices: fixAll(WAITRON_DEFAULTS, d.choices) }))}
        >${t("appearance.fix_all")}</wt-button
      >
    </p>`;
  }
  async #save(target: Target): Promise<void> {
    const draft = this.draft;
    if (this.submitting || !draft || !this.#editing) return;
    if (target === "save" && saveActionState(this.#scope).unchanged) return;
    this.#target = target;
    this.submitted = true;
    this.refusedCode = "";
    this.refusedHand = "";
    this.actionError = "";
    if (codeInvalid(draft) || invalidHandCodes(draft).length > 0) {
      await this.#focusInvalid();
      return;
    }
    if (this.#derived!.warnings.length > 0) this.asking = true;
    else await this.#send();
  }
  #fixAndSave(): void {
    if (this.submitting) return;
    this.#change((d) => ({ ...d, choices: fixAll(WAITRON_DEFAULTS, d.choices) }));
    void this.#send();
  }
  async #send(): Promise<void> {
    const draft = this.draft;
    const editing = this.#editing;
    this.asking = false;
    if (this.submitting || !draft || !editing) return;
    if (editing.id === null || this.#target === "save-as-new") {
      this.#askName(draft, editing);
      return;
    }
    const generation = this.#generation;
    const scope = this.#scope;
    this.submitting = true;
    try {
      const answer = await this.api.saveTheme(editing.id, normaliseChoices(draft.choices));
      if (generation !== this.#generation) return;
      if (this.list?.inUse === editing.id) repaintVenueTheme(this.api);
      this.#changed({ kind: "saved", theme: answer });
      if (scope === this.#scope) this.#cancel();
    } catch (error) {
      if (generation !== this.#generation || scope !== this.#scope) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      this.submitting = false;
      if (code === "theme.invalid" && field === "brandColor") {
        this.refusedCode = t("appearance.bad_code");
        await this.#focusInvalid();
      } else if (code === "theme.invalid" && isHandField(field)) {
        this.refusedHand = field;
        await this.#focusInvalid();
      } else this.actionError = codeMessage(code);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }
  #askName(draft: LookDraft, editing: Editing): void {
    const choices = normaliseChoices(draft.choices);
    const scope = this.#scope;
    const asNew = editing.id !== null;
    this.#nameDialog()?.show({
      kind: asNew ? "save-as-new" : "first-save",
      name: asNew ? copyName(this.#name(editing)) : "",
      inUse: this.#inUse(editing),
      warningLines: deriveTheme(draft.choices).warnings.map((warning) =>
        saveDialogLine(warning, draft.choices),
      ),
      opener: this.#targetButton(),
      submit: async ({ name, inUse }) => {
        const generation = this.#generation;
        this.submitting = true;
        try {
          const created = await this.api.createTheme({ name, theme: choices, inUse });
          if (generation !== this.#generation) return;
          if (inUse) repaintVenueTheme(this.api);
          this.#changed({ kind: "created", theme: created, inUse });
          if (scope === this.#scope) this.#cancel();
        } finally {
          if (generation === this.#generation) this.submitting = false;
        }
      },
    });
  }
  #targetButton(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>(`[data-test=${this.#target}]`) ?? null;
  }
  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    const form = this.shadowRoot!.querySelector("form");
    if (form) await focusFirstInvalid(form);
  }
  #dialog(draft: LookDraft): TemplateResult {
    const warnings = this.asking ? this.#derived!.warnings : [];
    return html`<dashboard-hard-to-read-dialog
      .open=${this.asking}
      .lines=${warnings.map((warning) => saveDialogLine(warning, draft.choices))}
      .canFix=${this.asking && canFixAll(WAITRON_DEFAULTS, draft.choices)}
      .opener=${this.#targetButton()}
      @hard-to-read-back=${() => {
        this.asking = false;
      }}
      @hard-to-read-save-anyway=${() => void this.#send()}
      @hard-to-read-fix-and-save=${() => this.#fixAndSave()}
    ></dashboard-hard-to-read-dialog>`;
  }
  #form(draft: LookDraft): TemplateResult {
    const editing = this.#editing!;
    const inUse = this.#inUse(editing);
    const name = this.#name(editing);
    const badForm = this.submitted && (codeInvalid(draft) || invalidHandCodes(draft).length > 0);
    const codeError =
      this.submitted && codeInvalid(draft) ? t("appearance.bad_code") : this.refusedCode;
    const handErrors = this.#handErrors(draft);
    const message =
      codeError || Object.keys(handErrors).length > 0 ? t("form.fix_fields") : this.actionError;
    const saveAction = saveActionState(this.#scope);
    const busy = this.submitting;
    return html`<p class="editing-line" data-test="editing-line">
        ${inUse ? fill("appearance.editing_in_use", { name }) : t("appearance.editing_not_in_use")}
      </p>
      <form
        @submit=${(event: Event) => {
          event.preventDefault();
          void this.#save("save");
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
      >
        <div class="editor">
          <div class="choices">
            ${colorField({
              color: draft.choices.brandColor,
              busy,
              error: "",
              name: "brandColorPicker",
              errorId: "brand-color-error",
              legend: t("appearance.brand"),
              noneChoice: {
                label: t("appearance.brand_waitron"),
                chip: WAITRON_DEFAULTS.light[PRIMARY]!,
              },
              change: (colour) => this.#change((d) => pickBrand(d, colour, this.#expected), true),
              code: {
                name: "brandColor",
                label: t("appearance.brand_code"),
                value: draft.code,
                error: codeError,
                change: (text) => this.#change((d) => typeCode(d, text, this.#expected), true),
              },
            })}
            ${this.#brandLines(draft, busy)}
            <wt-segmented-control
              name="background"
              label=${t("appearance.background")}
              .options=${BACKGROUNDS.map((value) => ({
                value,
                label: t(`appearance.background.${value}`),
              }))}
              .value=${draft.choices.background}
              ?disabled=${busy}
              @wt-change=${(event: CustomEvent<{ value: Background }>) => {
                event.stopPropagation();
                this.#change((d) => setBackground(d, event.detail.value));
              }}
            ></wt-segmented-control>
            <wt-segmented-control
              name="corners"
              label=${t("appearance.corners")}
              .options=${CORNER_CHOICES.map((value) => ({
                value,
                label: t(`appearance.corners.${value}`),
              }))}
              .value=${draft.choices.corners}
              ?disabled=${busy}
              @wt-change=${(event: CustomEvent<{ value: Corners }>) => {
                event.stopPropagation();
                this.#change((d) => setCorners(d, event.detail.value));
              }}
            ></wt-segmented-control>
          </div>
          <dashboard-theme-preview .theme=${this.#derived!} .name=${name}></dashboard-theme-preview>
        </div>
        ${keyed(
          this.#session,
          html`<dashboard-theme-advanced
            .draft=${draft}
            .derived=${this.#derived!}
            .errors=${handErrors}
            ?busy=${busy}
            @hand-change=${(event: CustomEvent<HandAction>) => {
              event.stopPropagation();
              this.#hand(event.detail);
            }}
          ></dashboard-theme-advanced>`,
        )}
        ${this.#fixAllLine(busy)}
        <div class="buttons">
          <wt-button
            data-test="use-waitron"
            variant="secondary"
            ?disabled=${busy || isWaitronLook(draft)}
            @click=${() => this.#change(() => waitronLook(), true)}
            >${t("appearance.use_waitron")}</wt-button
          >
          <wt-form-actions class=${message ? "with-message" : ""} .error=${message}>
            ${
              editing.id === null
                ? nothing
                : html`<wt-button
                    slot="secondary"
                    data-test="save-as-new"
                    variant="secondary"
                    ?disabled=${busy || badForm}
                    @click=${() => void this.#save("save-as-new")}
                    >${t("appearance.save_as_new")}</wt-button
                  >`
            }
            <wt-button
              slot="secondary"
              data-test="cancel"
              variant="secondary"
              ?disabled=${busy}
              @click=${() => this.#requestCancel()}
              >${t("action.cancel")}</wt-button
            >
            <wt-button
              data-test="save"
              variant=${saveAction.variant}
              ?loading=${busy}
              ?disabled=${saveAction.unchanged || busy || badForm}
              @click=${() => void this.#save("save")}
              >${t("action.save")}</wt-button
            >
          </wt-form-actions>
        </div>
      </form>
      ${this.#dialog(draft)}`;
  }

  #name(editing: Editing): string {
    if (editing.id === null) {
      return editing.from === "in-use" ? BUILT_IN_THEME_NAME : t("appearance.add_theme");
    }
    return editing.name;
  }
  #heading(editing: Editing): string {
    if (this.#inUse(editing)) return t("appearance.look");
    if (editing.id === null) return t("appearance.add_theme");
    return fill("appearance.edit_theme_heading", { name: this.#name(editing) });
  }

  override render() {
    const list = this.list;
    if (list === undefined) return nothing;
    return html`${this.#card(list)}<dashboard-theme-name-dialog></dashboard-theme-name-dialog>`;
  }
  #card(list: ThemeList): TemplateResult {
    const draft = this.draft;
    if (draft) {
      return settingsCard({
        id: "look-card",
        heading: this.#heading(this.#editing!),
        editing: true,
        action: nothing,
        body: this.#form(draft),
      });
    }
    const view =
      list.inUse === null ? undefined : list.themes.find((theme) => theme.id === list.inUse);
    const choices = view?.choices ?? WAITRON_CHOICES;
    const warnings = view?.warnings ?? [];
    return settingsCard({
      id: "look-card",
      heading: t("appearance.look"),
      editing: false,
      action: this.canEdit
        ? html`<wt-button
            data-test="edit"
            @click=${() =>
              view
                ? this.#begin({ id: view.id, name: view.name }, view.choices)
                : this.#begin({ id: null, from: "in-use" }, WAITRON_CHOICES)}
            >${t("action.edit")}</wt-button
          >`
        : nothing,
      body: html`${settingsRows([
          {
            label: t("appearance.theme_in_use"),
            value: view?.name ?? BUILT_IN_THEME_NAME,
            dataTest: "saved-theme",
          },
          {
            label: t("appearance.brand"),
            value: brandRow(view, choices),
            dataTest: "saved-brand",
          },
          {
            label: t("appearance.background"),
            value: t(`appearance.background.${choices.background}`),
            dataTest: "saved-background",
          },
          {
            label: t("appearance.corners"),
            value: t(`appearance.corners.${choices.corners}`),
            dataTest: "saved-corners",
          },
          {
            label: t("appearance.colours_by_hand"),
            value: handRow(choices),
            dataTest: "saved-hand",
          },
        ])}
        ${warnings.map(
          (warning) =>
            html`<p class="warning" data-test="saved-warning">
              <wt-icon name="warning"></wt-icon><span>${savedWarningLine(warning)}</span>
            </p>`,
        )}
        <p class="note" data-test="look-note">${t("appearance.note")}</p>`,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-look-card": LookCard;
  }
}
