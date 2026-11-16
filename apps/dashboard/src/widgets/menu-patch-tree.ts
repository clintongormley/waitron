import { html, nothing, type TemplateResult } from "lit";
import { foldForSearch, type TextSearch } from "@waitron/shared";
import type { MenuPatchTarget } from "../api/client.js";
import { t } from "../i18n/t.js";
import { targetKey, type PatchTreeNode } from "./menu-patch-draft.js";

export function matching(nodes: readonly PatchTreeNode[], search: TextSearch): PatchTreeNode[] {
  return nodes.flatMap((node) => {
    if (search.rank(foldForSearch(node.label)) !== undefined) return [node];
    const children = matching(node.children, search);
    return children.length === 0 ? [] : [{ ...node, children }];
  });
}

export function findNode(nodes: readonly PatchTreeNode[], key: string): PatchTreeNode | undefined {
  for (const node of nodes) {
    if (node.target !== null && targetKey(node.target) === key) return node;
    const found = findNode(node.children, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

interface PatchTreeState {
  picked: string | null;
  marked: ReadonlySet<string>;
  changed(target: MenuPatchTarget): boolean;
  pick(target: MenuPatchTarget): Promise<void>;
}

export function renderPatchTree(
  nodes: readonly PatchTreeNode[],
  state: PatchTreeState,
): TemplateResult {
  return html`<ul>
    ${nodes.map(
      (node) =>
        html`<li>
          ${
            node.target === null
              ? html`<span class="group" data-test="label">${node.label}</span>`
              : renderNode(node.target, node.label, state)
          }
          ${node.children.length === 0 ? nothing : renderPatchTree(node.children, state)}
        </li>`,
    )}
  </ul>`;
}

function renderNode(target: MenuPatchTarget, label: string, state: PatchTreeState): TemplateResult {
  const current = targetKey(target) === state.picked;
  return html`<button
    type="button"
    class="node"
    aria-current=${current ? "true" : nothing}
    @click=${() => void state.pick(target)}
  >
    <span data-test="label">${label}</span>
    ${
      state.changed(target)
        ? html`<span class="dot" data-test="changed"
            ><span class="hidden">${t("menu_patch.changed")}</span></span
          >`
        : nothing
    }
    ${
      state.marked.has(targetKey(target))
        ? html`<span class="flag" data-test="needs-correcting"
            ><span aria-hidden="true">!</span
            ><span class="hidden">${t("menu_patch.needs_correcting")}</span></span
          >`
        : nothing
    }
  </button>`;
}
