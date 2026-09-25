import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "@waitron/ui";
import { memberKindLabel, memberName } from "./member-list-editor.js";
import type { MenuStructureNode } from "../api/client.js";
import { t } from "../i18n/t.js";

/**
 * A menu's whole structure, one nested list per section. A section can sit in several places, so
 * each place is keyed by the path of member ids from the top and opens or closes on its own. Asking
 * to edit a section leaves as `wt-structure-edit` with that path.
 */
@customElement("dashboard-menu-structure-tree")
export class MenuStructureTree extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      ul ul {
        margin-inline-start: calc(var(--wt-tap-min) / 2);
        padding-inline-start: var(--wt-space-3);
        border-inline-start: 1px solid var(--wt-color-border);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      button {
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: var(--wt-color-surface);
      }
      .toggle,
      .spacer {
        flex: none;
        width: var(--wt-tap-min);
      }
      .toggle {
        font-size: var(--wt-font-size-lg);
        line-height: 1;
      }
      .edit,
      .product .name {
        padding-inline: var(--wt-space-2);
      }
      .name {
        overflow-wrap: anywhere;
        text-align: start;
      }
      .edit[aria-current="true"] {
        font-weight: var(--wt-font-weight-bold);
        text-decoration: underline;
      }
      .kind {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .notice {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) nodes: MenuStructureNode[] = [];
  @property({ attribute: false }) products: { id: string; name: string }[] = [];
  @property({ attribute: false }) sections: { id: string; internalName: string }[] = [];
  /** The path of the list being edited; empty for the menu's own top level. */
  @property({ attribute: false }) current: string[] = [];
  /** The accessible name of the whole structure, such as the menu's name. */
  @property() label = "";
  @state() private expanded: ReadonlySet<string> = new Set();
  #productNames = new Map<string, string>();
  #sectionNames = new Map<string, string>();

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("products"))
      this.#productNames = new Map(this.products.map((product) => [product.id, product.name]));
    if (changed.has("sections"))
      this.#sectionNames = new Map(
        this.sections.map((section) => [section.id, section.internalName]),
      );
    // The way to the list being edited is opened, however it was reached.
    if (changed.has("current") && this.current.length > 0) {
      const expanded = new Set(this.expanded);
      for (let depth = 1; depth <= this.current.length; depth++)
        expanded.add(this.current.slice(0, depth).join("/"));
      this.expanded = expanded;
    }
  }

  #toggle(key: string): void {
    const expanded = new Set(this.expanded);
    if (!expanded.delete(key)) expanded.add(key);
    this.expanded = expanded;
  }

  #edit(event: Event, path: string[]): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-structure-edit", { detail: { path }, bubbles: true, composed: true }),
    );
  }

  #item(node: MenuStructureNode, parent: string[]): TemplateResult {
    const path = [...parent, node.memberId];
    const key = path.join("/");
    const name = memberName(node.ref, this.#productNames, this.#sectionNames);
    const kind = html`<span class="kind" data-test="kind">${memberKindLabel(node.ref)}</span>`;
    if (node.ref.kind === "product")
      return html`<li data-path=${key} class="product">
        <div class="row">
          <span class="spacer"></span>
          <span class="name" data-test="name">${name}</span>
          ${kind}
        </div>
      </li>`;
    const open = this.expanded.has(key);
    const isCurrent = key === this.current.join("/");
    const children = node.children ?? [];
    return html`<li data-path=${key}>
      <div class="row">
        <button
          type="button"
          class="toggle"
          data-test=${`toggle-${key}`}
          aria-expanded=${open ? "true" : "false"}
          aria-label=${t(open ? "menus.collapse" : "menus.expand").replace("{name}", name)}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#toggle(key);
          }}
        >
          ${open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          class="edit name"
          data-test=${`edit-${key}`}
          aria-current=${isCurrent ? "true" : nothing}
          @click=${(event: Event) => this.#edit(event, path)}
        >
          <span data-test="name">${name}</span>
        </button>
        ${kind}
      </div>
      ${open && children.length > 0 ? this.#list(children, path) : nothing}
    </li>`;
  }

  #list(nodes: MenuStructureNode[], parent: string[]): TemplateResult {
    return html`<ul>
      ${repeat(
        nodes,
        (node) => node.memberId,
        (node) => this.#item(node, parent),
      )}
    </ul>`;
  }

  override render() {
    if (this.nodes.length === 0)
      return html`<p class="notice" data-test="empty">${t("menus.structure_empty")}</p>`;
    return html`<ul aria-label=${this.label}>
      ${repeat(
        this.nodes,
        (node) => node.memberId,
        (node) => this.#item(node, []),
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-structure-tree": MenuStructureTree;
  }
}
