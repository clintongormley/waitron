import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import {
  FIXTURE_LIGHT_BG,
  SERIF_BOLD_SHEET,
  TEXT_130_SHEET,
  WAITRON_LIGHT_BG,
} from "@waitron/ui/test/venue-theme-fixture.js";
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

it("the sheet carries Waitron's type and the page's colours under a theme at 130%", () => {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, TEXT_130_SHEET];
  const source = document.createElement("div");
  document.body.append(source);
  applyTokens(source);
  source.setAttribute("data-theme", "light");
  source.style.setProperty("--wt-color-bg", FIXTURE_LIGHT_BG);
  try {
    expect(FIXTURE_LIGHT_BG).not.toBe(WAITRON_LIGHT_BG);
    const sourceTokens = getComputedStyle(source);
    expect(sourceTokens.getPropertyValue("--wt-font-size-md")).toBe("18px");
    const page = new DOMParser().parseFromString(renderNodeRecoveryPack(pack, source), "text/html");
    const root = page.documentElement.style;
    expect(root.getPropertyValue("--wt-font-size-md")).toBe("14px");
    expect(root.getPropertyValue("--wt-font-size-xl")).toBe("22px");
    expect(root.getPropertyValue("--wt-font-family")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family"],
    );
    expect(root.getPropertyValue("--wt-font-family-mono")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family-mono"],
    );
    expect(root.getPropertyValue("--wt-color-bg")).toBe(FIXTURE_LIGHT_BG);
  } finally {
    source.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== TEXT_130_SHEET,
    );
  }
});

it("the sheet keeps Waitron's typefaces under a theme in Serif", () => {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, SERIF_BOLD_SHEET];
  const source = document.createElement("div");
  document.body.append(source);
  applyTokens(source);
  source.setAttribute("data-theme", "light");
  try {
    expect(getComputedStyle(source).getPropertyValue("--wt-font-family")).toMatch(/^ui-serif/);
    const page = new DOMParser().parseFromString(renderNodeRecoveryPack(pack, source), "text/html");
    const root = page.documentElement.style;
    expect(root.getPropertyValue("--wt-font-family")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family"],
    );
    expect(root.getPropertyValue("--wt-font-family-mono")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family-mono"],
    );
  } finally {
    source.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== SERIF_BOLD_SHEET,
    );
  }
});
