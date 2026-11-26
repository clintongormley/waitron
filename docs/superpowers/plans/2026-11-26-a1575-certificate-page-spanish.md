# A1575. The box’s certificate page in Spanish

People opening the box’s certificate guide from the till or by address can read the
download and installation instructions in the language their browser prefers. The
[A1575 backlog entry](https://github.com/clintongormley/waitron/blob/b5425d2ba9f3306ea51957d46bd9ae5a3cb8fbc4/docs/backlog/setup.md#a1575-the-boxs-certificate-page-in-spanish)
asks for the dashboard login’s language matching and the repair page’s device wording.

## One change

- [ ] Add failing cases in `apps/server/src/landing-app.test.ts` and
  `discovery-api.test.ts` for Spanish on the HTTP guide and the HTTPS `/setup/trust`
  alias. Use `fr-FR,es-ES;q=0.9,en;q=0.8` for HTTP and check that the browser gets
  `lang="es"` and a Spanish heading. Check English without a preference and
  `Vary: Accept-Language` on the localized responses. In `trust-page.test.ts`, cover
  Spanish removal and installation for a known device, the other-device list for
  an unknown one, and the message when there is no certificate. Check the Spanish
  warning appears first, with English marked `lang="en"`, before step 1. Extend the existing
  Android touch regression in `trust-page.browser.test.ts` with Spanish to check
  what the person sees after the page replaces the Linux steps.
- [ ] Run those four test files and check that the Spanish cases fail because the guide
  renders English.
- [ ] In `landing-app.ts` and `discovery-api.ts`, send the request’s browser preference
  through the existing `connectionLocale` helper to `TrustPageInput.locale`. As on
  the till’s connection screen, fall back to English when neither language matches.
  Vary these guide responses by that header and retain their cache policy. In
  `trust-page.ts`, use authored copy from `i18n/trust-page.ts` for the title,
  headings and guidance. Keep its sparse markup and verify any quoted browser
  labels in Spanish. Reuse `CONNECTION_TEXT[locale].continue` for the Continue
  link. Render device headings, summaries, removal lists, install steps and notes
  from the same `DEVICE_HELP` and `CONNECTION_DEVICE_ES` data the repair page
  reads, including the Android touch template. Keep both versions of the
  unconfigured-box warning from #3995, with the page language first and an
  explicit language on the other paragraph. The certificate routes, navigation,
  styles and repair page are outside this translation.
- [ ] Run the four changed test files, the existing `connection-bootstrap-page.test.ts`
  and `connection-bootstrap.test.ts` suites, the guide case in
  `connection-bootstrap.entry.test.ts`, and Server typecheck. Look at the rendered
  guide in Chromium at 390 px and desktop width in both languages and themes,
  checking the computed theme colours. Save the Spanish phone pictures in Lane H’s
  receipts and give them to the owner through the watcher before landing.
- [ ] Update the certificate section of the English and Spanish
  `apps/server/src/guide/*/table-service.md` to say what language the box’s guide
  uses. Remove A1575 from `docs/backlog.md` and `docs/backlog/setup.md` when its
  checks pass. Run the guide link and wording guards, then sign off the change.

Allow about 130–155 added product lines, mostly wording, and 45–70 added test lines.
