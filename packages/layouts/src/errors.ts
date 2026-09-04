// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/identity, packages/catalogue use.
import "@waitron/shared";
import type { CardType } from "./canvas.js";

// @waitron/layouts's contribution to the shared error registry, by declaration merging — the
// DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name (CLAUDE.md §3). Grep
// receipt for minting these two fresh families: on 2026-08-11
//   grep -rn '"layout\.\|"receipt\.\|"till\.' packages/**/src/errors.ts apps/server/src/errors.ts
// printed no match, so `layout.invalid` and `receipt.invalid` collide with no existing sibling.
// (2026-09-04 SP-B4: the `layout.invalid` code was removed with the old widget model — its only
// thrower, the widget-layout validator, was deleted; `receipt.invalid` remains, rehomed onto
// `tenant_receipts`.)
// Likewise for the profile/theme families (SP-A.1): on 2026-09-02
//   grep -rn '"profile\.\|"theme\.' packages/**/src/errors.ts apps/server/src/errors.ts
// printed no match, so `profile.invalid` and `theme.invalid` collide with no existing sibling.
// And for the two leaves the SP-A.2 management API adds under the profile family: on 2026-09-02
//   grep -rn 'profile\.not_found\|profile\.name_taken' packages/*/src/errors.ts apps/server/src/errors.ts
// matched only `profile.invalid`'s own declaration below, so `profile.not_found` and
// `profile.name_taken` collide with no existing sibling either.
// 2026-09-04 SP-B3.2 Phase A: profile.* renamed to canvas.* (pre-prod, no shipped consumers). The
// grep receipts above are historical — they record the collision check done when the profile.* family
// was minted under its original name; the active codes below are now canvas.invalid / canvas.not_found
// / canvas.name_taken.
//
// PARAM RULE (CLAUDE.md §1, the house's dominant defect class): every param NAMES the problem and
// NEVER echoes the offending user value. `reason` is a fixed enum of what went wrong; `configKey` /
// `field` carry a key/field NAME, never its value; `maxLength` is the policy cap, never the length
// that breached it. `tabIndex` is a numeric index locating a tab, never the author-supplied tab key
// or title; `card` only ever carries a valid CardType enum value (so an *unknown* card's arbitrary
// `type` string can never reach it — it stays `undefined` in that case); `token` only ever names an
// allowlisted `--wt-*` token, never an arbitrary/unknown one. A config VALUE never enters these params.
// `canvas.not_found` and `canvas.name_taken` carry NO params BY DESIGN: a not-found leaf must not
// echo the caller-supplied id (unlike the `station.not_found`-style siblings that do), and a taken
// name must never echo the offending author value (§1) — the fact of the collision is the whole
// message, so the management API maps them to 404 / 409 on the code alone.
declare module "@waitron/shared" {
  interface ErrorParams {
    // A ReceiptConfig failed validateReceiptConfig. `reason`:
    //   not_object    — the input was not a plain object;
    //   not_string    — a present field was not a string;
    //   too_long      — a field exceeded `maxLength` characters (the length is NOT echoed);
    //   unknown_field — a field outside headerSubtitle / footerMessage was present (fail-closed: a
    //                   silently-stripped field could suppress the fiscal core, design §8).
    // `field` names the offending field; `maxLength` is the policy cap for too_long.
    "receipt.invalid": {
      reason: "not_object" | "not_string" | "too_long" | "unknown_field";
      field?: "headerSubtitle" | "footerMessage";
      maxLength?: number;
    };
    // A CanvasDef failed validateCanvas. `reason` says which rule:
    //   not_object       — input (or a tab/card) was not a plain object;
    //   bad_capabilities — `capabilities` was not an array of known capability flags;
    //   bad_form_factor  — `formFactor` was not a FormFactor;
    //   no_tabs          — `tabs` was not a non-empty array;
    //   bad_tab          — a tab was malformed (missing/blank key or title, over-long title);
    //   duplicate_tab    — two tabs shared a `key`;
    //   bad_columns      — a tab's `columns` was not an integer in 1..GRID_MAX_COLUMNS;
    //   unknown_card     — a card was not an object, or its `type` was not a CardType (NOT echoed);
    //   bad_span         — a card's colSpan/rowSpan was out of range for its tab;
    //   bad_config       — a card's config had a key outside its contract or a value it rejected;
    //   bad_visible_when — a card's visibleWhen was not a subset of the card's declared states;
    //   missing_required — a sale-critical card was absent from a selling canvas.
    // `tabIndex` (numeric, never the author-supplied key) locates the tab; `card` names the card only
    // when it is a valid CardType; `configKey` names the offending config key.
    "canvas.invalid": {
      reason:
        | "not_object"
        | "bad_capabilities"
        | "bad_form_factor"
        | "no_tabs"
        | "bad_tab"
        | "duplicate_tab"
        | "bad_columns"
        | "unknown_card"
        | "bad_span"
        | "bad_config"
        | "bad_visible_when"
        | "missing_required";
      tabIndex?: number;
      card?: CardType;
      configKey?: string;
    };
    // A GET-by-id on the management canvas surface named no canvas the tenant owns (an absent id, or
    // another tenant's row RLS hides). No params: the caller-supplied id is not echoed (§1) — the
    // management API answers 404 on the code alone.
    "canvas.not_found": Record<string, never>;
    // A canvas create/update collided on the per-tenant `canvases_tenant_name_key` unique — a
    // duplicate name. `canvas-store.ts` translates the driver's 23505 into this so a duplicate returns
    // a clean 409, never a raw 500. No params: the offending name is never echoed (§1).
    "canvas.name_taken": Record<string, never>;
    // A ThemeOverride failed validateThemeOverride. `reason`:
    //   not_object    — input was not a plain object;
    //   bad_tokens    — `tokens` was missing or not a plain object;
    //   unknown_token — a token name outside the THEMEABLE_TOKENS allowlist (the name is NOT echoed,
    //                   fail-closed: an un-allowlisted CSS property must never reach the stylesheet);
    //   bad_value     — an allowlisted token's value was not a string, or failed the charset guard;
    //   too_long      — a value exceeded `maxLength` chars (the length is NOT echoed).
    // `token` names the offending token ONLY when it is allowlisted (bad_value / too_long); `maxLength`
    // is the policy cap.
    "theme.invalid": {
      reason: "not_object" | "bad_tokens" | "unknown_token" | "bad_value" | "too_long";
      token?: string;
      maxLength?: number;
    };
  }
}
