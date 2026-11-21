# A1559 — Show password

You can check and hide the password you typed on the joining box's **Connect to the primary**
screen without losing your place. Lane D's A1559 queue records the owner's 20 November report
and asks for shared behaviour and the Profile migration.

- [ ] In `apps/setup/src/screens/connect-screen.test.ts`, use the existing fingerprint and
  sign-in fixture to show that the password starts masked and that the visibility button
  reveals it without sending an adopt request. In `packages/ui-core/src/components/wt-input.test.ts`,
  assert keyboard and pointer activation, retained value and selection in both directions,
  and no change or submit event. Exercise a form clearing its password, a person editing it
  to empty, a disabled field, and a caller's existing end action. See the failures first.
- [ ] In `packages/ui-core/src/components/wt-input.ts`, add a `.passwordVisibility` property
  with the caller's show, hide, shown and hidden text. Use Profile's eye on a ghost
  `wt-button` as the end slot's fallback. Reserve room while the fallback is available.
  Change the type of the same native input and restore its selection. Preserve name,
  autocomplete and keyboard focus. Start masked on entry and when the form clears or
  replaces the password. Announce the state in a polite status region, using a label that
  names the available action. [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [ ] Pass the words from the apps' existing translation tables at the missing password
  fields in setup's `connect-screen.ts`, `handover-screen.ts` and `initial-setup-screen.ts`,
  and dashboard's `box-wifi-dialog.ts`. Move Profile's password and PIN fields in
  `profile-screen.ts` onto the shared control with their own names, and use `FormFeedback`
  for the editor's existing attempt and refusal feedback. In `profile-screen.test.ts`,
  check that showing one field leaves the other masked and a reopened editor starts masked.
- [ ] Check setup and dashboard login fields that already have buttons using their existing
  tests and the field inventory. The till uses its PIN keypad. Keep payment tokens, backup
  and recovery keys, and certificate passphrases under their existing controls. The
  HTML-only Start again page keeps the owner's script-free rule in `conventions-ui.md`.
  Carry on and the waiting-clock HTML also stay outside this pass. The published UI package's
  existing consumers keep their current behaviour unless they supply the new property.
- [ ] Run the focused app suites and the component, token paint, forced-colour and
  `wt-input.a11y.test.ts` checks, with masked and revealed states in both themes. Run the
  ui-core consumer check and check the component under the package's mutation rules.
  Inspect the real Connect screen in English and Spanish at phone and desktop widths and
  in both themes. Update Forms in `docs/developers/design-system.md` and both
  `apps/server/src/guide/{en,es}/servers.md` files, and run the guide-link guards.

About 90–130 added production lines and 90–135 added test lines, plus deletions in Profile
and short guide edits. Authentication requests and server routes stay as they are.
