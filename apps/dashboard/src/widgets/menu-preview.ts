import { installedContentLanguagePresentation } from "@waitron/country-packs";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, ContentLanguageController, currentContentLanguages } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-card.js";
import type { MenuView, MenuTarget } from "@waitron/shared";
import { menuTargetKey } from "@waitron/menu/src/menu-navigation.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { MenuDocumentTree } from "./menu-document-tree.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { formatMoney, contentLanguageDisplayName } from "@waitron/shared";
import type { DashboardApi, MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { relativeTime } from "./relative-time.js";
import { codeMessage } from "../i18n/codes.js";
import {
  renderFoldedMenuWarnings,
  publishWarningStyles,
  renderMenuWarnings,
  renderPublishWarningConfirmation,
} from "./menu-publish-warnings.js";
import { placeName } from "./price-source.js";
import { setMenuAddress, leftToBrowser } from "../navigation.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import {
  publicationBlockerCount,
  previewLiveVersion,
  type MenuPublicationHeading,
} from "./menu-publication-actions.js";
import "./menu-publications.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import { changeSource, changeWords } from "./menu-preview-changes.js";
import { CHANGE_GROUP_ORDER, CHANGE_GROUPS, GROUP_LABELS } from "./menu-preview-labels.js";

/** How the host's last publish ended, for the panel to say. */
export type PublishResult =
  | { kind: "published"; number: number; warnings?: MenuPreview["warnings"] }
  | { kind: "stale" }
  | { kind: "failed"; reason: string };

/**
 * A menu's publication state in words, read against `now`: its label, and for a live menu its
 * version and how long ago it was published. The editor's heading shows the version and time (the
 * label for a menu never published); the menus list shows the label and time.
 */
