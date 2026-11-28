# Customer menu preview fixes

When you switch to Computer on a phone, the section links should move the preview canvas even if
its resize callback has yet to run. The desktop price test should check a card that gives the dish
name and price range enough room to sit side by side. Land one small PR off main for both fixes,
then rebase sharing PR #4579 onto it and require green CI on the new head.

## Jump to a section in the current scroll area

- In `apps/dashboard/src/screens/menus-screen.customer-preview.test.ts`, add “jumps immediately
  after the phone preview becomes a Computer canvas”. Open at 390 px with the existing scrollable
  host and `publishedSections()` fixture. Dispatch the size control's `wt-change` event with
  `value: "computer"`, await the preview's `updateComplete`, then call the section anchor's
  `click()` in that turn before the resize callback runs. Check that the canvas scrolls and the
  outer page stays where it was. First observe the
  test fail at canvas `scrollTop` 0. Keep the existing keyboard, focus, section and resize checks.
- In `apps/customer-menu/src/customer-menu-page.ts`, call the existing `#watchScroll()` at the start
  of `#jump` so it reads the actual scroll area and moves its scroll listener before using it.
  Keep the current heading focus, scroll offset and active link behavior. Run the new case and
  the dashboard and customer-menu preview test files. The diagnostic with the current code showed
  canvas `scrollTop` 0 and outer `scrollTop` 395 after the resize but before its observer ran.
- In the PR, explain why the same check can pass or fail. The existing test can see the active
  section left by Phone mode before the resize callback runs. The jump failed with the cached
  outer page and passed when the callback had already selected the canvas. CI's exact callback
  timing has yet to be measured. Record the review's dish-detail observation in the PR thread.

## Give the desktop alignment case room for both values

- In the same dashboard test file, use a 1440 px desktop viewport in “shows a phone list and a
  computer grid with dish declarations and a set-menu summary”, preserving the fixture, the
  360 px check and every assertion. Capture and restore the incoming viewport for the next test.
  The flex heading reserves half its width for the name, and ranges wrap when the price and gap
  need more than the other half. On untouched main in Linux Chromium, the 258 px heading at
  1200 px left 121 px after the 8 px gap. The 121.5625 px range wrapped and failed the overlap
  assertion. At 1440 px the 318 px heading gave the price 151 px and the same assertion passed.
  Run this case in Linux Chromium again on the finished branch.
  Keep the separate narrow Computer cases that check a short price alongside a name and a large
  range wrapping when space runs out.

Use the existing components and fixtures. Keep the work to the two named files, about two product
lines and 30 test lines. The guides and backlog describe the same user actions after these repairs.
