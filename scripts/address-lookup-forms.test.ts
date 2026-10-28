/**
 * A form that asks for a postal address puts `wt-address-lookup` above its address fields
 * (docs/developers/design-system.md → Forms → Addresses).
 *
 * Weaker than its name: it reads TEXT. It takes a non-test `.ts` file under `apps/*\/src` for an
 * address form when the file holds the string literal "addressLine1" or "streetAddress" and draws a
 * `<wt-input` or `<wt-textarea`, so a form naming its address fields otherwise — the setup screen's
 * one-line registered business address, `taxpayerDomicile`, is one — is not seen; and it checks
 * that the file holds `<wt-address-lookup` somewhere, not where, nor that it is handed a provider.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** Address forms still to gain the search field; the list shrinks. */
const WAITING: Readonly<Record<string, string>> = {
  "apps/till/src/widgets/invoice-recipient-dialog.ts":
    "A1171 part 3, after lane E's A963 rebuilds the dialog",
};

/** Files that name an address field and draw some other field, but are not address forms. */
const NOT_ADDRESS_FORMS: Readonly<Record<string, string>> = {
  "apps/setup/src/setup-app.ts": "assembles the venue draft; the field it draws is not an address",
};

export function looksLikeAddressForm(source: string): boolean {
  return /"(?:addressLine1|streetAddress)"/.test(source) && /<wt-(?:input|textarea)\b/.test(source);
}

export function offersAddressSearch(source: string): boolean {
  return /<wt-address-lookup\b/.test(source);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return stat.isFile() && name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

function addressForms(): Map<string, string> {
  const forms = new Map<string, string>();
  for (const app of readdirSync(join(ROOT, "apps"))) {
    const src = join(ROOT, "apps", app, "src");
    let found: string[];
    try {
      found = sourceFiles(src);
    } catch {
      continue;
    }
    for (const path of found) {
      const source = readFileSync(path, "utf8");
      if (looksLikeAddressForm(source)) forms.set(relative(ROOT, path), source);
    }
  }
  return forms;
}

describe("address forms offer the shared address search", () => {
  const forms = addressForms();

  test("finds the address forms it knows of", () => {
    expect([...forms.keys()]).toEqual(
      expect.arrayContaining([
        "apps/setup/src/screens/venue-screen.ts",
        "apps/dashboard/src/screens/venue-details-panel.ts",
        ...Object.keys(WAITING),
      ]),
    );
  });

  test("every address form holds wt-address-lookup", () => {
    const missing = [...forms]
      .filter(([path]) => !(path in WAITING) && !(path in NOT_ADDRESS_FORMS))
      .filter(([, source]) => !offersAddressSearch(source))
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });

  test("a waiting form that gained the search is taken off the list", () => {
    for (const path of Object.keys(WAITING)) {
      expect(forms.has(path), path).toBe(true);
      expect(offersAddressSearch(forms.get(path)!), path).toBe(false);
    }
  });

  test("each file excused as not an address form still matches, so the excuse is not stale", () => {
    for (const path of Object.keys(NOT_ADDRESS_FORMS)) expect(forms.has(path), path).toBe(true);
  });

  test("the matcher needs both an address field name and a drawn field", () => {
    expect(looksLikeAddressForm('const f = "addressLine1"; html`<wt-input>`')).toBe(true);
    expect(looksLikeAddressForm('const f = "streetAddress"; html`<wt-textarea>`')).toBe(true);
    expect(looksLikeAddressForm('const f = "addressLine1";')).toBe(false);
    expect(looksLikeAddressForm('const f = "addressLine2"; html`<wt-input>`')).toBe(false);
    expect(offersAddressSearch("html`<wt-address-lookup .provider=${p}>`")).toBe(true);
    expect(offersAddressSearch("html`<wt-address-lookups>`")).toBe(false);
  });
});
