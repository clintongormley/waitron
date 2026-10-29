# A1186 proposed completion invitation

Open [the editable standalone mockup](index.html#en-light). It proposes an optional card at the end of the existing setup completion page. It is documentation, not running Waitron: product controls are static text; only the language/theme variant links work. No sign-up, pairing, trial or payment is performed.

The [implementation plan](../../../superpowers/plans/2026-10-29-a1186-cloud-trial-offer.md) contains the exact EN/ES copy, driver calls and open G1 integration gate. It proposes this small completion entry without building A250's deferred tutorial or A1185's billing display.

## Eight rendered views

Use one `index.html` file with these fragments. Each variant responds to viewport width; no query switches, JavaScript, product imports, fonts, server or network access are needed.

| Variant                         | Phone viewport                 | Desktop viewport                 |
| ------------------------------- | ------------------------------ | -------------------------------- |
| [EN light](index.html#en-light) | [390 × 1100](en-light-390.png) | [1280 × 1100](en-light-1280.png) |
| [EN dark](index.html#en-dark)   | [390 × 1100](en-dark-390.png)  | [1280 × 1100](en-dark-1280.png)  |
| [ES light](index.html#es-light) | [390 × 1100](es-light-390.png) | [1280 × 1100](es-light-1280.png) |
| [ES dark](index.html#es-dark)   | [390 × 1100](es-dark-390.png)  | [1280 × 1100](es-dark-1280.png)  |

Capture full pages, not just the initial viewport. After choosing a fragment, scroll to the top before capture so the proposed-status label remains visible. Phone pages intentionally continue below the fold; card text has no height limit or internal scroll area. Inspect all paragraphs and the final CTA, including Spanish. Check for horizontal overflow and text clipping. The linked PNGs are full-page Chromium renders supplied by the driver after review corrections. They depict this static proposal; they do not demonstrate a working trial or product flow. The driver also owns ONE fresh-context plan review.

A local Playwright capture recipe for the driver, from the Waitron worktree with dependencies and Chromium installed:

```sh
A1186_MOCKUP="$PWD/docs/backlog/mockups/a1186-cloud-trial-offer/index.html" \
  pnpm --filter @waitron/setup exec node --input-type=module <<'JS'
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const output = await mkdtemp(join(tmpdir(), 'a1186-cloud-trial-offer-'));
console.log(output);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const variant of ['en-light', 'en-dark', 'es-light', 'es-dark']) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(pathToFileURL(process.env.A1186_MOCKUP).href + '#' + variant);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
        throw new Error(`Horizontal overflow: ${variant}-${width}`);
      await page.screenshot({ path: `${output}/${variant}-${width}.png`, fullPage: true });
    }
  }
} finally { await browser.close(); }
JS
```

This recipe reproduces the captures in a fresh temporary directory. Page width alone does not establish clipping or accuracy; LOOK at the eight images. Follow repository headroom rules before launching Chromium. Save screenshots outside the repository unless the driver deliberately chooses to publish them.

## Editing and fidelity

Edit the four `section.variant` blocks and shared CSS directly. English light is the default; fragment selection chooses the others through CSS. Keep copy in step with the plan's table. The HTML embeds a frozen subset of `packages/ui-core/src/tokens/{structure,colors}.css` and the existing `packages/ui/brand/waitron-lockup.svg` at Waitron `517cc76da4b05223dc1ebd933ef8f7a97b2ae7cc`. Values are copied for portability, not a new product theme. Link text uses `--wt-color-primary-text`.

The setup card width, header, mode pill, three destination rows, first-hours card and backup nudge follow the inspected completion screen. These mockups show ready Preparation with saved first hours and no recovery key. Live uses the same proposed invitation. Demo, absent intent, archive/Cloud/bucket restore and mirror completion exclude it; restart waits for existing readiness. The plan pins these exclusions in future tests rather than fabricating working mockup states.

The existing backup warning is reproduced verbatim, including its present-tense claim about trading. That is existing copy, not a new trial, backup or readiness guarantee. Recovery/key/device content is not shown in this ordinary-setup illustration and must retain its original behaviour during implementation. **Explore Cloud services** would navigate locally to `/manage/cloud`; it would not start the trial or open Cloud directly. G1 must qualify missing configuration, local permission and existing connections before release; the current unconfigured page has no connection action. Detailed sign-in permissions and pairing mechanics belong in the planned guide, not this invitation.
