import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi } from "../api/client.js";
import type { OtherCardMachine, OtherCardMachinesView } from "../api/payments-api.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

const NAME_MAX = 60;

interface Row {
  key: string;
  id?: string;
  name: string;
  paysInto: OtherCardMachine["paysInto"];
}

let nextKey = 0;
const newKey = () => `row-${nextKey++}`;
const sameRow = (a: Row, b: Row) => a.id === b.id && a.name === b.name && a.paysInto === b.paysInto;
const sameRows = (a: readonly Row[], b: readonly Row[]) =>
  a.length === b.length && a.every((row, index) => sameRow(row, b[index]!));
const nameKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

function nameChecks(rows: readonly Row[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (key === "") errors[row.key] = t("other_card_machines.name_required");
    else if (seen.has(key)) errors[row.key] = t("other_card_machines.name_repeated");
    seen.add(key);
  }
  return errors;
}

@customElement("dashboard-other-card-machines")
export class OtherCardMachinesPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        display: grid;
        gap: var(--wt-space-3);
      }
      h2,
      p {
        margin: 0;
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .rows {
        display: grid;
        gap: var(--wt-space-3);
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1.5fr) auto;
        gap: var(--wt-space-3);
        align-items: start;
      }
      .row .muted {
        grid-column: 1 / -1;
        grid-row: 2;
      }
      .row wt-button {
        margin-top: calc((var(--wt-field-height) - var(--wt-tap-min)) / 2);
      }
      @media (max-width: 640px) {
        .rows {
          gap: var(--wt-space-5);
        }
        .row {
          grid-template-columns: minmax(0, 1fr);
        }
        .row + .row {
          padding-top: var(--wt-space-5);
          border-top: 1px solid var(--wt-color-border);
        }
        .row .muted {
          grid-row: auto;
        }
        .row wt-button {
          justify-self: start;
          margin-top: 0;
        }
        .rows + .add {
          margin-top: var(--wt-space-3);
          padding-top: var(--wt-space-5);
          border-top: 1px solid var(--wt-color-border);
        }
      }
      .add wt-button {
        justify-self: start;
      }
      .add {
        display: grid;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  /** Undefined while it is not known whether SumUp is connected. */
  @property({ attribute: false }) sumUpConnected?: boolean;
  @state() private draft?: Row[];
  @state() private saving = false;
  @state() private refusals: Record<string, string> = {};
  @state() private readError = "";
  @state() private saveError = "";
  #revision = 0;
  #baseline: Row[] = [];
  #latest?: OtherCardMachinesView;
  #scope?: DraftScope<Row[]>;
  #generation = 0;
  #discards = 0;
  readonly #feedback = new FormFeedback(this);
  #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeOf(error);
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#queries
      .watch("getOtherCardMachines", [], (view) => this.#received(view))
      .catch(() => {});
  }

  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = this.#latest = undefined;
    this.saving = false;
    this.#feedback.reset();
    this.refusals = {};
    this.readError = this.saveError = "";
    super.disconnectedCallback();
  }

  #take(view: OtherCardMachinesView): OtherCardMachinesView {
    if (this.#latest === undefined || view.revision >= this.#latest.revision) this.#latest = view;
    return this.#latest;
  }

  #received(view: OtherCardMachinesView): void {
    const latest = this.#take(view);
    if (latest !== view) return;
    this.readError = "";
    if (!this.saving && !this.#scope?.isDirty()) this.#resetDraft(view);
    else if (
      sameRows(
        this.#baseline,
        view.otherCardMachines.map((machine) => ({ key: "", ...machine })),
      )
    )
      this.#revision = view.revision;
  }

  #resetDraft(view: OtherCardMachinesView): void {
    const keys = new Map(this.draft?.map((row) => [row.id, row.key]));
    this.#revision = view.revision;
    this.#baseline = view.otherCardMachines.map((machine) => ({
      key: keys.get(machine.id) ?? newKey(),
      ...machine,
    }));
    this.draft = this.#baseline.map((row) => ({ ...row }));
    this.#feedback.reset();
    this.refusals = {};
    if (this.#scope === undefined) {
      const { scope } = draftScopeFor<Row[]>(this, {
        id: this,
        current: () => this.draft!,
        snapshot: (rows) => rows.map((row) => ({ ...row })),
        equal: sameRows,
        restore: () => {
          this.#discards++;
          this.saveError = "";
          this.#resetDraft(this.#latest!);
        },
      });
      this.#scope = scope;
    }
    this.#scope.commit(this.draft);
  }

  #edit(rows: Row[], refusalKey?: string): void {
    if (this.saving) return;
    this.draft = rows;
    this.saveError = "";
    if (refusalKey !== undefined) this.#feedback.dismiss(refusalKey);
    this.#scope?.changed();
    if (!this.#scope?.isDirty() && this.#latest) this.#resetDraft(this.#latest);
  }

  #update(key: string, change: Partial<Row>): void {
    this.#edit(
      this.draft!.map((row) => (row.key === key ? { ...row, ...change } : row)),
      "name" in change ? key : undefined,
    );
  }

  #add(): void {
    this.#edit([...this.draft!, { key: newKey(), name: "", paysInto: "other" }]);
  }

  #remove(key: string): void {
    this.#edit(
      this.draft!.filter((row) => row.key !== key),
      key,
    );
  }

  async #save(): Promise<void> {
    const draft = this.draft;
    if (draft === undefined || this.saving || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press();
    this.refusals = {};
    this.saveError = "";
    if (Object.keys(nameChecks(draft)).length > 0) {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    this.saving = true;
    const generation = this.#generation;
    const discards = this.#discards;
    try {
      const saved = await this.api.saveOtherCardMachines({
        otherCardMachines: draft.map(({ id, name, paysInto }) =>
          id === undefined ? { name, paysInto } : { id, name, paysInto },
        ),
        revision: this.#revision,
      });
      if (generation !== this.#generation) return;
      this.#scope?.commit(draft);
      this.#resetDraft(this.#take(saved));
      this.api.liveData?.invalidate([{ type: "settings.payments" }]);
    } catch (error) {
      if (generation !== this.#generation) return;
      if (discards === this.#discards) await this.#refused(error, draft, generation);
      else if (codeOf(error) === "settings.out_of_date") await this.#reload(generation);
    } finally {
      if (generation === this.#generation) this.saving = false;
    }
  }

  async #refused(error: unknown, draft: Row[], generation: number): Promise<void> {
    const code = codeOf(error);
    const named = /^otherCardMachines\.(\d+)\.name$/.exec(fieldOf(error));
    const row = named ? draft[Number(named[1])] : undefined;
    if (code === "management.request_invalid" && row !== undefined) {
      this.refusals = { [row.key]: t("other_card_machines.name_refused") };
      this.#feedback.newRefusal();
      this.saving = false;
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    this.saveError = code;
    if (code !== "settings.out_of_date") return;
    try {
      const view = await this.api.getOtherCardMachines();
      if (generation !== this.#generation) return;
      const before = this.#baseline;
      this.#resetDraft(this.#take(view));
      this.draft = this.#merge(draft, before);
      this.#scope?.changed();
      this.saveError = "other_card_machines.refreshed";
    } catch (refreshError) {
      if (generation === this.#generation) this.saveError = codeOf(refreshError);
    }
  }

  async #reload(generation: number): Promise<void> {
    try {
      const view = await this.api.getOtherCardMachines();
      if (generation === this.#generation) this.#resetDraft(this.#take(view));
    } catch (error) {
      if (generation === this.#generation) this.saveError = codeOf(error);
    }
  }

  #merge(draft: readonly Row[], before: readonly Row[]): Row[] {
    const latest = new Map(this.#baseline.map((row) => [row.id, row]));
    const original = new Map(before.map((row) => [row.id, row]));
    const merged = draft.flatMap((row): Row[] => {
      const was = row.id === undefined ? undefined : original.get(row.id);
      if (was === undefined) return [row];
      const renamed = row.name !== was.name;
      const moved = row.paysInto !== was.paysInto;
      const current = latest.get(row.id);
      if (current === undefined)
        return renamed || moved ? [{ key: row.key, name: row.name, paysInto: row.paysInto }] : [];
      return [
        {
          ...current,
          key: row.key,
          name: renamed ? row.name : current.name,
          paysInto: moved ? row.paysInto : current.paysInto,
        },
      ];
    });
    return [
      ...merged,
      ...this.#baseline.filter((row) => !original.has(row.id)).map((r) => ({ ...r })),
    ];
  }

  #row(row: Row, index: number, errors: Record<string, string>) {
    const choices = [
      { value: "connected_account", label: t("other_card_machines.connected_account") },
      { value: "other", label: t("other_card_machines.other") },
    ];
    return html`<div
      class="row"
      role="group"
      aria-label=${row.name.trim() || t("other_card_machines.new_machine")}
    >
      <wt-input
        name=${`name-${index}`}
        label=${t("other_card_machines.name")}
        required
        maxlength=${NAME_MAX}
        .value=${row.name}
        .error=${errors[row.key] ?? ""}
        ?disabled=${this.saving}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#update(row.key, { name: event.detail.value });
        }}
      ></wt-input>
      <wt-combobox
        name=${`paysInto-${index}`}
        label=${t("other_card_machines.pays_into")}
        required
        search="never"
        .options=${choices}
        .value=${row.paysInto}
        ?disabled=${this.saving}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#update(row.key, { paysInto: event.detail.value as Row["paysInto"] });
        }}
      ></wt-combobox>
      ${
        row.paysInto === "connected_account" && this.sumUpConnected === false
          ? html`<p class="muted">${t("other_card_machines.not_connected_note")}</p>`
          : nothing
      }
      <wt-button
        variant="secondary"
        aria-label=${
          row.name.trim()
            ? fill("other_card_machines.remove", { name: row.name.trim() })
            : t("other_card_machines.remove_new")
        }
        ?disabled=${this.saving}
        @click=${() => this.#remove(row.key)}
        >${t("action.remove")}</wt-button
      >
    </div>`;
  }

  #message(errors: Record<string, string>): string {
    if (Object.keys(errors).length > 0) return t("form.fix_fields");
    const error = this.saveError || this.readError;
    if (error === "other_card_machines.refreshed") return t("other_card_machines.refreshed");
    return error && codeMessage(error);
  }

  override render() {
    const draft = this.draft;
    const checks = draft !== undefined && this.#feedback.attempted ? nameChecks(draft) : {};
    const errors = { ...this.#feedback.remaining(this.refusals), ...checks };
    const action = saveActionState(this.#scope);
    return html`<section aria-labelledby="other-card-machines-heading">
      <h2 id="other-card-machines-heading">${t("other_card_machines.heading")}</h2>
      <p class="muted">${t("other_card_machines.intro")}</p>
      ${
        draft === undefined
          ? this.readError
            ? nothing
            : html`<p role="status">${t("other_card_machines.loading")}</p>`
          : html`${
                draft.length === 0
                  ? html`<p class="muted">${t("other_card_machines.empty")}</p>`
                  : nothing
              }
              ${
                draft.length === 0
                  ? nothing
                  : html`<div class="rows">
                      ${repeat(
                        draft,
                        (row) => row.key,
                        (row, index) => this.#row(row, index, errors),
                      )}
                    </div>`
              }
              <div class="add">
                <wt-button variant="secondary" ?disabled=${this.saving} @click=${() => this.#add()}
                  >${t("other_card_machines.add")}</wt-button
                >
              </div>`
      }
      <wt-form-actions .error=${this.#message(errors)}>
        <wt-button
          variant=${action.variant}
          ?disabled=${action.unchanged || this.saving || Object.keys(checks).length > 0}
          ?loading=${this.saving}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-other-card-machines": OtherCardMachinesPanel;
  }
}
