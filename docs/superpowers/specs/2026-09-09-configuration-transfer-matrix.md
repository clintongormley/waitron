# Preparation-to-production transfer matrix

Date: 2026-09-09. This matrix records the allowlist implemented by the node-onboarding work. The
module contributions in source are authoritative; changing a row here means changing and testing
the owning contribution in the same commit.

| Owner | Copied configuration | Deliberately removed or reset |
| --- | --- | --- |
| Core | Catalogues, categories, products, option groups and links, location catalogue membership, ingredients and recipes, kitchen stations and courses, canvases, device profiles, floor zones, service statuses, tables, printer agents, printers and routing, themes and receipt settings | Product sales, tenders, refunds, invoices and counters; working orders and open-table links; purchase invoices and stock activity; node/device enrolments. Product media is copied only when referenced and its SHA-256 filename matches its bytes. Printer-agent tokens, last-seen state and cloud-poll tokens are removed; imported agents and printers start disabled. |
| Catalogue | Menu sections, menu offers and their offered modifier groups and prices | Working-order and sold-line menu snapshots. |
| Venue service | Departments, zone service policies, zone menu assignments, preparation routes and department hours | Device-zone defaults, because device enrolments are reset; working-order and sold-line service snapshots. |
| Identity | Staff profiles | The source administrator; PIN and password hashes; TOTP secrets; email verification state; sessions, passkeys, invitations, password resets and management account actions. Imported staff start suspended with a disabled PIN and must be activated in production. |
| Workforce | Employments, availability and shift templates | Shifts, time entries, swaps, absences, published rosters and working-time chains. |
| Spanish workforce | Applicable convenio configuration | Labour records and working-time history. |
| Payments | Payment policy | Payments, provider accounts, resource IDs, API keys and webhook secrets. |
| Bookings, credentials, fiscal regimes, scheduler | No transferable configuration | Bookings; every credential; fiscal records, submissions, chains, SIF identity and certificates; scheduled work state. |

Every row receives a fresh target ID. Tenant and location references are rewritten to the new
production venue. Printer authentication tokens are removed, and imported agents and printers are
disabled. The preview lists printer agents and printers as reconnection work; their names and
connection settings remain available to guide that work.

The export is an authenticated, passphrase-encrypted archive. Import rejects an undeclared table,
unknown field, omitted secret field, incompatible module schema version, unsafe media name or media
digest mismatch before it writes the production venue. Database rows import within the venue
transaction; immutable media publishes after commit and can be repeated after a restart.
