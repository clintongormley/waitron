# Unicode CLDR region names

The recipient-country translations for Galician and Basque come from Unicode CLDR JSON at commit `7d2b9cb11cec08f4d333ad73209deb3df0711c3b`. They keep invoice country names in those languages when the browser has no matching DisplayNames data.

Sources: `cldr-json/cldr-localenames-full/main/gl/territories.json` and `cldr-json/cldr-localenames-full/main/eu/territories.json` in [unicode-org/cldr-json](https://github.com/unicode-org/cldr-json/tree/7d2b9cb11cec08f4d333ad73209deb3df0711c3b). The committed tables retain only the postal-country choices. The accompanying `LICENSE` is the upstream Unicode License V3. This directory ships in `/app/third-party/unicode-cldr/` through the existing Dockerfile copy.
