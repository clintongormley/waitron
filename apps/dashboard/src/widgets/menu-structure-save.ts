import { html, nothing, type LitElement, type ReactiveController } from "lit";
import {
  FormFeedback,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
import { QueryController } from "@waitron/dashboard-kit";
import type { MenuStructureSaveInput, MenuStructureSaveResult } from "@waitron/shared";
import { isProductPrice } from "@waitron/menu/src/modifier-limits.js";
import type { DashboardApi, MenuPriceRow } from "../api/client.js";
import type { MenuStructure } from "../api/menu-api.js";
import { dashboardQuery } from "../api/live-queries.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { MenuStructureDraft, structurePriceKey } from "./menu-structure-draft.js";

type Drop = MenuStructureSaveResult["dropped"][number];
type Field = { kind: "row" | "price"; key: string };

function addressedField(error: unknown, input: MenuStructureSaveInput): Field | undefined {
  const field = (error as { params?: { field?: unknown } }).params?.field;
  if (typeof field !== "string") return undefined;
  const [group, index, part, member] = field.split(".");
  switch (group) {
    case "prices": {
      const price = input.prices[Number(index)];
      if (price) return { kind: "price", key: structurePriceKey(price.productId, price.variantId) };
      break;
    }
    case "rootMembers": {
      const row = input.rootMembers[Number(index)];
      if (row) return { kind: "row", key: row.id };
      break;
    }
    case "sections": {
      const section = input.sections[Number(index)];
      const key = part === "members" ? section?.members[Number(member)]?.id : section?.id;
      if (key) return { kind: "row", key };
    }
  }
  return undefined;
}

export class MenuStructureSave implements ReactiveController {
  readonly draft = new MenuStructureDraft();
  #scope?: DraftScope<boolean>;
  #generation = 0;
  #includeQueries: QueryController;
  #watchedIncludes = new Set<string>();
  #feedback: FormFeedback;
  #refusedPrices = new Map<string, string>();
  #pendingWrite?: Promise<void>;
  rowErrors = new Map<string, string>();
  dropped = "";
  saving = false;
  message = "";

  constructor(
    private readonly host: LitElement,
    private readonly apply: () => void,
    private readonly api: () => DashboardApi,
  ) {
    host.addController(this);
    this.#includeQueries = new QueryController(
      host,
      () => api().liveData,
      () => {},
    );
    this.#feedback = new FormFeedback(host);
  }

  hostConnected(): void {
    this.#scope = draftScopeFor(this.host, {
      id: this.host,
      current: () => this.draft.dirty,
      snapshot: (dirty) => dirty,
      equal: (a, b) => a === b,
      restore: () => {
        this.draft.restore();
        this.#clearMessages();
        this.apply();
      },
    }).scope;
    this.#scope.commit(false);
  }

  hostDisconnected(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#watchedIncludes.clear();
  }

  get pendingWrite(): Promise<void> | undefined {
    return this.#pendingWrite;
  }

  watchIncludes(active: boolean): void {
    const wanted = new Set(active ? this.draft.directIncludes : []);
    for (const id of this.#watchedIncludes)
      if (!wanted.has(id)) {
        this.#includeQueries.release(id);
        this.#watchedIncludes.delete(id);
      }
    const api = this.api();
    for (const id of wanted) {
      if (this.#watchedIncludes.has(id)) continue;
      this.#watchedIncludes.add(id);
      void this.#includeQueries
        .watch(
          id,
          dashboardQuery(api.background ?? api, "getMenuRead", [id, ["structure", "prices"]]),
          (result) => {
            if (result.structure?.status !== 200 || result.prices?.status !== 200) return;
            this.draft.include(
              id,
              result.structure.body as MenuStructure,
              result.prices.body as MenuPriceRow[],
            );
            this.changed();
          },
        )
        .catch(() => undefined);
    }
  }

  changed(): void {
    this.#scope?.changed();
    this.apply();
  }

  reset(): void {
    this.#generation++;
    this.#pendingWrite = undefined;
    this.watchIncludes(false);
    this.draft.reset();
    this.saving = false;
    this.#clearMessages();
    this.dropped = "";
    this.changed();
  }

  cancel(): void {
    if (this.saving || !this.draft.dirty) return;
    const leave = leaveCoordinatorFor(this.host);
    if (leave) {
      void leave.request({ scopes: [this.host], reason: "navigation", proceed() {} });
      return;
    }
    this.draft.restore();
    this.#clearMessages();
    this.changed();
  }

  #clearMessages(): void {
    this.message = "";
    this.#refusedPrices.clear();
    this.rowErrors.clear();
    this.#feedback.reset();
  }

  get invalidPrices(): Map<string, string> {
    return new Map(
      this.draft
        .input()
        .prices.flatMap(({ productId, variantId, price }) =>
          isProductPrice(price)
            ? []
            : [[structurePriceKey(productId, variantId), t("editor.price_invalid")]],
        ),
    );
  }

  get priceErrors(): Map<string, string> {
    return new Map([
      ...this.#refusedPrices,
      ...(this.#feedback.attempted ? this.invalidPrices : []),
    ]);
  }

  typePrice(productId: string, variantId: string | undefined, value: string): void {
    this.#refusedPrices.delete(structurePriceKey(productId, variantId));
    this.draft.setPrice(productId, variantId, value);
    this.changed();
  }

  #table() {
    return this.host.renderRoot.querySelector("dashboard-menu-structure-table");
  }

  async save(
    id: string,
    refresh: () => Promise<void>,
    label: (drop: Drop) => string,
  ): Promise<boolean> {
    if (this.saving || !this.draft.dirty) return false;
    this.#clearMessages();
    const input = this.draft.input();
    const invalid = this.invalidPrices;
    this.#feedback.press();
    if (invalid.size) {
      await this.host.updateComplete;
      await this.#table()?.focusPrice(invalid.keys().next().value!);
      return false;
    }
    const generation = this.#generation;
    this.saving = true;
    this.dropped = "";
    this.host.requestUpdate();
    let result: MenuStructureSaveResult;
    let pending: Promise<void> | undefined;
    try {
      const write = this.api().saveMenuStructure(id, input);
      pending = write.then(
        () => undefined,
        () => undefined,
      );
      this.#pendingWrite = pending;
      result = await write;
    } catch (error) {
      if (generation === this.#generation) {
        const field = addressedField(error, input);
        const message = codeMessage(codeOf(error));
        if (field?.kind === "price") this.#refusedPrices.set(field.key, message);
        else if (field?.kind === "row") this.rowErrors.set(field.key, message);
        else this.message = message;
        this.saving = false;
        this.host.requestUpdate();
        if (field) {
          await this.host.updateComplete;
          const table = this.#table();
          const shown =
            field.kind === "price"
              ? await table?.focusPrice(field.key)
              : await table?.focusRefusedRow(field.key);
          if (generation === this.#generation && !shown) {
            this.message = message;
            this.host.requestUpdate();
          }
        }
      }
      return false;
    } finally {
      if (this.#pendingWrite === pending) this.#pendingWrite = undefined;
    }
    if (generation !== this.#generation) return false;
    this.dropped = [...new Set(result.dropped.map(label))].join(", ");
    this.draft.commit();
    this.changed();
    await refresh();
    if (generation !== this.#generation) return false;
    this.saving = false;
    this.host.requestUpdate();
    return true;
  }

  actions(save: () => void, blocked: boolean) {
    const action = saveActionState(this.#scope);
    const disabled = this.saving || blocked || action.unchanged;
    const fields = new Set(this.priceErrors.keys());
    const message = this.#feedback.message({ form: this.message }, fields, t("form.fix_fields"));
    return html`<wt-form-actions class="structure-actions" .error=${message}
      ><wt-button
        slot="cancel"
        variant="secondary"
        data-test="structure-cancel"
        .disabled=${disabled}
        @click=${() => this.cancel()}
        >${t("action.cancel")}</wt-button
      ><wt-button
        variant=${action.variant}
        data-test="structure-save"
        .disabled=${disabled || (this.#feedback.attempted && this.invalidPrices.size > 0)}
        @click=${save}
        >${t("action.save")}</wt-button
      ></wt-form-actions
    >`;
  }

  dropNotice() {
    return this.dropped
      ? html`<p data-test="structure-dropped" role="status">
          ${fill("menus.structure_dropped", { names: this.dropped })}
        </p>`
      : nothing;
  }

  reviewDialog(open: boolean, close: () => void, save: () => void) {
    return html`<wt-modal
      data-test="structure-review"
      size="compact"
      .open=${open}
      heading=${t("menus.save_and_review")}
      @wt-close=${close}
    >
      <p>${t("menus.save_before_review")}</p>
      <wt-form-actions slot="footer">
        <wt-button slot="cancel" variant="secondary" @click=${close}
          >${t("unsaved.keep")}</wt-button
        >
        <wt-button data-test="structure-save-review" @click=${save}
          >${t("menus.save_and_review")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
