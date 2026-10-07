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
