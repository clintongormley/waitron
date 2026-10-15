# A679 proposed delivery screens and register

**Owner update, 2026-10-15 at 22:15:** the authoritative design now groups each typed field in fours: register 20 entered/23 displayed, standard node key 47/57, combined 67/80. The 21:30 drawings below retain their historical groups of three and counts. They are not qualification of this amendment. Paper-to-Cloud import is no longer required; keep the paper PDF for later S/P allocations.

**Owner update, 2026-10-15 at 21:30:** the existing pictures below are historical proposals.
Their signing seed, custodian reference, mixed-case typing and old character counts are withdrawn.
The [current design](../2026-10-15-a679-two-route-redesign.md) and
[implementation plan](../../plans/2026-10-15-a679-one-pdf-implementation.md) specify the unsigned
paper register and case-insensitive codes grouped by three. No new product or physical-paper
qualification is claimed by these older captures.

## Current 21:30 typing proposal

| Board | English | Spanish |
| --- | --- | --- |
| Desktop | [light](position-register-desktop-en.png), [dark](position-register-desktop-en-dark.png) | [light](position-register-desktop-es.png), [dark](position-register-desktop-es-dark.png) |
| Phone | [light](position-register-phone-en.png), [dark](position-register-phone-en-dark.png) | [light](position-register-phone-es.png), [dark](position-register-phone-es-dark.png) |
| Printout | [paper](position-register-paper-en.png) | [paper](position-register-paper-es.png) |

Sources: [English screen](position-register.html), [Spanish screen](position-register-es.html),
[English printout](position-register-paper.html), [Spanish printout](position-register-paper-es.html).
The [synthetic reference calculation](position-reference.json) gives 20 register characters,
47 for the generated named key, and 67 together; spaces raise these to 24, 61 and 85.
These are static proposals with test data and inactive controls. They qualify neither a product
codec, a generated PDF, a Chrome download/re-upload nor physical recovery.
Ten real-Chromium captures showed no page errors or horizontal overflow; the driver inspected
all ten in contact sheets. This qualifies only these static layouts.

## Historical proposals before 21:30

These pictures illustrate the redesign, not working product screens or a generated PDF. All names are synthetic; codes are unscannable placeholders with no secrets. The paper board records a genuinely new venue (Olivo Centro) in the same taxpayer-wide history; the first-setup story in the design starts at S000001. The Cloud board assumes an explicitly enabled service and a consumed C000042 receipt.

Each English HTML source has a sibling `-es.html` Spanish source. `paper-setup` and `cloud-setup` are captured at 1280 and 390 pixels; `paper-register` is captured at 794×1123. The PNG filename names the width class, language and optional dark theme. The sources use the existing Waitron theme token values. They load no external resources.

The delivery screens do not show the preceding current-register/Cloud request steps. Register rows abbreviate the required signed contents, detailed in the design; a built document must include complete history, bases/purposes, keys and numbered scan data without truncation. One PDF can span multiple pages.

Driver qualification: 20 real-Chromium captures, no page errors or horizontal overflow; each register illustration fits 794×1123. English and Spanish contact sheets visually inspected in both themes. No physical print, scan, PDF parser, axe audit or product journey was exercised.


## Owner 19:35 update: original saved PDF or typing from printout

Use the latest manual-entry boards for the file/printout choice. Earlier scan/no-typing boards are
historical proposals and do not describe the current requirement.

| Board | English | Spanish |
| --- | --- | --- |
| Desktop | [light](manual-register-desktop-en.png), [dark](manual-register-desktop-en-dark.png) | [light](manual-register-desktop-es.png), [dark](manual-register-desktop-es-dark.png) |
| Phone | [light](manual-register-phone-en.png), [dark](manual-register-phone-en-dark.png) | [light](manual-register-phone-es.png), [dark](manual-register-phone-es-dark.png) |
| Printout | [paper](manual-register-paper-en.png) | [paper](manual-register-paper-es.png) |

Static sources: [English screen](manual-register.html), [Spanish screen](manual-register-es.html),
[English printout](manual-register-paper.html), [Spanish printout](manual-register-paper-es.html).
The [synthetic reference values](manual-reference.json) are calculations of the proposed format.
They are not real credentials or an accepted product fixture. The common register has 101 data
characters/117 including its grouping spaces; a generated named-key block has 40/48, combined 141/165.
Reference-kind U/T and node-key format are selected labels, not additional typed data characters.
The product codec, Chrome saved-download round trip, viewer re-save, typed continuation and owner
paper journey remain unimplemented and unqualified by these drawings.
