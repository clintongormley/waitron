import { html, nothing, type LitElement, type ReactiveController } from "lit";
import { draftScopeFor, leaveCoordinatorFor, saveActionState, type DraftScope } from "@waitron/ui";
import type {
  HomeOrder,
  HomeTile,
  MenuHome,
  MenuHomeSaveInput,
  ShortcutRef,
  TileRef,
} from "@waitron/shared";
import type { DashboardApi } from "../api/client.js";
import type { MenuReadRevision } from "../api/menu-api.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

export interface HomeShortcutOption {
  value: string;
  label: string;
  name: string;
  ref: ShortcutRef;
}

function key(ref: TileRef): string {
  if (ref.kind === "missing") return "";
  return ref.kind === "product" ? `product:${ref.productId}` : `section:${ref.sectionId}`;
}

function covers(read: MenuReadRevision | undefined, write: MenuReadRevision | undefined): boolean {
  return (
    read !== undefined &&
    write !== undefined &&
    read.epoch === write.epoch &&
    read.sequence >= write.sequence
  );
}

export class MenuHomeSave implements ReactiveController {
  #saved: MenuHome | null = null;
  #revision?: MenuReadRevision;
  #scope?: DraftScope<boolean>;
  #generation = 0;
  #pendingWrite?: Promise<void>;
  #choices = new Map<string, HomeShortcutOption>();
  home: MenuHome | null = null;
  saving = false;
  message = "";
  dropped = "";

