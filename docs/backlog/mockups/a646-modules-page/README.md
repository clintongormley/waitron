# A646: Modules, proposed layouts

These static drawings accompany the [proposed design](../../../superpowers/specs/2026-10-16-a646-modules-page-design.md), dated 16 October 2026. They await owner agreement. They are not screenshots of a working Modules page.

You see three integration entries, an example Google settings dialog and a separate example of a refused Stripe change. The dialog is shown beside the list on desktop and below it on a phone so you can review both in one drawing. In the product it opens as a shared modal dialog. The list is an excerpt; other optional modules and the readable required entries follow the design's catalogue rules.

The list shows applied state. The dialog shows a staged edit to enable Google; its switch has not changed the list yet. Save validates the required fields before submitting. The Stripe refusal illustrates a different attempted change: an unknown card payment keeps Stripe enabled. A refusal does not submit another charge or cancel the existing one.

| Language | Theme | Desktop, 1280 px         | Phone, 390 px           |
| -------- | ----- | ------------------------ | ----------------------- |
| English  | Light | [PNG](en-light-1280.png) | [PNG](en-light-390.png) |
| English  | Dark  | [PNG](en-dark-1280.png)  | [PNG](en-dark-390.png)  |
| Spanish  | Light | [PNG](es-light-1280.png) | [PNG](es-light-390.png) |
| Spanish  | Dark  | [PNG](es-dark-1280.png)  | [PNG](es-dark-390.png)  |

Each PNG has a same-named SVG source. The drawings copy the light and dark palette from `packages/ui-core/src/tokens/colors.css`; controls are illustrative and have no interaction. These files do not establish keyboard behavior, accessibility, live updates, runtime switching, credential protection or payment safety. Those checks belong to the later build.

To render the SVG sources again, run this from the repository root with dependencies installed:

```sh
node --input-type=module - <<'JS'
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
const sharp = createRequire(process.cwd() + '/apps/server/package.json')('sharp');
const dir = 'docs/backlog/mockups/a646-modules-page';
for (const name of (await readdir(dir)).filter(name => name.endsWith('.svg'))) {
  await sharp(`${dir}/${name}`).png().toFile(`${dir}/${name.replace('.svg', '.png')}`);
}
JS
```

The design's owner question includes the other important example: Google stays enabled when an administrator would lose their only usable way to sign in. The full build must show that refusal in both languages and themes too.
