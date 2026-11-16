# Noto Sans Mono for recovery packs

Recovery packs embed the unmodified `NotoSansMono-Regular.ttf` from Noto Fonts at
commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`.

| File    | Pinned source                                                                                                                                                                | SHA-256                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Font    | [NotoSansMono-Regular.ttf](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSansMono/NotoSansMono-Regular.ttf) | `d9e2b23d19f8230be7146f409a52b1d23117e635e28f2e2892cf91b7382f325b` |
| Licence | [LICENSE](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE)                                                           | `0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb` |

Both files were downloaded and hashed on 16 November 2026. The licence says
“This Font Software is licensed under the SIL Open Font License, Version 1.1.”
`OFL.txt` preserves that copyright and licence notice unchanged.

The server source is `apps/server/src/assets/invoice-noto-sans-mono.ttf`, copied beside
its bundle to `dist/assets/` and shipped at `/app/assets/`. The identical browser source
is `packages/fiscal-verifactu/src/assets/register-noto-sans-mono.ttf`; Vite emits it as a
local asset, and Node bundles inline its bytes. PDFs embed the glyphs they use.
