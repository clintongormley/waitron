/**
 * The dashboard's certificate dialog carries its own copy of the setup wizard's export guides,
 * because a module cannot import from `apps/setup`. This pins the copy to setup's text and each
 * guide's id, title key, link and steps, reading setup's guide list as TEXT. The dashboard shows
 * the guides under the file field, so each step-3 sentence there says "above" where setup's says
 * "below".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { venueEn, venueEs } from "../apps/setup/src/i18n/strings/venue.js";
import {
  EXPORT_GUIDES,
  EXPORT_GUIDE_STRINGS,
} from "../packages/fiscal-verifactu/src/dashboard/export-guides.js";

type Entry = { en: string; es: string };
type Copy = Record<string, Entry>;

interface Guide {
  id: string;
  title: string;
  href: string;
  steps: string[];
}

/** Setup's guides, read as TEXT: `GUIDES` is not exported. */
function setupGuides(): Guide[] {
  const source = readFileSync(
    resolve(import.meta.dirname, "../apps/setup/src/certificate-export-help.ts"),
    "utf8",
  );
  const shape = /id: "(\w+)",\s*title: "([^"]+)",\s*href: "([^"]+)",\s*steps: \[([^\]]*)\]/g;
  return [...source.matchAll(shape)].map((match) => ({
    id: match[1]!,
    title: match[2]!,
    href: match[3]!,
    steps: [...match[4]!.matchAll(/"([^"]+)"/g)].map((step) => step[1]!),
  }));
}

function setupLinks(): [string, string][] {
  return setupGuides().map((guide) => [guide.id, guide.href]);
}

const STEP3 = new Set([
  "cert_help.windows.step3",
  "cert_help.mac.step3",
  "cert_help.firefox.step3",
]);

/** Setup's sentence as the dashboard should read it. */
function expected(key: string, setup: Entry): Entry {
  if (!STEP3.has(key)) return setup;
  return {
    en: setup.en.replace(" below ", " above "),
    es: setup.es.replace(" abajo ", " arriba "),
  };
}

/** Every difference between setup's `cert_help.*` strings and the dashboard's copy. */
function differences(en: Record<string, string>, es: Record<string, string>, copy: Copy): string[] {
  const keys = Object.keys(en).filter((key) => key.startsWith("cert_help."));
  const out: string[] = [];
  for (const key of keys) {
    const want = expected(key, { en: en[key]!, es: es[key]! });
    const got = copy[key];
    if (got === undefined) out.push(`${key}: missing from the dashboard copy`);
    else {
      if (got.en !== want.en)
        out.push(`${key} (en): ${JSON.stringify(got.en)} != ${JSON.stringify(want.en)}`);
      if (got.es !== want.es)
        out.push(`${key} (es): ${JSON.stringify(got.es)} != ${JSON.stringify(want.es)}`);
    }
  }
  for (const key of Object.keys(copy)) {
    if (!keys.includes(key)) out.push(`${key}: not in setup's strings`);
  }
  return out;
}

const copy: Copy = EXPORT_GUIDE_STRINGS;

describe("the dashboard's certificate export guides", () => {
  it("compares a non-empty key set", () => {
    expect(
      Object.keys(venueEn).filter((key) => key.startsWith("cert_help.")).length,
    ).toBeGreaterThan(0);
  });

  it("match setup's cert_help strings, with each step 3 pointing above instead of below", () => {
    expect(differences(venueEn, venueEs, copy)).toEqual([]);
  });

  it("each step-3 swap changes setup's sentence, so it is not compared verbatim by accident", () => {
    for (const key of STEP3) {
      const setup = {
        en: (venueEn as Record<string, string>)[key]!,
        es: venueEs[key as keyof typeof venueEs],
      };
      const want = expected(key, setup);
      expect(want.en).not.toBe(setup.en);
      expect(want.es).not.toBe(setup.es);
    }
  });

  it("carry setup's three FNMT links", () => {
    const links = setupLinks();
    expect(links.map(([id]) => id)).toEqual(["windows", "mac", "firefox"]);
    expect(EXPORT_GUIDES.map((guide) => [guide.id, guide.href])).toEqual(links);
  });

  it("carry setup's title key and steps for each guide", () => {
    const guides = setupGuides();
    expect(guides.every((guide) => guide.steps.length > 0)).toBe(true);
    expect(
      EXPORT_GUIDES.map((guide) => ({
        id: guide.id,
        title: guide.title,
        href: guide.href,
        steps: [...guide.steps],
      })),
    ).toEqual(guides);
  });

  it("report a planted one-word change", () => {
    const planted: Copy = { ...copy };
    planted["cert_help.mac.step2"] = {
      ...copy["cert_help.mac.step2"]!,
      en: copy["cert_help.mac.step2"]!.en.replace("folder", "directory"),
    };
    expect(differences(venueEn, venueEs, planted)).toEqual([
      expect.stringContaining("cert_help.mac.step2 (en)"),
    ]);
  });

  it("report a missing key and an extra one", () => {
    const planted: Copy = { ...copy, "cert_help.extra": { en: "x", es: "x" } };
    delete planted["cert_help.heading"];
    expect(differences(venueEn, venueEs, planted)).toEqual([
      "cert_help.heading: missing from the dashboard copy",
      "cert_help.extra: not in setup's strings",
    ]);
  });
});
