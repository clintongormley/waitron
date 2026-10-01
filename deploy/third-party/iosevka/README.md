# Iosevka Term Bold

The box prints receipts, kitchen tickets and every other printout as pictures of their text. The
letters in those pictures are drawn from the font Iosevka Term Bold, release 34.9.0, by Renzhi Li
(aka. Belleve Invis).

## What the box carries

No font file. The box carries a table of letter pictures made from the font once, on a developer's
machine, and committed to this repository as `packages/printing/src/glyphs.ts`: one picture per
character, 12 dots wide and 28 dots tall, the font drawn at 24 pixels with its baseline 22 dots
below the top of the picture, a dot inked when at least half of its area is inside the letter's
outline. The command that made it, run from the repository root:

```sh
node packages/printing/scripts/build-glyph-table.mjs IosevkaTerm-Bold.ttf packages/printing/src/glyphs.ts
```

The licence defines a Modified Version as _"any derivative made by adding to, deleting, or
substituting -- in part or in whole -- any of the components of the Original Version, by changing
formats or by porting the Font Software to a new environment."_ That table is a Modified Version
of the font in those words, and it is distributed under the same licence, the SIL Open Font
License, Version 1.1. `LICENSE.md` in this folder is that licence, with the font's copyright line,
and the table's own header repeats both and points at `/app/third-party/iosevka/LICENSE.md`, where
this file is in the image. The copyright line names no Reserved Font Name.

## Where the font came from

- The release asset
  <https://github.com/be5invis/Iosevka/releases/download/v34.9.0/PkgTTF-IosevkaTerm-34.9.0.zip>,
  sha256 `1c0b8ac68ca210cc253c1833619d37ed2227d96fbdda0a36231375828b7bd6fb`.
- `IosevkaTerm-Bold.ttf` from that zip, 11,656,384 bytes, sha256
  `85181f2767e5cd3808edec8d500032644ded2392bceed2c7012511ac9db7261f`. The table's header names
  the same sum, which the generator computes from the file it reads.
- The zip holds no licence file, so `LICENSE.md` is the `LICENSE.md` of the font's repository at
  the release's tag, unchanged:
  <https://raw.githubusercontent.com/be5invis/Iosevka/v34.9.0/LICENSE.md>, sha256
  `4ba53c7c1cb39279aae5f8d7d22054c485c71169920e5a36ed098b115e2e3c5d`.
