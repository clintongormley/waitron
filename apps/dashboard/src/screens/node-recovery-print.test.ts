import { afterEach, expect, it } from "vitest";
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
