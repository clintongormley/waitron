import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { renderNodeRecoveryPack } from "./node-recovery-print.js";

afterEach(cleanupWidgets);

const pack = {
  version: 1 as const,
  kind: "node-recovery-pack" as const,
  createdAt: "2026-10-14T10:00:00.000Z",
  nodeRecovery: {
    nodeId: "node-one",
    name: "2026-10-14 · K7QF",
    secret: "key-<script>alert(1)</script>",
  },
  modules: {
    "test-regime": { signedRegister: "public-evidence", fingerprint: "known-fingerprint" },
  },
  warnings: ["register-snapshot-may-be-stale"],
};

it.each(["en-GB", "es-ES"] as const)(
  "prints the named key and retained signed register as inert text in %s",
  (locale) => {
    const old = currentLocale();
    try {
      setLocale(locale);
      const page = new DOMParser().parseFromString(
        renderNodeRecoveryPack(pack, document.body),
        "text/html",
      );
      expect(page.documentElement.lang).toBe(locale);
      expect(page.querySelector("[data-key-name]")?.textContent).toBe("2026-10-14 · K7QF");
      expect(page.querySelector("[data-node-key]")?.textContent).toBe(pack.nodeRecovery.secret);
      expect(page.querySelector("[data-register]")?.textContent).toContain("known-fingerprint");
      expect(page.querySelector("[data-register]")?.textContent).toContain("public-evidence");
      expect(page.querySelector("[data-created]")?.textContent).toContain(
        "2026-10-14T10:00:00.000Z",
      );
      expect(page.querySelectorAll("script,iframe,link,img")).toHaveLength(0);
      expect(page.querySelector("[data-snapshot-warning]")?.textContent).toBeTruthy();
      expect(page.querySelector("[data-old-key-warning]")?.textContent).toBeTruthy();
      expect(page.querySelector("[data-archive-key-warning]")?.textContent).toBeTruthy();
    } finally {
      setLocale(old);
    }
  },
);

it("gives the printed page the colour scheme of the screen it copies its colours from", () => {
  const scheme = (source: HTMLElement): string => {
    const page = new DOMParser().parseFromString(renderNodeRecoveryPack(pack, source), "text/html");
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(page.querySelector("style")!.textContent!);
    const root = [...sheet.cssRules].find(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ":root",
    )!;
    return root.style.getPropertyValue("color-scheme");
  };
  const themed = (theme: "light" | "dark"): HTMLElement => {
    const div = document.createElement("div");
    document.body.append(div);
    applyTokens(div);
    div.setAttribute("data-theme", theme);
    return div;
  };
  const dark = themed("dark");
  const light = themed("light");
  try {
    expect(scheme(dark)).toBe("dark");
    expect(scheme(light)).toBe("light");
    expect(getComputedStyle(document.body).colorScheme).toBe("normal");
    expect(scheme(document.body)).toBe("light dark");
  } finally {
    dark.remove();
    light.remove();
  }
});
