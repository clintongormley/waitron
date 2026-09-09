# Country packs and address entry implementation plan

**Date:** 2026-09-09
**Design:** `../specs/2026-09-09-country-packs-and-address-entry-design.md`

1. Add the browser-safe `@waitron/country` contract and test its generic area, postcode, jurisdiction
   and locale resolvers.
2. Add `@waitron/country-es` with the official province catalogue and pure NIF, postcode and telephone
   validators. Test valid, malformed and bad-checksum values, every province code, Canary time zones,
   regional locale preferences and unsupported fiscal jurisdictions.
3. Add a minimal `@waitron/country-gb` pack to preserve the existing CLI/test `GB-vat`
   no-fiscal-regime path without exposing its placeholder tax selection in setup.
4. Add `@waitron/country-packs` as the installed-pack registry. Route the existing fiscal-territory
   lookup and boot-time venue locale lookup through it, retaining their behavioural assertions.
5. Change the setup venue screen under TDD: render country and province choices from the pack, derive
   province from a Spanish postcode, validate NIF/postcode/province, and emit the derived fiscal
   territory, locale and time zone.
6. Repeat those checks in the setup API, reject submitted derived values that disagree with the pack,
   and normalise the NIF before it reaches `planVenue`.
7. Update the module seam and English-only guards for the new composition boundary, update the backlog,
   then run each changed package's coverage gate and the whole repository gate.
