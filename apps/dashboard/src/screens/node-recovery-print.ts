import type { NodeRecoveryPack } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";

export function renderNodeRecoveryPack(pack: NodeRecoveryPack, source: HTMLElement): string {
  const page = document.implementation.createHTMLDocument(t("node_pack.title"));
  page.documentElement.lang = currentLocale();
  const meta = page.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1";
  page.head.append(meta);
  const tokens = getComputedStyle(source);
  for (const name of [
    "--wt-font-family",
    "--wt-font-family-mono",
    "--wt-font-size-md",
    "--wt-font-size-xl",
    "--wt-space-3",
    "--wt-space-4",
    "--wt-space-5",
    "--wt-space-6",
    "--wt-color-text",
    "--wt-color-bg",
    "--wt-color-border",
    "--wt-radius-md",
  ]) {
    page.documentElement.style.setProperty(name, tokens.getPropertyValue(name));
  }
  const css = page.createElement("style");
  css.textContent = `
    :root { color-scheme: light dark; font-family: var(--wt-font-family); font-size: var(--wt-font-size-md); color: var(--wt-color-text); background: var(--wt-color-bg); }
    body { margin: 0; padding: var(--wt-space-5); }
    main { max-width: 900px; margin-inline: auto; }
    h1 { font-size: var(--wt-font-size-xl); }
    section { margin-block: var(--wt-space-6); break-inside: avoid; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--wt-font-family-mono); font-size: var(--wt-font-size-md); }
    [data-node-key] { border: 1px solid var(--wt-color-border); border-radius: var(--wt-radius-md); padding: var(--wt-space-4); }
    @media print {
      :root { color-scheme: light; --wt-color-text: CanvasText !important; --wt-color-bg: Canvas !important; }
      body { padding: 0; }
      [data-register-section] { break-before: page; }
      section { break-inside: auto; }
    }
  `;
  page.head.append(css);
  const main = page.createElement("main");
  page.body.append(main);
  function text(
    tag: string,
    content: string,
    attribute?: string,
    parent: HTMLElement = main,
  ): HTMLElement {
    const node = page.createElement(tag);
    node.textContent = content;
    if (attribute) node.setAttribute(attribute, "");
    parent.append(node);
    return node;
  }
  text("h1", t("node_pack.title"));
  text("p", t("node_pack.secret_warning"));
  text("p", pack.createdAt, "data-created");
  text("h2", t("node_pack.key"));
  text("p", pack.nodeRecovery.name, "data-key-name");
  text("p", pack.nodeRecovery.nodeId);
  text("pre", pack.nodeRecovery.secret, "data-node-key");
  text("p", t("node_pack.old_key_warning"), "data-old-key-warning");
  text("p", t("node_pack.archive_key_warning"), "data-archive-key-warning");
  const register = text("section", "", "data-register-section");
  text("h2", t("node_pack.register"), undefined, register);
  text("p", t("node_pack.snapshot_warning"), "data-snapshot-warning", register);
  text("pre", JSON.stringify(pack.modules, null, 2), "data-register", register);
  return "<!doctype html>\n" + page.documentElement.outerHTML;
}
