# Guest language rule implementation plan

**Status: WATCHER-NEEDED; not cleared to build.** Authority: lane D GUEST-LANGUAGE-RULE, watcher 2026-11-17 15:46, corrected 15:52, pasted in the authoring request. The driver obtains Claude approach review and watcher clearance; neither means owner plan approval.

**Owner's words, verbatim:**

> "why ?lang= and ?language= - let's use just one version"
>
> "this should always be in the main language, whatever it is. if the choice is hardcoded to spanish or english then it is a bug"
>
> "we don't want hardcoded exceptions, we need a rule that works everywhere"
>
> "As we add translations, this should work correctly. So if we don't have the translation yet we can fall back to the main language, but when the translation is available it should just work"
>
> "yes"; "we should fix the cloud's menu page to follow the phone langs"
>
> "Yes, same base counts"

**Preservation decision before build.** Base-only removal turns Valencian into `ca`, changing required/starting languages through `packages/country-packs/src/registry.ts:131–174`. Keeping its full tag instead conflicts with regional-default/base-membership validation in `packages/menu/src/content-languages.ts:162–181`. Adding `ca` changes receipt offers through `apps/server/src/venue-locale.ts:75–87`. Their immediate tests (`registry.test.ts`, `content-languages.valencian.test.ts`, `venue-locale.test.ts`) pin these distinctions. These are source findings, not executed proofs.

Ask the watcher to settle a general identity rule preserving Valencia's enabled/default tags, separate authored text and prints. Recommend separating preference matching from identity. Do not silently enable Catalan, make all regional tags main languages, or declare completion with the exception retained. Its picker entry and EN/ES name also need replacement (`packages/shared/src/content-languages.ts:59,100–115`). Consumer trace covered validators, country setup/import, translation targets/gaps, media normalization/search, dashboard fields/pickers, live/snapshot resolvers, till product naming, receipt admission and kitchen unit naming.

**Copy exactly to Cloud lane G:** Canonicalize tags with `Intl.Locale`, discard extensions; ignore invalid preferences. Walk Accept-Language by descending positive `q`, header order for ties; ignore malformed, zero-weight and wildcard entries. For each preference try exact tag, then drop trailing parts individually, then the first enabled venue tag with the same base. Finish that preference before the next. No match means main. Explicit `?lang=` (including tapped links) replaces phone preferences; invalid/unmatched explicit choices use main. Ignore `?language=`. Match fixed wording against available bundle tags in the same way: shown language, then main, then English; retain the bundle's actual language. Thus `ca` reaches sole `ca-ES-valencia`, `en` reaches sole `en-US`, but exact `en` wins when offered.

**Inline TDD after clearance; smallest usable implementation:**

1. Create `packages/shared/src/language-match.ts` and `.test.ts`: `matchLanguage(preferences: readonly string[], offered: readonly string[]): string | undefined`, exported by `packages/shared/src/index.ts`, independent of `contentLanguageCode`. Test exact/parent/base precedence, multi-part truncation, earlier preference versus later exact match, ties, invalid input and the examples above. Reuse in `packages/shared/src/menu-document/guest-menu.ts`; its `.test.ts` asserts selected tags and distinct dish text. Preserve existing text/snapshot fallback.
2. Change `apps/server/src/guest-menu-api.ts` and `guest-menu-page.ts`: phone preferences only without `lang`; public/preview reads and links use only `lang`; remove the renderer's query-name argument and update its Cloud-page call. Reuse projection, renderer and committed reads. In `guest-menu-api.test.ts`, reuse real `useVenueDb` fixtures for weighted phone selection, no-match main, explicit override, ignored old parameter, GET/HEAD and unavailable wording. Change `apps/dashboard/src/api/client.ts` and `widgets/guest-menu-preview.test.ts` to send/assert `lang`; retain paper JSON's `language`.
3. Change `packages/shared/src/i18n/guest-menu.ts` and `.test.ts`: match the existing translation table's bundle tags generically; new translations require data only. Assert regional wording, main fallback and English fallback separately from dishes. In `apps/server/src/guest-menu-page.test.ts`, assert `?lang=` links and wording language in the DOM. Update guest-menu sections in `docs/developers/products.md` and `design-system.md`.

For each step: owning-layer assertion, observed expected failure, minimal implementation, passing rerun. Run `pnpm --filter @waitron/<package> exec vitest run src/<named-test-file>` for each named suite. Inspect phone-width guest rendering and both dashboard themes with the existing browser harness. Preserve behavioral assertions; commit no captures/runtime files. Authoring ran no tests.

**Size/exclusions/outside opinion:** Guest work: estimated 100–170 code lines, separately 160–240 test lines; identity/picker work unestimated until settled. Exclude frameworks, persisted records, migration, compatibility, new translations, Cloud build (G), receipts/till language lists (L), kitchen headings (C). Claude must challenge Valencia offer/print preservation and scope before build; the watcher then clears revised exact files and size.
