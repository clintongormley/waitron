import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, ContentLanguageController, currentContentLanguages } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import { unitPresentation } from "@waitron/catalogue/src/unit-presentation.js";
import type { MenuView, MenuTarget } from "@waitron/shared";
import { menuTargetKey } from "@waitron/catalogue/src/menu-navigation.js";
import { menuChangeActions, type MenuChangeAction } from "@waitron/catalogue/src/menu-undo.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { MenuDocumentTree } from "./menu-document-tree.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { formatMoney, languageDisplayName } from "@waitron/shared";
import type {
  DashboardApi,
  MenuChange,
  MenuPreview,
  MenuStatus,
  ProductChangeField,
  SectionChangeField,
} from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { codeMessage } from "../i18n/codes.js";
import { homeDeviceName } from "../i18n/domain.js";
import { conjunctionList } from "../i18n/list.js";
import {
  openProduct,
  publishWarningStyles,
  renderMenuWarnings,
  renderPublishWarningConfirmation,
} from "./menu-publish-warnings.js";
import { PATH_SEPARATOR } from "./category-form.js";
import { placeName } from "./price-source.js";
import { leftToBrowser } from "../navigation.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import "./menu-publications.js";
import type { StringKey } from "../i18n/strings.js";

/** How the host's last publish ended, for the panel to say. */
export type PublishResult =
  | { kind: "published"; number: number; warnings?: MenuPreview["warnings"] }
  | { kind: "stale" }
  | { kind: "failed"; reason: string };

const CHANGE_GROUP_ORDER = [
  "menu",
  "sections_added",
  "sections_removed",
  "sections_changed",
  "products_added",
  "products_removed",
  "products_moved",
  "prices",
  "details",
  "order",
  "home",
] as const;
type ChangeGroup = (typeof CHANGE_GROUP_ORDER)[number];
const CHANGE_GROUPS: Record<MenuChange["kind"], ChangeGroup> = {
  menu_renamed: "menu",
  section_added: "sections_added",
  section_removed: "sections_removed",
  section_changed: "sections_changed",
  product_added: "products_added",
  product_removed: "products_removed",
  product_deleted: "products_removed",
  product_moved: "products_moved",
  price_changed: "prices",
  product_changed: "details",
  extra_unit_changed: "details",
  extra_portion_changed: "details",
  extra_max_quantity_changed: "details",
  order_changed: "order",
  home_shortcuts_changed: "home",
  home_display_changed: "home",
};
const GROUP_LABELS: Record<ChangeGroup, StringKey> = {
  menu: "menu_preview.group_menu",
  sections_added: "menu_preview.group_sections_added",
  sections_removed: "menu_preview.group_sections_removed",
  sections_changed: "menu_preview.group_sections_changed",
  products_added: "menu_preview.group_products_added",
  products_removed: "menu_preview.group_products_removed",
  products_moved: "menu_preview.group_products_moved",
  prices: "menu_preview.group_prices",
  details: "menu_preview.group_details",
  order: "menu_preview.group_order",
  home: "menu_preview.group_home",
};

const PRODUCT_FIELDS: Record<ProductChangeField, StringKey> = {
  names: "menu_preview.field_names",
  description: "menu_preview.field_description",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
  unit: "menu_preview.field_unit",
  allergens: "menu_preview.field_allergens",
  diet: "menu_preview.field_diet",
  vat: "menu_preview.field_vat",
  ordering: "menu_preview.field_ordering",
  variants: "menu_preview.field_variants",
  extras: "menu_preview.field_extras",
  options: "menu_preview.field_options",
};

const SECTION_FIELDS: Record<SectionChangeField, StringKey> = {
  names: "menu_preview.field_name",
  image: "menu_preview.field_image",
  color: "menu_preview.field_color",
  direct: "menu_preview.field_direct",
};

const SOURCES: Record<MenuChange["source"], StringKey> = {
  this_menu: "menu_preview.source_this_menu",
  shared_product: "menu_preview.source_shared_product",
  included_menu: "menu_preview.source_included_menu",
};

/** A menu's publication state in words, for the menus list and the editor: what it is, and the live
 * version and its publication time beside it. */
export function statusWords(status: MenuStatus): {
  label: string;
  live: { version: string; time: string } | null;
} {
  if (status.state === "unpublished") return { label: t("menu_status.unpublished"), live: null };
  const number = { number: String(status.version) };
  const time = formatIsoMinute(status.publishedAt);
  return status.state === "current"
    ? {
        label: t("menu_status.current"),
        live: { version: fill("menu_status.current_version", number), time },
      }
    : {
        label: t("menu_status.changed"),
        live: { version: fill("menu_status.changed_version", number), time },
      };
}

