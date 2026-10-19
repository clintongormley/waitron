# A799: invented source agreed; release checks await your choice

The owner chose an invented venue created by a frozen older image through its normal product paths on 19 October 2026. This source choice alone is approved. The [current design addendum](../../../../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md) takes precedence over the historical first question.

**Before publishing R5, should required upgrade checks start from the oldest supported frozen release R1 and immediately previous retained release R4 (recommended), or every retained release R1, R2, R3 and R4?** All five releases are illustrative, within the same post-A760 history. Both options keep every original bundle and its expectations. Checking R1 and R4 gives no passing evidence for R2 or R3, and changes no support or retirement policy. The smaller selection uses fewer required checks; the alternative can catch a defect specific to an intermediate release.

| Language | Phone, light                                         | Phone, dark                                         | Desktop, light                                         | Desktop, dark                                         |
| -------- | ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| English  | [390 px](source-and-release-checks-en-light-390.png) | [390 px](source-and-release-checks-en-dark-390.png) | [1280 px](source-and-release-checks-en-light-1280.png) | [1280 px](source-and-release-checks-en-dark-1280.png) |
| Español  | [390 px](source-and-release-checks-es-light-390.png) | [390 px](source-and-release-checks-es-dark-390.png) | [1280 px](source-and-release-checks-es-light-1280.png) | [1280 px](source-and-release-checks-es-dark-1280.png) |

Each PNG has its same-named SVG source. Colours are resolved from the repository's UI tokens. These are static review drawings, not product screens or evidence of an upgrade run. The parent rendered and visually inspected all eight versions and measured native SVG text bounds. The existing optional-module-off variants remain proposed and duplicate endpoints are counted once. A same-image restart alone does not meet the requirement for a later image applying a pending migration.

Artifact storage/access, declared support/retirement, issued full-invoice coverage, capture determinism/time and complete design, plan and build approval remain open. A760's squash/reset remains a separate authorised operator job; this revision starts none of it.
