# Noto Sans for invoice pages

Invoice PDFs embed this font, and invoice raster pages draw its glyph outlines. The file is the
unmodified variable Noto Sans TTF from Google's fonts repository, at commit
`8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`:

- [Font source](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf)
- [Licence source](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notosans/OFL.txt)

Font SHA-256: `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`.
Licence SHA-256: `cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a`.
Both files were compared byte for byte with those pinned upstream URLs on 2026-10-07.

`OFL.txt` contains the font's copyright notice and SIL Open Font License, Version 1.1.
The source font lives at `apps/server/src/assets/invoice-noto-sans.ttf`; the server build copies it
beside its bundles in `dist/assets/`, and the image copies it to `/app/assets/`.

Invoice pages draw bold text in the unmodified static Noto Sans Bold, version 2.015, from the
`NotoSans-v2.015` release of `notofonts/latin-greek-cyrillic`: the file
`NotoSans/unhinted/ttf/NotoSans-Bold.ttf` inside the release archive.

- [Release archive](https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip)

Archive SHA-256: `0c34df072a3fa7efbb7cbf34950e1f971a4447cffe365d3a359e2d4089b958f5`.
Bold font SHA-256: `87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9`.
The archive's `OFL.txt` is byte for byte the `OFL.txt` here (`cmp`, 2026-11-23). The source font
lives at `apps/server/src/assets/invoice-noto-sans-bold.ttf` and is built and shipped beside the
regular face, at `/app/assets/invoice-noto-sans-bold.ttf` in the image.

The browser register renderer uses the same unmodified font bytes, copied to
`packages/fiscal-verifactu/src/assets/register-noto-sans.ttf`. Vite emits this local asset beside
the web bundle. The register's PDF embeds a subset of the font; this same OFL notice covers the
copied source. Both source files have the SHA-256 above (`shasum -a 256` on 2026-10-16).
