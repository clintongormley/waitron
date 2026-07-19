# Implementation provenance and licensing discipline

Decided **2026-07-18**. Applies to `packages/verifactu` and anything else implementing the
RRSIF / Veri\*Factu specification.

---

## The rule

**Implement from AEAT's published specification. Do not read `mdiago/VeriFactu` source.**

That is the whole discipline. It does not require a formal clean-room process.

### Why not a clean room

A clean room — one team studies the protected work and writes a spec, a second team implements
from that spec having never seen the original — exists for reverse-engineering *undocumented*
systems. It is not our situation.

AEAT publishes the complete specification: record layouts, huella construction, QR spec, WSDL,
XSDs, validation rules, error codes, and official test vectors. We are not reverse-engineering
anyone's library; we are implementing a government specification that other libraries also
implement. **Two independent implementations of a published standard are not derivative of each
other.** Spec-first implementation plus avoiding the one copyleft codebase is sufficient, and
the two-team ceremony would buy nothing.

---

## Source classification

| Source | Licence | May we read it? | Notes |
| --- | --- | --- | --- |
| AEAT technical documentation | government specification | **Yes — primary** | The source of truth. Field names, structures, algorithms and error codes it dictates are not anyone's protected expression. |
| [`borjamrd/verifactu-conformance`](https://github.com/borjamrd/verifactu-conformance) | MIT | **Yes** | Official AEAT test vectors packaged for CI. **The most valuable external asset** — wire into CI from the first commit. |
| [`inoguerols/verifactu`](https://github.com/inoguerols/verifactu) | MIT | **Yes** | TypeScript; huella SHA-256 chaining, QR, compliance lint. Actively maintained. Best reference. |
| [`zarpilla/verifactu-node-lib`](https://github.com/zarpilla/verifactu-node-lib) | MIT declared, **no LICENSE file** | Yes, with care | Builds records + QR + chaining; does **not** sign and does **not** submit. If we borrow anything material, ask them to add a LICENSE file first. |
| [`doscientos-es/verifactu`](https://github.com/doscientos-es/verifactu) | MIT declared, **no LICENSE file** | Yes, with care | Architecture design already rates its C14N/digest handling poorly. Same LICENSE caveat. |
| [`mdiago/VeriFactu`](https://github.com/mdiago/VeriFactu) | **AGPL-3.0** | **NO — do not read source** | See below. |

> The MIT grants in `zarpilla` and `doscientos` are stated in `package.json` and the README but
> have no LICENSE file GitHub can detect. Effective, but weaker provenance than we want to rely
> on. Prefer `inoguerols` where they overlap.

---

## `mdiago/VeriFactu` — oracle, never source

AGPL-3.0. 334 stars, 64 forks, 59 releases, actively maintained (.NET, NuGet). The most mature
implementation in any language, covering record generation, huella, QR, chaining, signing, SOAP
submission and the event log.

**Porting it to TypeScript would create a derivative work.** Translation between programming
languages is a derivative work; copyleft does not launder through a language change. A TS port
would have to be AGPL, which would (a) infect the POS through linking, (b) trigger AGPL §13's
network clause for any hosted tenant, and (c) defeat the purpose of publishing
`packages/verifactu` as a reusable library.

**Legitimate use — differential testing.** Running the binary and comparing outputs (huellas, QR
payloads, XML) against ours is comparing *behaviour*, not copying *expression*, and needs no
licence. A mature implementation that has survived 59 releases against a moving spec is a better
conformance check than our own reading of the PDF.

**Practical rule:** whoever writes the TypeScript should not read the C#. If someone needs to
run mdiago to generate comparison vectors, that is fine — running is not reading.

### Worth mining for Q9 — but only the public artefacts

mdiago publishes a **versioned Declaración Responsable PDF per release** (e.g.
`Declaracion Responsable v1.0.64-release.pdf`), plus a separate one for their REST API. This is a
library author issuing a DR for the library itself, versioned per release — matching AEAT's rule
that each version needs its own DR, and consistent with the component-certification finding in
[verifactu-findings.md §1a](verifactu-findings.md).

**This is the closest public precedent for our Q9 position.** The PDF is a legal artefact, not
code — reading it carries no licence risk. mdiago is also an active, findable maintainer who has
clearly engaged with the certification question; a GitHub issue asking how they landed on
issuing a DR for a library rather than leaving it to integrators is free.

---

## Waitron's own licence

**Elastic License 2.0, whole repo**, with additional permissions in `LICENSE-GRANTS.md`.

A restaurant may self-host at any scale for free, and may pay a contractor to run it on
infrastructure the restaurant controls. Nobody may sell Waitron as a hosted service.

**AGPL was ruled out.** It is the licence a hyperscaler complies with — by publishing its
modifications — while still taking the business. A licence that taxes hosting does not prevent it.

---

## Provenance record

Keep a short `PROVENANCE.md` in `packages/verifactu` stating:

- which AEAT documents and versions the implementation was written from;
- which MIT-licensed references were consulted;
- that `mdiago/VeriFactu` was used only as a black-box differential oracle and its source was not
  consulted.

Cheap contemporaneous evidence. Costs a paragraph; worth a great deal if the question is ever
asked, and the answer is much less convincing reconstructed years later.

---

## Open — for the Q9 lawyer

Bundle with [asesor-questions.md Q9](asesor-questions.md); same conversation, since both are
questions about what our distribution model actually is.

- Does running an AGPL binary to generate test-comparison vectors carry any obligation? (Expected
  no — AGPL obligations attach to conveying and to network interaction with *modified* versions,
  not to running an unmodified program locally. Unverified.)
- Does a permissive licence on `packages/verifactu` interact with the declaración responsable —
  i.e. can a DR meaningfully cover a library that anyone may fork and modify? This is the
  immutable-artifact question in Q9(b), viewed from the licensing side.
