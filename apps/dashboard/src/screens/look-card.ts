import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  CATEGORY_PALETTE,
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
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
import {
  codeInvalid,
  isWaitronLook,
  openDraft,
  pickBrand,
  sameDraft,
  setBackground,
  setCorners,
  typeCode,
  waitronLook,
  type LookDraft,
} from "../widgets/look-draft.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";
import "../widgets/theme-preview.js";
import { savedWarningLine, themeColourName } from "../widgets/theme-words.js";

const PRIMARY = "--wt-color-primary";

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

function handRow(choices: ThemeChoices): string {
  const names = MODES.flatMap((mode: Mode) =>
    THEME_COLOURS.filter((key) => choices.handSet[mode][key] !== undefined).map((key) =>
      fill("appearance.hand_item", {
        name: themeColourName(key),
        mode: t(`appearance.mode.${mode}`),
      }),
    ),
  );
  return names.length === 0 ? t("appearance.none") : names.join(", ");
}

@customElement("dashboard-look-card")
export class LookCard extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    colorFieldStyles,
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
      .warning {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-warning);
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
  @state() private actionError = "";
  @state() private submitting = false;
  #editing?: { id: string; name: string };
  #expected?: LookDraft;
  #derived?: DerivedTheme;
  #derivedFrom?: ThemeChoices;
  #scope?: DraftScope<LookDraft>;
  #leave?: LeaveCoordinator;
  #generation = 0;

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
    const choices = this.draft?.choices;
    if (choices && choices !== this.#derivedFrom) {
      this.#derivedFrom = choices;
      this.#derived = deriveTheme(choices);
    }
  }
  #begin(view: ThemeView): void {
    this.#editing = { id: view.id, name: view.name };
    this.#expected = openDraft(view.choices);
    this.draft = this.#expected;
    this.submitted = false;
    this.refusedCode = "";
    this.actionError = "";
    this.#registerDraft();
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
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.#expected = undefined;
    this.#editing = undefined;
    this.submitted = false;
    this.refusedCode = "";
    this.actionError = "";
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
  async #save(): Promise<void> {
    const draft = this.draft;
    const editing = this.#editing;
    if (this.submitting || !draft || !editing) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.submitted = true;
    this.refusedCode = "";
    this.actionError = "";
    if (codeInvalid(draft)) {
      await this.#focusInvalid();
      return;
    }
    const generation = this.#generation;
    const scope = this.#scope;
    this.submitting = true;
    try {
      const answer = await this.api.saveTheme(editing.id, normaliseChoices(draft.choices));
      if (generation !== this.#generation) return;
      this.dispatchEvent(
        new CustomEvent("look-saved", { detail: answer, bubbles: true, composed: true }),
      );
      if (scope === this.#scope) this.#cancel();
    } catch (error) {
      if (generation !== this.#generation || scope !== this.#scope) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      this.submitting = false;
      if (code === "theme.invalid" && field === "brandColor") {
        this.refusedCode = t("appearance.bad_code");
        await this.#focusInvalid();
      } else this.actionError = codeMessage(code);
    } finally {
      if (generation === this.#generation) this.submitting = false;
    }
  }
  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    const form = this.shadowRoot!.querySelector("form");
    if (form) await focusFirstInvalid(form);
  }
  #form(draft: LookDraft): TemplateResult {
    const editing = this.#editing!;
    const inUse = this.list?.inUse === editing.id;
    const name = this.list?.themes.find((theme) => theme.id === editing.id)?.name ?? editing.name;
    const badCode = this.submitted && codeInvalid(draft);
    const codeError = badCode ? t("appearance.bad_code") : this.refusedCode;
    const saveAction = saveActionState(this.#scope);
    const busy = this.submitting;
    return html`<p class="editing-line" data-test="editing-line">
        ${inUse ? fill("appearance.editing_in_use", { name }) : t("appearance.editing_not_in_use")}
      </p>
      <form
        @submit=${(event: Event) => {
          event.preventDefault();
          void this.#save();
        }}
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
        <wt-form-actions .error=${codeError ? t("form.fix_fields") : this.actionError}>
          <wt-button
            slot="cancel"
            data-test="use-waitron"
            variant="secondary"
            ?disabled=${busy || isWaitronLook(draft)}
            @click=${() => this.#change(() => waitronLook(), true)}
            >${t("appearance.use_waitron")}</wt-button
          >
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
            ?disabled=${saveAction.unchanged || busy || badCode}
            @click=${() => void this.#save()}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </form>`;
  }

  override render() {
    const list = this.list;
    if (list === undefined) return nothing;
    const draft = this.draft;
    if (draft) {
      return settingsCard({
        id: "look-card",
        heading: t("appearance.look"),
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
      action:
        view && this.canEdit
          ? html`<wt-button data-test="edit" @click=${() => this.#begin(view)}
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
