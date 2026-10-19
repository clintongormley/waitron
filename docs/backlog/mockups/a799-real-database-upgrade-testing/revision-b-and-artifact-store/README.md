# A799: release checks answered; choose the frozen-input store

The owner chose **OLDEST + PREVIOUS** on 19 October 2026 at approximately 16:02.
Before publishing imagined candidate R5, require R1 to R5 and R4 to R5. Keep every
original bundle and its independently frozen expectations, including R2/R3. Passing
R1/R4 gives no passing evidence for R2/R3 and does not retire their support. Source A
remains an invented venue created and written through the frozen older product.

**Question C, proposed:** should those bundles and expectations live in a dedicated
release-artifact store with a checksum index in Git (recommended), or directly in Git?
A checksum is a file fingerprint used to check that the fetched bytes match the sealed
original. Separate storage keeps the binary bundles out of Git history. Keeping them in
Git puts source and inputs in one checkout, while adding the bundles to its history.
R1/R4 remain required and R2/R3 remain kept in either choice. No provider is selected.

| Language and theme | Phone                                               | Desktop                                               |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| English, light     | [390 px](release-checks-and-store-en-light-390.png) | [1280 px](release-checks-and-store-en-light-1280.png) |
| English, dark      | [390 px](release-checks-and-store-en-dark-390.png)  | [1280 px](release-checks-and-store-en-dark-1280.png)  |
| Spanish, light     | [390 px](release-checks-and-store-es-light-390.png) | [1280 px](release-checks-and-store-es-light-1280.png) |
| Spanish, dark      | [390 px](release-checks-and-store-es-dark-390.png)  | [1280 px](release-checks-and-store-es-dark-1280.png)  |

Each PNG has a same-named SVG source. These are static review drawings, not product
screenshots, an operator surface or evidence that an upgrade ran. R1–R5 are imagined
qualified releases within the same post-A760 history; no fixture is established here.

The proposed storage contract keeps original bundles unchanged. It denies upload/delete
credentials to untrusted candidate code and blocks a required run when an input is
missing or corrupt; it never skips the input or substitutes current seed data. Provider,
ordinary-CI availability, authentication, permissions, support/retirement and broader
custody policy remain open. Fixed test credentials still require the proposed custody
constraints; no secret, paid service or account change is approved by this question.

A760 execution/reset remains separately authorised. An unchanged-image restart does not
meet the later candidate's pending-migration requirement. Proposed optional-module-off
cases, raw fiscal bytes/identity, issued-F1 completion, capture time/IDs and complete
design/plan/build remain open and unchanged. No capture or product build is authorised.
Read the [current design](../../../../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md).
