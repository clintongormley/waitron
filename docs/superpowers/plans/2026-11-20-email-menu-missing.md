# Restore Email to the System menu after a box takes over

A person with permission to manage staff can find **System → Email** on a configured box
even when the box came from a switch or restore. Demo keeps its separate Email inbox.

Lane D's EMAIL-MENU-MISSING queue item records the owner's report from the Lenovo primary.
A read of its public locales route returned a configured venue and omitted `onboardingIntent`.
The server's copy placement writes trading settings without a setup intent when creating the
copy's configuration. The signed-in dashboard reads the same optional field from
`/management-api/session/me`. Its sidebar currently requires an explicit Prepare or Live intent
for Email. The existing Email settings route excludes explicit Demo from editing and uses its
own permissions for viewing and saving the relay.

## One change

1. In `apps/dashboard/src/dashboard-app.test.ts`, make the existing “lists Email under
   System” matrix expect Email for permitted roles when the session response omits the
   intent, as on the switched primary. Keep its Prepare, Live, Demo and direct-link
   permission assertions. Run
   `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t 'lists Email under System'`.
   The switched-primary row should fail on the missing sidebar entry.
2. In `apps/dashboard/src/dashboard-app.ts`, make the Email sidebar exception apply only
   to explicit Demo. Reuse the existing `person.manage` rule and keep the screen's
   permissions and server routes as they are. Setup, promotion and mail delivery are
   outside this change.
3. Run the changed dashboard test file. Open System in a disposable dashboard with the
   switched-primary response and open Email from there. Inspect English and Spanish in
   both themes at phone and desktop widths.
4. In `apps/server/src/guide/{en,es}/email.md`, give the System → Email instruction without
   limiting it to the original setup mode. Keep the separate Demo instructions. Correct
   the matching availability sentence in `docs/backlog/box.md` and keep A987 open. Run
   `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.

Expected additions are under five lines of production code and about 15 lines of tests.