  constructor(
    private readonly host: LitElement,
    private readonly api: () => DashboardApi,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.#scope = draftScopeFor(this.host, {
      id: this,
      current: () => this.dirty,
      snapshot: (dirty) => dirty,
      equal: (a, b) => a === b,
      restore: () => this.#restore(),
    }).scope;
    this.#scope.commit(false);
  }

  hostDisconnected(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
  }

  get dirty(): boolean {
    const { home } = this;
    return (
      home !== null &&
      this.#saved !== null &&
      (home.order !== this.#saved.order ||
        home.shortcuts.length !== this.#saved.shortcuts.length ||
        home.shortcuts.some(
          (tile, index) => tile.memberId !== this.#saved!.shortcuts[index]?.memberId,
        ))
    );
  }

  get saved(): MenuHome | null {
    return this.#saved;
  }

  get pendingWrite(): Promise<void> | undefined {
    return this.#pendingWrite;
  }

  #changed(): void {
    this.#scope?.changed();
    this.host.requestUpdate();
  }

  #restore(): void {
    this.home = this.#saved;
    this.message = "";
    this.#changed();
  }

  reset(): void {
    this.#generation++;
    this.#saved = null;
    this.#revision = undefined;
    this.#pendingWrite = undefined;
    this.home = null;
    this.saving = false;
    this.message = "";
    this.dropped = "";
    this.#changed();
  }

  accept(saved: MenuHome, revision?: MenuReadRevision): void {
    if (
      revision &&
      this.#revision?.epoch === revision.epoch &&
      this.#revision.sequence > revision.sequence
    )
      return;
    const dirty = this.dirty;
    this.#saved = saved;
    this.#revision = revision;
    if (dirty) this.#resolveTiles();
    else this.home = saved;
    this.#changed();
  }

  choices(choices: HomeShortcutOption[]): void {
    this.#choices = new Map(choices.map((choice) => [choice.value, choice]));
    if (this.dirty) this.#resolveTiles();
  }

  #resolveTiles(): void {
    const home = this.home!;
    const held = new Map(this.#saved!.shortcuts.map((tile) => [tile.memberId, tile]));
    this.home = {
      ...home,
      shortcuts: home.shortcuts.map((tile, position) => {
        const current = held.get(tile.memberId);
        if (current) return { ...current, position };
        const choice = this.#choices.get(key(tile.ref));
        return {
          ...tile,
          position,
          name: choice?.name ?? tile.name,
          reachable: choice !== undefined,
          missingName: choice === undefined ? (tile.missingName ?? tile.name) : null,
        };
      }),
    };
  }

  options(): HomeShortcutOption[] {
    const held = new Set(this.home?.shortcuts.map(({ ref }) => key(ref)));
    return [...this.#choices.values()].filter(({ value }) => !held.has(value));
  }

  #edit(shortcuts: HomeTile[], order = this.home!.order): void {
    this.home = { ...this.home!, shortcuts, order };
    this.message = "";
    this.#changed();
  }

  setOrder(order: HomeOrder): void {
    if (!this.saving && this.home && order !== this.home.order)
      this.#edit(this.home.shortcuts, order);
  }

  add(values: readonly string[]): boolean {
    if (this.saving || !this.home) return false;
    const offered = new Map(this.options().map((option) => [option.value, option]));
    const shortcuts = [...this.home.shortcuts];
    for (const value of new Set(values)) {
      const choice = offered.get(value);
      if (!choice) continue;
      shortcuts.push({
        memberId: crypto.randomUUID(),
        position: shortcuts.length,
        name: choice.name,
        ref: choice.ref,
        reachable: true,
        missingName: null,
      });
    }
    if (shortcuts.length === this.home.shortcuts.length) return false;
    this.#edit(shortcuts);
    return true;
  }

  remove(id: string): void {
    if (this.saving || !this.home) return;
    this.#edit(
      this.home.shortcuts
        .filter(({ memberId }) => memberId !== id)
        .map((tile, position) => ({ ...tile, position })),
    );
  }

  move(id: string, to: number): void {
    if (this.saving || !this.home) return;
    const shortcuts = [...this.home.shortcuts];
    const from = shortcuts.findIndex(({ memberId }) => memberId === id);
    if (from < 0 || to < 0 || to >= shortcuts.length || from === to) return;
    shortcuts.splice(to, 0, shortcuts.splice(from, 1)[0]!);
    this.#edit(shortcuts.map((tile, position) => ({ ...tile, position })));
  }

  cancel(): void {
    if (this.saving || !this.dirty) return;
    const leave = leaveCoordinatorFor(this.host);
    if (leave) void leave.request({ scopes: [this], reason: "navigation", proceed() {} });
    else this.#restore();
  }

  async save(id: string, refresh: () => Promise<void>): Promise<void> {
    const home = this.home;
    if (!home || !this.dirty || this.saving) return;
    const input: MenuHomeSaveInput = {
      order: home.order,
      shortcuts: home.shortcuts.map(({ memberId, ref }) => ({
        memberId,
        ref: ref.kind === "missing" ? { kind: "missing" } : ref,
      })),
    };
    const labels = new Map(home.shortcuts.map(({ memberId, name }) => [memberId, name]));
    const generation = this.#generation;
    const api = this.api();
    this.saving = true;
    this.message = "";
    this.dropped = "";
    this.#changed();

    let settleWrite!: () => void;
    const pending = new Promise<void>((resolve) => {
      settleWrite = resolve;
    });
    this.#pendingWrite = pending;
    try {
      const { dropped, ...saved } = await api.saveMenuHome(id, input);
      if (generation !== this.#generation) return;
      const revision = api.menuWriteRevision;
      if (!covers(this.#revision, revision)) {
        this.#saved = saved;
        this.#revision = revision;
      }
      this.home = this.#saved;
      this.dropped = [
        ...new Set(dropped.map(({ memberId }) => labels.get(memberId) ?? t("members.missing"))),
      ].join(", ");
    } catch (error) {
      if (generation === this.#generation) {
        const code = codeOf(error);
        const field = (error as { params?: { field?: unknown } })?.params?.field;
        const shortcut =
          typeof field === "string" && /^shortcuts\.\d+\.ref$/.test(field)
            ? home.shortcuts[Number(field.split(".")[1])]
            : undefined;
        this.message = !shortcut
          ? codeMessage(code)
          : code === "menu_section.not_found"
            ? fill("home.shortcut_removed", { name: shortcut.name })
            : fill("home.shortcut_refused", { name: shortcut.name, reason: codeMessage(code) });
      }
      return;
    } finally {
      if (generation === this.#generation) {
        this.#pendingWrite = undefined;
        this.saving = false;
        this.#changed();
      }
      settleWrite();
    }
    await refresh();
  }

  actions(save: () => void, blocked: boolean) {
    const action = saveActionState(this.#scope);
    const disabled = blocked || this.saving || action.unchanged;
    return html`<wt-form-actions class="structure-actions" .error=${this.message}
      >${
        this.dropped
          ? html`<p slot="secondary" data-test="home-dropped" role="status">
              ${fill("home.shortcuts_dropped", { names: this.dropped })}
            </p>`
          : nothing
      }
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="home-cancel"
        .disabled=${disabled}
        @click=${() => this.cancel()}
        >${t("action.cancel")}</wt-button
      ><wt-button
        variant=${action.variant}
        data-test="home-save"
        .disabled=${disabled}
        @click=${save}
        >${t("action.save")}</wt-button
      ></wt-form-actions
    >`;
  }
}