export function statusWords(
  status: MenuStatus,
  now: () => Date,
): {
  label: string;
  live: { version: string; time: TemplateResult } | null;
} {
  if (status.state === "unpublished") return { label: t("menu_status.unpublished"), live: null };
  const version = fill("menu_status.changed_version", { number: String(status.version) });
  // No time zone: the statuses read carries none, so this reads in the browser's zone.
  const time = relativeTime("{time}", status.publishedAt, { calendar: true, now });
  return {
    label: t(status.state === "current" ? "menu_status.current" : "menu_status.changed"),
    live: { version, time },
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
      .panes {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .changes-column {
        display: grid;
        gap: var(--wt-space-4);
        min-width: 0;
      }
      .pane {
        min-width: 0;
      }
      .changes-pane {
        display: grid;
        gap: var(--wt-space-4);
      }
      @container (width < 800px) {
        .changes-column {
          display: contents;
        }
        .panes[data-view="changes"] .menu-pane,
        .panes[data-view="menu"] .changes-pane {
          display: none;
        }
      }
      @container (min-width: 800px) {
        .panes {
          grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
          align-items: start;
          gap: var(--wt-space-5);
        }
        wt-segmented-control {
          display: none;
        }
      }
      [data-test="changes"],
      .blockers ul {
        display: grid;
        gap: var(--wt-space-4);
      }
      .blockers {
        border-inline-start: var(--wt-space-1) solid var(--wt-color-danger);
        border-radius: var(--wt-radius-lg);
      }
      .blockers ul {
        list-style: none;
        padding-inline-start: 0;
      }
      .blockers li {
        display: grid;
        gap: var(--wt-space-1);
        justify-items: start;
      }
      .clash-name {
        font-weight: var(--wt-font-weight-bold);
      }
      .clash-detail {
        color: var(--wt-color-text-muted);
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
      h2[slot="header"] {
        margin-block-end: var(--wt-space-3);
        color: var(--wt-color-text);
      }
      .blockers h2 {
        color: var(--wt-color-danger);
      }
      h3 {
        color: var(--wt-color-text-muted);
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
      .source {
        display: block;
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
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];

  @property() menuName = "";
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property({ attribute: false }) heading?: MenuPublicationHeading;
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
  @state() private confirmingPreview: MenuPreview | null = null;
  #publishedWarnings: MenuPreview["warnings"] = [];
  @state() private selectedView: string | null = null;
  @property({ attribute: false }) rootMedia?: { image: string | null; color: string | null };
  @property({ attribute: false }) placeableSetMenus: readonly { id: string }[] = [];
  @state() private pane: "changes" | "menu" = "changes";
  #menuId: string | null = null;
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
    if (
      document === undefined ||
      change.kind === "product_deleted" ||
      change.kind === "product_removed" ||
      change.kind === "section_removed" ||
      change.kind === "set_menu_removed"
    )
      return null;
    let target: MenuTarget | undefined;
    if (change.kind === "menu_renamed") target = { kind: "title", menuId: document.menuId };
    else if (change.kind === "product_moved") {
      const oldKeys = new Set(change.targets.before.map(menuTargetKey));
      target =
        change.targets.after.find((target) => !oldKeys.has(menuTargetKey(target))) ??
        change.targets.after[0];
    } else target = change.targets.after[0];
    if (target === undefined || target.kind === "set_menu") return null;
    if (target.kind === "title" || target.kind === "home") return target;
    let members = document.root.members;
    for (const id of target.sectionIds) {
      const section = members.find(
        (member) => member.kind === "section" && member.sectionId === id,
      );
      if (section?.kind !== "section") return null;
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
    const picker = this.renderRoot.querySelector("wt-segmented-control");
    const phone = picker !== null && picker.getClientRects().length > 0;
    if (phone) {
      this.pane = "menu";
      await this.updateComplete;
      if (turn !== this.#navigation || this.preview !== preview) return;
    }
    const tree = this.renderRoot.querySelector<MenuDocumentTree>("dashboard-menu-document-tree");
    const resolved = await tree?.reveal(target, phone);
    if (turn !== this.#navigation || this.preview !== preview) return;
    this.navigationUnavailable = !resolved;
  }

  override disconnectedCallback(): void {
    this.confirmingPreview = null;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues): void {
    if (this.failed || changed.has("menuName")) this.confirmingPreview = null;
    if (changed.has("preview")) {
      this.confirmingPreview = null;
      this.navigationUnavailable = false;
      this.#navigation++;
      if (this.preview === null) return;
      const menuId = this.preview.document.menuId;
      if (this.#menuId !== menuId) {
        this.selectedView = null;
        this.pane = "changes";
      }
      this.#menuId = menuId;
    }
  }

  requestPublish(event: Event, preview: MenuPreview): void {
    if (this.preview === preview) this.#publish(event);
  }

  #publish(event: Event, confirmed = false): void {
    event.stopPropagation();
    if (
      this.failed ||
      this.publishing ||
      this.preview === null ||
      publicationBlockerCount(this.preview) > 0
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

  #renderReadState() {
    if (this.failed)
      return html`<p class="error" role="alert" data-test="preview-error">
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
    if (this.preview === null)
      return html`<p class="note" role="status" data-test="preview-loading">
        ${t("menu_preview.loading")}
      </p>`;
    return nothing;
  }

  #renderChanges(preview: MenuPreview) {
    let body;
    if (previewLiveVersion(preview) !== null)
      body = html`<p data-test="nothing">
        ${fill("menu_preview.nothing", { number: String(previewLiveVersion(preview)) })}
      </p>`;
    else if (preview.changes.length === 0)
      body = html`<p class="note" data-test="no-changes">${t("menu_preview.no_changes")}</p>`;
    else
      body = keyed(
        preview,
        html`<div data-test="changes">
          ${CHANGE_GROUP_ORDER.map((group) => {
            const rows = preview.changes.filter((change) => CHANGE_GROUPS[change.kind] === group);
            if (rows.length === 0) return nothing;
            return html`<section data-group=${group}>
              <h3>${t(GROUP_LABELS[group])}</h3>
              <ul role="list">
                ${rows.map((change) => {
                  const source = changeSource(change);
                  return html`<li data-change-row=${change.id}>
                    ${changeWords(change, (name) => this.#changeLink(change, name))}
                    ${source ? html`<span class="source">${source}</span>` : nothing}
                  </li>`;
                })}
              </ul>
            </section>`;
          })}
        </div>`,
      );
    return html`<wt-card>
      <h2 slot="header" id="changes-heading">${t("menu_preview.changes_heading")}</h2>
      ${body}
    </wt-card>`;
  }

  #changeLink(change: MenuChange, name: string) {
    if ("setMenu" in change) {
      if (
        change.kind === "set_menu_removed" &&
        !this.placeableSetMenus.some(({ id }) => id === change.setMenu.id)
      )
        return name;
      return html`<a data-change-id=${change.id} href=${setMenuAddress(change.setMenu.id)}
        >${name}</a
      >`;
    }
    const menu = encodeURIComponent(this.preview!.document.menuId);
    if (change.kind === "home_display_changed" || change.kind === "home_shortcuts_changed")
      return html`<a data-change-id=${change.id} href=${`/menus/menu/${menu}/view/home`}
        >${name}</a
      >`;
    const target = this.#target(change);
    if (target === null) return name;
    return html`<a
      data-own-click
      data-change-id=${change.id}
      href=${`/menus/menu/${menu}/view/preview`}
      @click=${(event: MouseEvent) => void this.#navigate(event, change, target)}
      >${name}</a
    >`;
  }

  #renderWarnings() {
    const warnings = this.failed ? [] : (this.preview?.warnings ?? []);
    if (warnings.length === 0) return nothing;
    return html`<wt-card>
      <h2 slot="header">${t("menu_preview.warnings_heading")}</h2>
      ${renderFoldedMenuWarnings(warnings, this.menuName)}
    </wt-card>`;
  }

  /** The whole menu, as the publish would make it live, or as it is live when there is nothing to
   * publish. */
  #renderDocument() {
    const preview = this.preview;
    if (this.failed || preview === null) return nothing;
    const heading = t(
      previewLiveVersion(preview) === null
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
        .rootMedia=${this.rootMedia}
        .clashes=${preview.clashes}
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
              label: contentLanguageDisplayName(
                language,
                currentLocale(),
                installedContentLanguagePresentation(),
              ),
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

  #renderPublishNote() {
    if (this.failed || this.preview === null || previewLiveVersion(this.preview) !== null)
      return nothing;
    return html`${this.includedBy.length === 0 ? nothing : html`<p slot="publish-note" class="help" data-test="only-this-menu">${this.#includerLinks()} ${t(this.includedBy.length === 1 ? "menu_preview.includer_note" : "menu_preview.includers_note")}</p>`} `;
  }

  #includerLinks() {
    let index = 0;
    return new Intl.ListFormat(currentLocale(), { type: "conjunction" })
      .formatToParts(this.includedBy.map((menu) => menu.name))
      .map((part) => {
        if (part.type === "literal") return part.value;
        const menu = this.includedBy[index++]!;
        return html`<a href=${`/menus/menu/${encodeURIComponent(menu.id)}/view/preview`}
          >${menu.name}</a
        >`;
      });
  }

  #renderBlockers(preview: MenuPreview) {
    const count = publicationBlockerCount(preview);
    if (count === 0) return nothing;
    const href = `/menus/menu/${encodeURIComponent(preview.document.menuId)}/view/prices/filter/clashes`;
    return html`<wt-card class="blockers" data-test="publish-blockers">
      <h2 slot="header" id="publish-blockers-heading">
        ${fill("menu_preview.blockers_heading", { count: String(count) })}
      </h2>
      <ul role="list" data-test="clashes">
        ${preview.clashes.map((clash) => {
          const offer = Object.values(preview.document.offers).find(
            ({ productId }) => productId === clash.productId,
          );
          const name = offer?.name ?? clash.productId;
          const variant = clash.variantId
            ? (offer?.variants.find(({ id }) => id === clash.variantId)?.name ?? clash.variantId)
            : null;
          return html`<li>
            <span class="clash-name">${name}${variant ? ` › ${variant}` : ""}</span>
            ${clash.candidates.map(
              (candidate) =>
                html`<span class="clash-detail">
                  ${fill("menu_prices.source_candidate", {
                    price:
                      "value" in candidate
                        ? formatMoney(candidate.value, currentLocale())
                        : t("menu_prices.clash"),
                    place: placeName(candidate.place, t),
                  })}
                </span>`,
            )}
            <a data-test="clash-prices" data-own-click href=${href} @click=${this.#openClashes}
              >${t("menu_preview.choose_price")} <span aria-hidden="true">›</span></a
            >
          </li>`;
        })}
        ${preview.setMenuProblems.map(
          ({ menuId, name, problems }) =>
            html`<li>
              <a href=${setMenuAddress(menuId)}>
                ${fill(problems.length === 1 ? "menu_preview.set_menu_problem_count_one" : "menu_preview.set_menu_problem_count", { name, count: String(problems.length) })}
              </a>
            </li>`,
        )}
      </ul>
    </wt-card>`;
  }

  #openClashes(event: MouseEvent): void {
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
  }

  #renderPanes(preview: MenuPreview) {
    const count = preview.changes.length;
    return html`<div class="panes" data-view=${this.pane}>
      <div class="changes-column">
        ${this.#renderBlockers(preview)}
        <wt-segmented-control
          name="menu-preview-pane"
          label=${t("menu_preview.pane_label")}
          hide-label
          equal-width
          .value=${this.pane}
          .options=${[
            {
              value: "changes",
              label:
                count === 0
                  ? t("menu_preview.pane_changes")
                  : fill("menu_preview.pane_count", { count: String(count) }),
            },
            { value: "menu", label: t("menu_preview.pane_menu") },
          ]}
          @wt-change=${(event: CustomEvent<{ value: "changes" | "menu" }>) => {
            event.stopPropagation();
            this.pane = event.detail.value;
          }}
        ></wt-segmented-control>
        <div
          class="pane changes-pane"
          data-test="changes-pane"
          tabindex="0"
          role="region"
          aria-labelledby="changes-heading"
        >
          ${this.#renderWarnings()} ${this.#renderChanges(preview)}
        </div>
      </div>
      <div
        class="pane menu-pane"
        data-test="document-pane"
        tabindex="0"
        role="region"
        aria-labelledby="document-heading"
      >
        ${this.#renderDocument()}
      </div>
    </div>`;
  }

  override render() {
    return html`${this.#renderResult()}
      <dashboard-menu-publications
        .api=${this.api}
        .menuId=${this.menuId}
        .menuName=${this.menuName}
        .lateRefusalFor=${this.lateRefusalFor}
        .preview=${this.failed ? null : this.preview}
        .heading=${this.heading}
      >
        ${this.#renderPublishNote()} ${this.#renderReadState()}
        ${this.preview !== null && !this.failed ? this.#renderPanes(this.preview) : nothing}
      </dashboard-menu-publications>
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