/** Says a publish did not happen, what is still live, and that the working edits are kept. */
export function publishFailure(menu: string, status: MenuStatus | null, reason: string): string {
  return status !== null && status.state !== "unpublished"
    ? fill("menu_preview.failed_kept", { menu, number: String(status.version), reason })
    : fill("menu_preview.failed", { menu, reason });
}

/**
 * What publishing one menu would change from its live version, each change in words with where it
 * came from, the warnings that do not stop it, the button that publishes the menu, and the whole menu
 * read-only as the publish would make it live, or as it is live when there is nothing to publish. The
 * host reads the preview and performs the publish: the button asks for it as `wt-menu-publish` with
 * the hash the preview showed, and a failed read offers `wt-preview-retry`. Scheduling reads and
 * dialogs belong to the publications widget composed alongside that publish control.
 */
@customElement("dashboard-menu-preview")
export class MenuPreviewPanel extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    publishWarningStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-5);
        min-width: 0;
        container-type: inline-size;
        overflow-wrap: anywhere;
      }
      wt-combobox[slot="view"] {
        inline-size: calc(var(--wt-tap-min) * 4);
      }
      .heading-line {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        justify-content: space-between;
      }
      .panes {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-5);
        min-width: 0;
      }
      .changes-column {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .pane {
        min-width: 0;
        max-block-size: calc(var(--wt-tap-min) * 12);
        overflow: auto;
        scrollbar-gutter: stable;
      }
      @container (min-width: 800px) {
        .panes {
          grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
          align-items: start;
        }
      }
      section {
        display: grid;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      h2,
      h3 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      p {
        margin: 0;
      }
      ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      li {
        overflow-wrap: anywhere;
      }
      .source,
      .help,
      .note {
        color: var(--wt-color-text-muted);
      }
      .help {
        font-size: var(--wt-font-size-sm);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .result {
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-inline-start-width: var(--wt-space-1);
        border-radius: var(--wt-radius-md);
        overflow-wrap: anywhere;
      }
      .result.ok {
        border-inline-start-color: var(--wt-color-success);
      }
      .result.alert {
        border-inline-start-color: var(--wt-color-danger);
      }
      .warnings li::marker {
        color: var(--wt-color-warning);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      button.undo {
        padding: 0;
        border: 0;
        background: none;
        color: var(--wt-color-primary-text);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
      a[data-change-id],
      a[data-edit-change],
      a[data-hide-change],
      button.undo {
        white-space: nowrap;
      }
      button.undo:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      button.undo.blocked {
        color: var(--wt-color-text-muted);
        cursor: default;
      }
      button.undo[aria-disabled="true"] {
        cursor: default;
      }
    `,
  ];

  @property() menuName = "";
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property({ attribute: false }) lateRefusalFor?: (name: string) => () => void;
  @property({ attribute: false }) includedBy: { id: string; name: string }[] = [];
  /** Null while the live version is being read. */
  @property({ attribute: false }) status: MenuStatus | null = null;
  /** Null while the changes are being worked out, or when that failed. */
  @property({ attribute: false }) preview: MenuPreview | null = null;
  /** The preview could not be read. */
  @property({ type: Boolean }) failed = false;
  @property() failureReason = "";
  @property({ type: Boolean }) publishing = false;
  @property({ attribute: false }) result: PublishResult | null = null;
  /** The change whose Undo is out. */
  @property({ attribute: false }) undoing: string | null = null;
  /** Another write, a Home save or a publish is out, so no Undo can be sent. */
  @property({ type: Boolean }) undoBlocked = false;
  /** Change id → why its Undo was refused. */
  @property({ attribute: false }) undoRefusals: Record<string, string> = {};
  /** The bullet text of the last change undone. */
  @property({ attribute: false }) undoResult: string | null = null;

  @state() private confirmingPreview: MenuPreview | null = null;
  #publishedWarnings: MenuPreview["warnings"] = [];
  @state() private selectedView: string | null = null;
  @state() private hiddenChangeIds = new Set<string>();
  #menuId: string | null = null;
  #actions: ReadonlyMap<string, MenuChangeAction> = new Map();
  #positions: ReadonlyMap<MenuChange, number> = new Map();
  #actionsLanguages = "";
  #shownRefusals: Record<string, string> = {};
  /** Refusals that are news in this update, the only ones announced: one drawn again, after its
   * change is shown again or the list is redrawn, is not. */
  #freshRefusals = new Set<string>();
  /** Changes whose Undo finished since their refusal was last drawn: a refusal after one is news
   * even in the same words. */
  #finishedUndos = new Set<string>();
  /** Bumped per change at each announcement, so the refusal is drawn as a new element: an alert
   * whose words did not change is not read out again. */
  #refusalTurns = new Map<string, number>();
  #focusedUndo: string | null = null;
  #navigation = 0;
  @state() private navigationUnavailable = false;

  #view(): MenuView {
    const config = currentContentLanguages();
    if (this.selectedView === "internal") return { kind: "internal" };
    return {
      kind: "customer",
      language:
        this.selectedView !== null && config.languages.includes(this.selectedView)
          ? this.selectedView
          : config.defaultLanguage,
    };
  }

  #target(change: MenuChange): MenuTarget | null {
    const document = this.preview?.document;
    if (document === undefined || change.kind === "product_deleted") return null;
    let target: MenuTarget | undefined;
    if (change.kind === "menu_renamed") target = { kind: "title", menuId: document.menuId };
    else if (change.kind === "section_removed")
      target = { kind: "list", sectionIds: change.parentSectionIds };
    else if (change.kind === "product_removed") {
      const old = change.targets.before.find((target) => target.kind === "product");
      if (old?.kind === "product") target = { kind: "list", sectionIds: old.sectionIds };
    } else if (change.kind === "product_moved") {
      const oldKeys = new Set(change.targets.before.map(menuTargetKey));
      target =
        change.targets.after.find((target) => !oldKeys.has(menuTargetKey(target))) ??
        change.targets.after[0];
    } else target = change.targets.after[0];
    if (target === undefined) return null;
    if (target.kind === "title" || target.kind === "home") return target;
    let members = document.root.members;
    for (const id of target.sectionIds) {
      const section = members.find(
        (member) => member.kind === "section" && member.sectionId === id,
      );
      if (section?.kind !== "section") {
        if (change.kind === "section_removed" || change.kind === "product_removed")
          return {
            kind: "list",
            sectionIds: target.sectionIds.slice(0, target.sectionIds.indexOf(id)),
          };
        return null;
      }
      members = section.members;
    }
    if (
      target.kind === "product" &&
      !members.some(
        (member) =>
          member.kind === "product" &&
          member.menuItemId === target.menuItemId &&
          member.productId === target.productId,
      )
    )
      return null;
    return target;
  }

  async #navigate(event: MouseEvent, change: MenuChange, target: MenuTarget): Promise<void> {
    if (leftToBrowser(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const preview = this.preview;
    if (preview === null || this.failed || !preview.changes.includes(change)) return;
    const turn = ++this.#navigation;
    this.navigationUnavailable = false;
    const tree = this.shadowRoot!.querySelector<MenuDocumentTree>("dashboard-menu-document-tree");
    const resolved = await tree?.reveal(target);
    if (turn !== this.#navigation || this.preview !== preview) return;
    this.navigationUnavailable = !resolved;
  }

  async #hide(event: MouseEvent, change: MenuChange, preview: MenuPreview): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.preview !== preview || this.failed) return;
    const focused = this.shadowRoot!.activeElement === event.currentTarget;
    this.hiddenChangeIds = new Set(this.hiddenChangeIds).add(change.id);
    await this.updateComplete;
    if (focused && this.preview === preview) {
      const next =
        this.shadowRoot!.querySelector<HTMLElement>("a[data-hide-change]") ??
        this.shadowRoot!.querySelector<HTMLElement>('[data-test="show-all-changes"]');
      next?.focus({ preventScroll: true });
    }
  }

  override disconnectedCallback(): void {
    this.confirmingPreview = null;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues): void {
    if (this.failed || changed.has("menuName")) this.confirmingPreview = null;
    const focused = this.shadowRoot?.activeElement;
    this.#focusedUndo =
      focused instanceof HTMLButtonElement && focused.classList.contains("undo")
        ? focused.dataset.undoChange!
        : null;
    const finished = changed.has("undoing") ? changed.get("undoing") : null;
    if (typeof finished === "string" && this.undoing === null) this.#finishedUndos.add(finished);
    if (changed.has("undoRefusals") || typeof finished === "string") {
      const shown = this.#shownRefusals;
      this.#freshRefusals = new Set(
        Object.keys(this.undoRefusals).filter(
          (id) => shown[id] !== this.undoRefusals[id] || this.#finishedUndos.has(id),
        ),
      );
      for (const id of Object.keys(this.undoRefusals)) this.#finishedUndos.delete(id);
      for (const id of this.#freshRefusals)
        this.#refusalTurns.set(id, (this.#refusalTurns.get(id) ?? 0) + 1);
      this.#shownRefusals = this.undoRefusals;
    }
    const languages = currentContentLanguages().languages;
    const languagesKey = languages.join(" ");
    if (changed.has("preview") || languagesKey !== this.#actionsLanguages) {
      this.#actionsLanguages = languagesKey;
      this.#actions =
        this.preview === null ? new Map() : menuChangeActions({ preview: this.preview, languages });
    }
    if (changed.has("preview")) {
      this.confirmingPreview = null;
      this.navigationUnavailable = false;
      this.#navigation++;
      this.#positions = new Map();
      if (this.preview === null) return;
      this.#positions = new Map(this.preview.changes.map((change, index) => [change, index]));
      const listed = new Set(this.preview.changes.map((change) => change.id));
      for (const id of this.#finishedUndos) if (!listed.has(id)) this.#finishedUndos.delete(id);
      for (const id of this.#refusalTurns.keys())
        if (!listed.has(id)) this.#refusalTurns.delete(id);
      const menuId = this.preview.document.menuId;
      if (this.#menuId !== menuId) {
        this.selectedView = null;
        this.hiddenChangeIds = new Set();
      } else {
        this.hiddenChangeIds = new Set([...this.hiddenChangeIds].filter((id) => listed.has(id)));
      }
      this.#menuId = menuId;
    }
  }

  override updated(): void {
    this.#freshRefusals = new Set();
    const id = this.#focusedUndo;
    this.#focusedUndo = null;
    if (id === null) return;
    const root = this.shadowRoot!;
    const button = [...root.querySelectorAll<HTMLButtonElement>("button.undo")].find(
      (candidate) => candidate.dataset.undoChange === id,
    );
    if (button !== undefined) {
      if (root.activeElement !== button) button.focus({ preventScroll: true });
      return;
    }
    const next =
      root.querySelector<HTMLElement>("a[data-hide-change]") ??
      root.querySelector<HTMLElement>('[data-test="changes-pane"]');
    next?.focus({ preventScroll: true });
  }

  /** Whether the change's bullet is drawn with its Undo: only then can its refusal show in it. */
  drawsUndo(changeId: string): boolean {
    const preview = this.preview;
    return (
      !this.failed &&
      preview !== null &&
      this.#upToDate(preview) === null &&
      !this.hiddenChangeIds.has(changeId) &&
      this.#actions.get(changeId)?.kind === "undo"
    );
  }

  #undo(event: Event, change: MenuChange, words: string): void {
    event.stopPropagation();
    if (this.undoing !== null || this.undoBlocked || this.failed) return;
    this.dispatchEvent(
      new CustomEvent("wt-menu-undo", {
        detail: { changeId: change.id, change: words },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderUndo(change: MenuChange, index: number, words: string) {
    if (this.#actions.get(change.id)?.kind !== "undo") return nothing;
    const undoing = this.undoing === change.id;
    const blocked = !undoing && (this.undoing !== null || this.undoBlocked);
    const refusal = this.undoRefusals[change.id];
    return html`<button
      type="button"
      class=${blocked ? "undo blocked" : "undo"}
      data-undo-change=${change.id}
      aria-disabled=${undoing || blocked ? "true" : nothing}
      aria-describedby=${refusal === undefined ? `change-words-${index}` : `change-words-${index} change-refusal-${index}`}
      @click=${(event: Event) => this.#undo(event, change, words)}
    >
      ${t(undoing ? "menu_preview.undoing" : "menu_preview.undo")}
    </button>`;
  }

  #renderRefusal(change: MenuChange, index: number) {
    const reason = this.undoRefusals[change.id];
    if (reason === undefined || this.#actions.get(change.id)?.kind !== "undo") return nothing;
    return keyed(
      this.#refusalTurns.get(change.id) ?? 0,
      html`<p
        class="error"
        id=${`change-refusal-${index}`}
        data-undo-refusal
        role=${this.#freshRefusals.has(change.id) ? "alert" : nothing}
      >
        ${fill("menu_preview.undo_refused", { reason })}
      </p>`,
    );
  }

  /** One place inside a sentence. */
  #place(path: readonly string[]): string {
    return path.length === 0 ? t("menu_preview.top_level") : path.join(PATH_SEPARATOR);
  }

  #places(paths: readonly (readonly string[])[]): string {
    return conjunctionList(paths.map((path) => this.#place(path)));
  }

  /** A change at one place: its own wording at the top level, else `key` with the place filled. */
  #at(key: StringKey, top: StringKey, path: readonly string[], values: Record<string, string>) {
    return path.length === 0
      ? fill(top, values)
      : fill(key, { ...values, place: this.#place(path) });
  }

  #words(change: MenuChange): string {
    switch (change.kind) {
      case "product_added":
        return this.#at(
          "menu_preview.product_added",
          "menu_preview.product_added_top",
          change.under,
          { name: change.name },
        );
      case "product_removed":
        return this.#at(
          "menu_preview.product_removed",
          "menu_preview.product_removed_top",
          change.under,
          { name: change.name },
        );
      case "product_deleted":
        return fill("menu_preview.product_deleted", { name: change.name });
      case "product_moved":
        return fill("menu_preview.product_moved", {
          name: change.name,
          from: this.#places(change.from),
          to: this.#places(change.to),
        });
      case "price_changed":
        return fill("menu_preview.price_changed", {
          name: change.name,
          from: formatMoney(change.from, currentLocale()),
          to: formatMoney(change.to, currentLocale()),
        });
      case "product_changed":
        return fill("menu_preview.changed_fields", {
          name: change.name,
          fields: change.fields.map((field) => t(PRODUCT_FIELDS[field])).join(", "),
        });
      case "extra_unit_changed": {
        const describe = (unit: typeof change.from) => {
          const { name, abbreviation } = unitPresentation(
            unit,
            currentLocale(),
            currentContentLanguages(),
          );
          return abbreviation && name !== abbreviation ? `${name} · ${abbreviation}` : name;
        };
        const from = describe(change.from),
          to = describe(change.to);
        if (from === to && change.from.precision === change.to.precision)
          return fill("menu_preview.extra_unit_details_changed", {
            list: change.listName,
            name: change.name,
          });
        return fill("menu_preview.extra_unit_changed", {
          list: change.listName,
          name: change.name,
          from,
          fromPrecision: String(change.from.precision),
          to,
          toPrecision: String(change.to.precision),
        });
      }
      case "extra_portion_changed": {
        const locale = currentLocale().slice(0, 2);
        const unit = (abbreviations: Record<string, string>) =>
          abbreviations[locale] ?? abbreviations.en ?? Object.values(abbreviations)[0] ?? "";
        return fill("menu_preview.extra_portion_changed", {
          list: change.listName,
          name: change.name,
          from: `${change.from.portion} ${unit(change.from.abbreviation)}`.trim(),
          to: `${change.to.portion} ${unit(change.to.abbreviation)}`.trim(),
        });
      }
      case "extra_max_quantity_changed":
        return fill("menu_preview.extra_max_quantity_changed", {
          list: change.listName,
          name: change.name,
          from: change.from === null ? t("menu_preview.no_limit") : String(change.from),
          to: change.to === null ? t("menu_preview.no_limit") : String(change.to),
        });
      case "section_added":
        return this.#at(
          "menu_preview.section_added",
          "menu_preview.section_added_top",
          change.under,
          { name: change.name },
        );
      case "section_removed":
        return this.#at(
          "menu_preview.section_removed",
          "menu_preview.section_removed_top",
          change.under,
          { name: change.name },
        );
      case "section_changed":
        return change.fields.length === 1 && change.fields[0] === "names"
          ? fill("menu_preview.section_renamed", { name: change.name })
          : fill("menu_preview.changed_fields", {
              name: change.name,
              fields: change.fields.map((field) => t(SECTION_FIELDS[field])).join(", "),
            });
      case "order_changed":
        return this.#at(
          "menu_preview.order_changed",
          "menu_preview.order_changed_top",
          change.list,
          {},
        );
      case "home_shortcuts_changed":
        return t("menu_preview.home_shortcuts_changed");
      case "home_display_changed":
        return fill("menu_preview.home_display_changed", {
          device: homeDeviceName(change.device),
        });
      case "menu_renamed":
        return fill("menu_preview.menu_renamed", { from: change.from, to: change.to });
    }
  }

  #source(change: MenuChange): string {
    const source =
      change.includedMenu === undefined
        ? t(SOURCES[change.source])
        : `${t(SOURCES[change.source])}: ${change.includedMenu.name}`;
    return change.alsoOn?.length
      ? fill("menu_preview.also_on", { source, menus: conjunctionList(change.alsoOn) })
      : source;
  }

  /** The live version's number when the working menu is exactly that version, else null. Read
   * from the state that came with the preview, so both describe the same moment. */
  #upToDate(preview: MenuPreview): number | null {
    const { status } = preview;
    return status.state !== "unpublished" && status.hash === preview.hash ? status.version : null;
  }

  #publish(event: Event, confirmed = false): void {
    event.stopPropagation();
    if (
      this.failed ||
      this.publishing ||
      this.undoing !== null ||
      this.preview === null ||
      this.preview.clashes.length > 0
    )
      return;
    if (this.preview.warnings.length && !confirmed) {
      this.confirmingPreview = this.preview;
      return;
    }
    if (confirmed && this.confirmingPreview !== this.preview) return;
    this.#publishedWarnings = this.preview.warnings;
    this.confirmingPreview = null;
    this.dispatchEvent(
      new CustomEvent("wt-menu-publish", {
        detail: { hash: this.preview.hash },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderResult() {
    const result = this.result;
    if (result === null) return nothing;
    if (result.kind === "published")
      return html`<div class="result ok" role="status" data-test="result">
        ${fill("menu_preview.published", {
          menu: this.menuName,
          number: String(result.number),
        })}
        ${renderMenuWarnings(result.warnings ?? this.#publishedWarnings, this.menuName)}
      </div>`;
    const message =
      result.kind === "stale"
        ? codeMessage("menu.changed_since_preview")
        : publishFailure(this.menuName, this.status, result.reason);
    return html`<p class="result alert" role="alert" data-test="result">${message}</p>`;
  }

  #renderChanges() {
    const preview = this.preview;
    let body;
    if (this.failed)
      body = html`<p class="error" role="alert" data-test="preview-error">
          ${this.failureReason || t("menu_preview.error")}
        </p>
        <div>
          <wt-button
            variant="secondary"
            data-test="preview-retry"
            @click=${(event: Event) => {
              event.stopPropagation();
              this.dispatchEvent(
                new CustomEvent("wt-preview-retry", { detail: {}, bubbles: true, composed: true }),
              );
            }}
            >${t("menus.retry")}</wt-button
          >
        </div>`;
    else if (preview === null)
      body = html`<p class="note" role="status" data-test="preview-loading">
        ${t("menu_preview.loading")}
      </p>`;
    else if (this.#upToDate(preview) !== null)
      body = html`<p data-test="nothing">
        ${fill("menu_preview.nothing", { number: String(this.#upToDate(preview)) })}
      </p>`;
    else if (preview.changes.length === 0)
      body = html`<p class="note" data-test="no-changes">${t("menu_preview.no_changes")}</p>`;
    else
      body = keyed(
        preview,
        html`<div>
            ${this.hiddenChangeIds.size === 0 ? nothing : html`<span data-test="hidden-count">${fill(this.hiddenChangeIds.size === 1 ? "menu_preview.hidden_count_one" : "menu_preview.hidden_count", { count: String(this.hiddenChangeIds.size) })}</span>`}
            <p class="help">${t("menu_preview.hidden_hint")}</p>
          </div>
          <div data-test="changes">
            ${CHANGE_GROUP_ORDER.map((group) => {
              const rows = preview.changes.filter(
                (change) =>
                  !this.hiddenChangeIds.has(change.id) && CHANGE_GROUPS[change.kind] === group,
              );
              if (rows.length === 0) return nothing;
              return html`<section data-group=${group}>
                <h3>${t(GROUP_LABELS[group])}</h3>
                <ul>
                  ${rows.map((change) => {
                    const target = this.#target(change);
                    const words = this.#words(change);
                    const index = this.#positions.get(change)!;
                    return html`<li data-change-row=${change.id}>
                      <span id=${`change-words-${index}`}>${words}</span>
                      ${change.source === "this_menu" ? nothing : html`<span class="source">— ${this.#source(change)}</span>`}
                      ${
                        target === null
                          ? nothing
                          : html`<a
                              ?data-own-click=${target.kind !== "home"}
                              data-change-id=${change.id}
                              href=${`/manage/menus/menu/${encodeURIComponent(preview.document.menuId)}/view/${target.kind === "home" ? "home" : "preview"}`}
                              @click=${target.kind === "home" ? nothing : (event: MouseEvent) => void this.#navigate(event, change, target)}
                              >(${t("menu_preview.view_change")})</a
                            >`
                      }
                      ${this.#renderEdit(change)} ${this.#renderUndo(change, index, words)}
                      <a
                        data-own-click
                        data-hide-change=${change.id}
                        href=${`/manage/menus/menu/${encodeURIComponent(preview.document.menuId)}/view/preview`}
                        @click=${(event: MouseEvent) => void this.#hide(event, change, preview)}
                        >${t("menu_preview.hide_change")}</a
                      >
                      ${this.#renderRefusal(change, index)}
                    </li>`;
                  })}
                </ul>
              </section>`;
            })}
          </div>`,
      );
    return html`<section>
      <div class="heading-line">
        <h2 id="changes-heading">${t("menu_preview.changes_heading")}</h2>
        ${
          preview !== null && !this.failed && preview.changes.length > 0
            ? html`<wt-button
                variant="secondary"
                data-test="show-all-changes"
                .disabled=${this.hiddenChangeIds.size === 0}
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.hiddenChangeIds = new Set();
                }}
                >${t("menu_preview.show_all_changes")}</wt-button
              >`
            : nothing
        }
      </div>
      ${
        this.undoResult === null
          ? nothing
          : html`<p role="status" data-test="undo-result">
              ${fill("menu_preview.undone", { change: this.undoResult })}
            </p>`
      }
      ${body}
    </section>`;
  }

  #renderEdit(change: MenuChange) {
    const action = this.#actions.get(change.id);
    switch (action?.kind) {
      case "edit_product":
        return html`<a
          data-own-click
          data-edit-change=${change.id}
          href=${`/manage/catalogue/product/${encodeURIComponent(action.productId)}`}
          @click=${(event: MouseEvent) => openProduct(event, action.productId)}
          >${t("product.edit")}</a
        >`;
      case "edit_menu":
        return html`<a
          data-edit-change=${change.id}
          href=${`/manage/menus/menu/${encodeURIComponent(action.menuId)}/view/${action.tab}`}
          >${fill("menu_preview.edit_menu", { menu: change.includedMenu?.name ?? "" })}</a
        >`;
      case "edit_extras_list":
        return html`<a
          data-edit-change=${change.id}
          href=${`/manage/modifiers/view/extras/list/${encodeURIComponent(action.listId)}`}
          >${t("extras.edit")}</a
        >`;
      default:
        return nothing;
    }
  }

  #renderWarnings() {
    const warnings = this.failed ? [] : (this.preview?.warnings ?? []);
    if (warnings.length === 0) return nothing;
    return html`<section class="warnings" aria-labelledby="warnings-heading">
      <h2 id="warnings-heading">${t("menu_preview.warnings_heading")}</h2>
      <p class="help" data-test="warnings-note">${t("menu_preview.warnings_note")}</p>
      ${renderMenuWarnings(warnings, this.menuName)}
    </section>`;
  }

  /** The whole menu, as the publish would make it live, or as it is live when there is nothing to
   * publish. */
  #renderDocument() {
    const preview = this.preview;
    if (this.failed || preview === null) return nothing;
    const heading = t(
      this.#upToDate(preview) === null
        ? "menu_preview.document_heading"
        : "menu_preview.document_heading_live",
    );
    const view = this.#view();
    const config = currentContentLanguages();
    return html`<section data-test="document">
      <h2 id="document-heading">${heading}</h2>
      <p class="note">${t("customer_menu.frozen_content")}</p>
      ${this.navigationUnavailable ? html`<p role="status" data-test="navigation-unavailable">${t("customer_menu.unavailable_target")}</p>` : nothing}
      <dashboard-menu-document-tree
        .document=${preview.document}
        .inspectionKey=${preview}
        .view=${view}
        .languages=${config}
      >
        <wt-combobox
          slot="view"
          name="menu-preview-view"
          label=${t("customer_menu.view")}
          .value=${view.kind === "internal" ? "internal" : view.language}
          .options=${[
            { value: "internal", fixed: true, label: t("customer_menu.internal") },
            ...config.languages.map((language) => ({
              value: language,
              label: languageDisplayName(language, currentLocale()),
            })),
          ]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.selectedView = event.detail.value;
          }}
        ></wt-combobox>
      </dashboard-menu-document-tree>
    </section>`;
  }

  #renderPublish() {
    if (this.failed || this.preview === null || this.#upToDate(this.preview) !== null)
      return nothing;
    const menu = { menu: this.menuName };
    return html`<wt-button
        variant=${this.undoing === null && (this.publishing || this.preview.clashes.length === 0) ? "primary" : "secondary"}
        data-test="publish"
        .loading=${this.publishing}
        .disabled=${this.preview.clashes.length > 0 || this.undoing !== null}
        @click=${(event: Event) => this.#publish(event)}
        >${fill(
          this.publishing ? "menu_preview.publishing" : "menu_preview.publish",
          menu,
        )}</wt-button
      >
      ${this.includedBy.length === 0 ? nothing : html`<p slot="publish-note" class="help" data-test="only-this-menu">${this.#includerLinks()} ${t(this.includedBy.length === 1 ? "menu_preview.includer_note" : "menu_preview.includers_note")}</p>`} `;
  }

  #includerLinks() {
    let index = 0;
    return new Intl.ListFormat(currentLocale(), { type: "conjunction" })
      .formatToParts(this.includedBy.map((menu) => menu.name))
      .map((part) => {
        if (part.type === "literal") return part.value;
        const menu = this.includedBy[index++]!;
        return html`<a href=${`/manage/menus/menu/${encodeURIComponent(menu.id)}/view/preview`}
          >${menu.name}</a
        >`;
      });
  }

  #renderClashes() {
    const clashes = this.preview?.clashes ?? [];
    if (!clashes.length) return nothing;
    return html`<section>
      <p class="error" role="status" data-test="clash-count">
        ${fill(clashes.length === 1 ? "menu_preview.clash_count" : "menu_preview.clashes_count", { count: String(clashes.length) })}
      </p>
      <ul data-test="clashes">
        ${clashes.map((clash) => {
          const offer = Object.values(this.preview!.document.offers).find(
            (offer) => offer.productId === clash.productId,
          );
          const name = offer?.name ?? clash.productId;
          const variant = clash.variantId
            ? (offer?.variants.find((variant) => variant.id === clash.variantId)?.name ??
              clash.variantId)
            : null;
          const candidates = clash.candidates
            .map((candidate) =>
              fill("menu_prices.source_candidate", {
                price:
                  "value" in candidate
                    ? formatMoney(candidate.value, currentLocale())
                    : t("menu_prices.clash"),
                place: placeName(candidate.place, t),
              }),
            )
            .join(", ");
          const words = fill("menu_prices.clash_prices", { candidates });
          return html`<li>
            ${name}${variant ? ` — ${variant}` : ""}:
            ${words.replace(/^./, (letter) => letter.toLocaleLowerCase(currentLocale()))}
          </li>`;
        })}
      </ul>
      <a
        data-test="clash-prices"
        data-own-click
        @click=${(event: MouseEvent) => {
          if (leftToBrowser(event)) return;
          event.preventDefault();
          event.stopPropagation();
          this.dispatchEvent(
            new CustomEvent("wt-preview-clashes", {
              detail: {},
              bubbles: true,
              composed: true,
            }),
          );
        }}
        href=${`/manage/menus/menu/${encodeURIComponent(this.preview!.document.menuId)}/view/prices/filter/clashes`}
        >${t("menu_prices.show_clashes")}</a
      >
    </section>`;
  }

  override render() {
    return html`${this.#renderResult()} ${this.#renderWarnings()} ${this.#renderClashes()}
      <div class="panes">
        <div class="changes-column" data-test="changes-column">
          <dashboard-menu-publications
            .api=${this.api}
            .menuId=${this.menuId}
            .menuName=${this.menuName}
            .lateRefusalFor=${this.lateRefusalFor}
            .preview=${this.failed ? null : this.preview}
            .blocked=${this.undoing !== null}
            >${this.#renderPublish()}</dashboard-menu-publications
          >
          <div
            class="pane"
            data-test="changes-pane"
            tabindex="0"
            role="region"
            aria-labelledby="changes-heading"
          >
            ${this.#renderChanges()}
          </div>
        </div>
        <div
          class="pane"
          data-test="document-pane"
          tabindex=${this.preview !== null && !this.failed ? 0 : nothing}
          role=${this.preview !== null && !this.failed ? "region" : nothing}
          aria-labelledby=${this.preview !== null && !this.failed ? "document-heading" : nothing}
        >
          ${this.#renderDocument()}
        </div>
      </div>
      ${
        this.confirmingPreview === null
          ? nothing
          : renderPublishWarningConfirmation({
              preview: this.confirmingPreview,
              menuName: this.menuName,
              actionLabel: fill("menu_preview.publish", { menu: this.menuName }),
              busy: this.publishing,
              confirm: () => this.#publish(new Event("confirm"), true),
              cancel: () => {
                this.confirmingPreview = null;
              },
            })
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-preview": MenuPreviewPanel;
  }
}
