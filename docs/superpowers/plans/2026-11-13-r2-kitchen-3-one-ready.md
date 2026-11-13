# R2-KITCHEN-3 — One Ready per pass card

**Finish line:** each In progress pass card has one Ready, including multi-course and no-course counter orders. It readies only that card’s fired dishes. Both device surfaces enforce Runs the pass. One PR, under three active hours.

**Ask, verbatim:** “the pass shows one Ready button per pass card, counter and no-course orders included, and the server refuses Ready from a device or person without "Runs the pass".” Source: Lane I `~/waitron-campaign-i/queue.md`, R2-KITCHEN-3. The queue records the owner’s yes to Proposal 3 on 11 November. `~/waitron-campaign-m/reports/r2.md` §§2–3 supplies findings 3, 4, 6 and Proposal 3. The linked desk decision says the answer was recorded in the lanes; it does not contain the owner’s answer text or approve this plan.

## Smallest build

Reuse `PassTarget` and `readPassCardRows` from `apps/server/src/{pass-card,pass-board}.ts`: group cards span their party’s bills; bill cards contain ungrouped lines only. Keep current station/zone visibility and whole-card behavior for dimmed/hidden dishes. Leave held/requested dishes unchanged.

Replace `working-order.ts:bumpCourseReady` with `bumpPassCardReady(tx, target, firer?, attendance?)`, returning changed `{ orderId }[]`. Reuse `advanceSet("ready")`. Have `order-groups.ts:bumpGroupReady` delegate the write while its existing `passStep` keeps revision/replay and attendance capture once.

Keep both group routes and their command/response shapes. Replace course routes with `POST /api/orders/:id/ready` and `/api/device/orders/:id/ready` (`{}` body, empty 200), targeting ungrouped bill cards. Reuse `pass-release.ts:passReleaseRefusal`; retain preparation, device proof, session-person, admission, screen-mode and zone checks. Remove the superseded course routes/client methods.

**Permission interpretation for review:** `run-the-pass` is a screen flag, not a person permission. Follow Fire: require the device flag plus the signed-in person’s existing prepare-orders permission. KDS routes retain their device-only admission. Add no new permission; the watcher must settle whether this meets the queue’s “device or person” wording before implementation.

In `apps/till/src/{state/pass-view,widgets/pass-board,screens/till-pass-screen,api/client}.ts`, replace course/group lever fields with one Ready flag, a `pass-ready { key }` event and one handler selecting the card target. Retain group revision/refusal recovery, bill refusal recovery, monitors, All stations and the help badge. Production server edits are `{working-order,order-groups,till-api,device-levers,pass-release,pass-card}.ts`; `device-api.ts` supplies existing error mapping. Server `pass.ts` is fiscal machinery and is excluded.

## TDD and test ownership

1. **Domain:** first fail `working-order.test.ts` cases “pass card Ready crosses courses including no course” and “pass card Ready leaves grouped siblings unchanged”. Preserve fired-only, held/requested, timestamps and repeated-action assertions. Keep `order-groups.test.ts` split-bill and revision/replay checks. Implement the shared writer; routes do not repeat membership cases.
2. **Routes:** in `{device-levers,till-api.courses,till-api.groups,till-api.profile-actions,till-api.profile-zones,till-api.session-person}.test.ts`, first fail missing-pass-flag refusals on both surfaces/targets (403 `device.forbidden_action`, unchanged rows), then allowed requests. Preserve preparation/person/proof/zone and group revision checks. Replace bill URL/body mapping and retired-course 404 checks. Extend successful display fixtures with the flag.
3. **Till:** first fail one-button group, multi-course and no-course cases in `{state/pass-view,widgets/pass-board,screens/till-pass-screen.levers}.test.ts`; retain no Ready outside In progress/on monitors/without the flag, and hidden-card behavior. Check card-key events, correct client target, refresh and distinct refusal recovery. Update `api/{client,party-allergy-client}.test.ts` and existing screen/widget help/accessibility/dispatch and till-app fixtures; preserve their behavioral assertions.
4. Update direct writer consumers `{attendance-kitchen-service,kitchen-delete.integration,split-off-extras.release}.test.ts`, keeping credited-person checks. Deliberately replace course-order/course-label/no-course-no-button and unknown-course-no-op checks with the accepted card contract; document every changed check in the PR.

## Wording, checks and limits

Use Ready / Listo in till `i18n/{strings,help-strings}.ts`; retire `expo.group_ready`. Update server `guide/{en,es}/kitchen-service.md`, preserving anchors, and current course-lever prose in `docs/developers/{conventions-ui,design-system}.md` and `docs/backlog/till.md`; update the root backlog without closing unrelated work.

Run new cases red, then green, and every changed test file before finishing. Focused commands: `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts -t 'pass card Ready'`; equivalent package commands for the named route and till files; server `guide-content.test.ts` and root `scripts/guide-links.test.ts`. Require Tests counts; use the normal hook and current-head CI. Check browser headroom, then inspect EN/ES × light/dark × phone/desktop through `wa-wt demo waitron-feat-i-r2-kitchen-ready`; keep screenshots uncommitted.

Exclude other R2 proposals, Fire changes, Undo, new tables/records/protocols and unrelated cleanup. Expected additions/removals: production +130–190/−180–260; tests +220–320/−280–400; support +0–20/−0–20; guides/strings +25–45/−30–55. Report actual counts separately.
