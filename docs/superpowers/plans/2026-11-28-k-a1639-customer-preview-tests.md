# Customer menu preview fixes

When you switch to Computer on a phone, the section links should move the preview canvas even if
its resize callback has yet to run. The desktop price test should check a card that gives the dish
name and price range enough room to sit side by side. Land these two fixes before sharing PR #4579.

## Jump to a section in the current scroll area

- In `apps/dashboard/src/screens/menus-screen.customer-preview.test.ts`, add “jumps immediately
  after the phone preview becomes a Computer canvas”. Open at 390 px with the existing scrollable
  host and `publishedSections()` fixture. Trigger the existing size control's Computer change and
  await the preview's render, then click the section link in that turn before the resize callback
  runs. Check that the canvas scrolls and the outer page stays where it was. First observe the
  test fail at canvas `scrollTop` 0. Keep the existing keyboard, focus, section and resize checks.
- In `apps/customer-menu/src/customer-menu-page.ts`, call the existing `#watchScroll()` at the start
  of `#jump` so it reads the actual scroll area and moves its scroll listener before using it.
  Keep the current heading focus, scroll offset and active link behavior. Run the new case and
  the dashboard and customer-menu preview test files. The diagnostic with the current code showed
  canvas `scrollTop` 0 and outer `scrollTop` 395 after the resize but before its observer ran.

## Give the desktop alignment case room for both values

- In the same dashboard test file, use a 1440 px desktop viewport in “shows a phone list and a
  computer grid with dish declarations and a set-menu summary”, preserving the fixture, the
  360 px check and every assertion. On untouched main in Linux Chromium the 258 px heading at
  1200 px wrapped the range and failed the overlap assertion. At 1440 px the heading was 318 px
  and the same assertion passed. Run this case in Linux Chromium again on the finished branch.
  Keep the separate narrow Computer cases that check a short price alongside a name and a large
  range wrapping when space runs out.

Use the existing components and fixtures. Keep the work to the two named files, about two product
lines and 30 test lines. The guides and backlog describe the same user actions after these repairs.
