# Country packs and address entry

**Date:** 2026-09-09
**Status:** owner-approved design

## 1. Problem

Waitron currently knows that Spain defaults to Spanish in `@waitron/shared`, maps `ES-common` to
Veri*Factu in generic provisioning, and repeats Spain's invoice languages and time zones in the setup
screen. Those facts describe one country, but no country owns them. A second country would add another
set of conditionals to each consumer.

The same gap leaves forms with only presence checks. Setup accepts any non-empty tax identifier,
postcode and province. Bookings accept any non-empty phone number. Purchase invoices cannot validate a
supplier identifier correctly because they do not record the supplier's country.

## 2. Decision

A **country pack** is a browser-safe description of one country's input conventions and deployment
defaults. It is a preset over modules, not a `WaitronModule` itself. Modules continue to own behaviour,
schema and runtime wiring. A pack names module and fiscal contribution IDs as strings; composition
checks that every enabled ID exists.

The generic contract lives in `@waitron/country`. Each country implementation lives in its own package,
starting with `@waitron/country-es`. `@waitron/country-packs` is the one browser-safe registry that names
the installed packs. This mirrors `@waitron/dashboard-modules`: an app imports the registry and never
names an individual country package.

A pack owns:

- its ISO country code, display name, available invoice locales and default locale;
- taxpayer-identifier normalization, classification and checksum validation;
- telephone normalization and format validation;
- administrative areas with stable codes, display names, postcode prefixes, default locale and time
  zone;
- fiscal jurisdictions, including the filing and tax contribution IDs they require;
- country-specific address validation and the parameters an online autocomplete adapter needs; and
- module IDs which a deployment of that country normally enables.

It does not own fiscal algorithms, tax calculations, translations or an external provider credential.
Those stay in their respective modules or infrastructure.

## 3. Validation has levels

A local validator answers whether a value has a recognised shape and, where the published format makes
it locally computable, checksum. It returns the normalised value and its classified kind. It never
claims the identifier was issued, the telephone is connected, or the address receives post. In
particular, AEAT-assigned personal NIFs beginning K, L or M may contain seven alphanumeric characters;
their local check is necessarily structural rather than an issuance check.

```ts
type ValidationResult<Kind extends string> =
  | { valid: true; normalized: string; kind: Kind }
  | { valid: false; reason: "empty" | "format" | "checksum" | "unsupported" };
```

The browser runs the same pure validator for immediate feedback. The server runs it again at the write
boundary. Browser validation is assistance, not authority.

For Spain the taxpayer field is labelled **NIF**. The validator classifies DNI-shaped personal NIFs,
NIEs and entity NIFs. `CIF` is not a separate stored scheme: the current legal identifier for an entity
is its NIF. An AEAT census lookup, if added later, is a separate online verification level.

## 4. Geography and fiscal selection

An administrative area uses its stable official code. A provider's spelling is mapped to that code;
the spelling is never the jurisdiction key. For Spain, the first two postcode digits identify the
province code, so setup can fill the province and reject a conflicting selection without a network
call.

The country pack maps the area to a fiscal jurisdiction. A supported jurisdiction gives the filing and
tax contribution IDs. An unsupported jurisdiction is explicit and blocks provisioning. It must not be
silently treated as common territory.

`fiscalTerritory` remains persisted. Provisioning derives it from the selected country and area and
then stores the result. A later country-pack update therefore cannot move an existing venue onto a
different fiscal regime at boot.

Locale and time-zone defaults are suggestions. The selected values remain explicit venue data. Locale
resolution intersects a pack's preference with the catalogues this build actually ships, then falls
back to the country default and finally English.

## 5. Address autocomplete

The country contract defines provider-neutral suggestion and resolved-address shapes. No Google code or
credential ships in the country pack.

The always-available path is manual entry plus offline validation. An optional online path is:

```text
browser -> on-prem Waitron server -> Waitron address relay -> address provider
```

The downloadable product contains only its installation credential. The relay holds the provider
credential, authenticates and rate-limits each installation, restricts the search to the selected
country, and returns the minimum normalised fields. A fully self-hosted installation may instead
configure its own provider credential. With neither configuration, the same form remains usable
manually.

Autocomplete never sits on the sale path. Failure, latency or loss of internet disables suggestions
only.

This slice builds the provider-neutral types and offline form behaviour. It deliberately does not add a
Google adapter or a relay endpoint before the hosted authentication and privacy boundary exists.

## 6. First form slice

Setup is the first consumer because it currently collects every country-sensitive venue value in one
screen. For Spain it:

1. validates and normalises the NIF;
2. validates the five-digit postcode and derives the province;
3. refuses a postcode/province mismatch;
4. derives fiscal territory and time zone from the province;
5. offers only the pack's invoice languages; and
6. keeps every address field editable and manual.

The setup API repeats the NIF, postcode, province and derived-jurisdiction checks before provisioning.

Bookings follow with telephone normalization. Purchase invoices follow only after their model carries
the supplier's country or identifier scheme; applying the venue's Spanish validator to every supplier
would reject legitimate foreign suppliers.

## 7. Sources checked on 2026-09-09

- AEAT, NIF composition for people and entities:
  <https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/guia-practica-cumplimentacion-modelo-censal-036/anexos/anexo-01-solicitud-nif-documentacion-aportar/informacion-sobre-numero-identificacion-fiscal.html>
- BOE, Order EHA/451/2008: <https://www.boe.es/buscar/act.php?id=BOE-A-2008-3580>
- INE, official province codes: <https://www.ine.es/daco/daco42/codmun/cod_provincia.htm>
- AEAT, Veri*Factu territorial scope:
  <https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/cuestiones-generales-ambitos-aplicacion.html>
- CNMC, Spanish numbering register:
  <https://www.cnmc.es/sectores-que-regulamos/telecomunicaciones/registros-de-numeracion>
- Google Places pricing, security and session rules:
  <https://developers.google.com/maps/billing-and-pricing/pricing>,
  <https://developers.google.com/maps/api-security-best-practices>, and
  <https://developers.google.com/maps/documentation/places/web-service/session-pricing>.
