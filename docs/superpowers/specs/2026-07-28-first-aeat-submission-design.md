# The first real AEAT submission (design)

**Date:** 2026-07-28 · **Main at design time:** `c41dc8e` (the `@waitron/db` exports map landed, PR #2)

> **2026-08-04 note:** where this design has the deli's rows created by `bootstrap-tenant.sql`
> (§ "The deli's rows…"), that file has since been retired (Task D2, `feat/locations-provisioning`)
> and `waitron-provision venue` replaces it — see
> [`2026-08-04-locations-provisioning-design.md`](./2026-08-04-locations-provisioning-design.md). The
> text below records what was true when written.

The qualified certificate exists. Every handoff since the fiscal drain landed has named it as the
critical path — "*that is the real critical path, and no code shortens it*" — and it is now the one
thing that has changed without a line being written.

**This cycle adds no product code.** The vault, the transport, the endpoint routing and the drain
loop are all built and tested. What has never happened is any of them meeting the Agencia
Tributaria. This cycle provisions reality into the host and fixes what that reveals.

It ends the state PR #36 existed to make legible: today every `drain` pass skips every tenant,
because `readCertMaterial` throws before a client is ever constructed.

---

## 1. What already exists

Verified against `c41dc8e`, because a cycle that re-implements what is already there is worse than
one that does nothing:

| Piece | Where | State |
| --- | --- | --- |
| Pre-production SOAP endpoint | [`packages/verifactu/src/endpoints.ts`](../../../packages/verifactu/src/endpoints.ts) | `preproduction: https://prewww1.aeat.es/…/VerifactuSOAP` |
| Endpoint chosen by certificate kind | [`apps/server/src/aeat-transport.ts`](../../../apps/server/src/aeat-transport.ts) | `certKind === "sello" ? SOAP_ENDPOINTS_SELLO[env] : SOAP_ENDPOINTS[env]` |
| Environment knob | [`apps/server/src/config.ts`](../../../apps/server/src/config.ts) | `WAITRON_AEAT_ENV` → `"production" \| "preproduction"` |
| Credential shape | [`packages/credentials/src/purposes.ts`](../../../packages/credentials/src/purposes.ts) | `"fiscal.aeat": ["pfxBase64", "passphrase", "certKind"]` |
| Credential validation on read | `aeat-transport.ts`'s `readCertMaterial` | rejects a missing or undecodable field by name |
| Failure legibility | `pass.ts`'s `logNonSucceededRun`, `duty.degraded` | landed in #35/#36 |

Nothing in that table is speculative. The gap is entirely operational.

> **2026-07-29 note:** `WAITRON_AEAT_ENV` (the "Environment knob" row above) was replaced by
> `WAITRON_ENV` — see the
> [deployment-environment design](./2026-07-29-deployment-environment-design.md). The table above
> records the shape as it was at design time and is left unchanged.

## 2. The certificate we have, and the one question it raises

**A `representante` certificate**, exportable as PKCS#12 with a passphrase, targeting
pre-production first.

`certKind: "representante"` routes to `SOAP_ENDPOINTS`, not `SOAP_ENDPOINTS_SELLO` — the code
already branches correctly and needs no change.

**The open question is not technical.** A *representante* certificate identifies a natural person
acting for the entity, so every submission is signed as that person rather than by the entity's own
seal. That is normal and widely done, and it is also exactly the kind of question that belongs with
the fiscal advisor rather than in a design document. It goes to
[`asesor-questions.md`](../../compliance/asesor-questions.md); it does not block this cycle, and it
may later argue for obtaining a *sello* certificate, which the code already supports.

## 3. Step 0 — a real database, and the deli in it

No database holds the deli today; `apps/server` has only ever run against test containers. So this
cycle is also the **first real use of the README's empty-database grant recipe**, which #35 recorded
as hand-verified and not test-covered. If that recipe is wrong, this is where it surfaces, and
fixing it is in scope.

The deli's rows are created by a committed, reviewed `bootstrap-tenant.sql`: tenant, location, till,
invoice series, with the real NIF and legal name.

**Not the test seeds.** `seedTenant` writes `'Test SL'` and a synthetic NIF from a counter; those
values would become part of a fiscal record that AEAT keeps. The bootstrap script is separate for
that reason alone, and it is reviewed like code because a wrong NIF here is not a bug, it is a
filing.

The proper provisioning surface stays deferred. One SQL file run once is the honest tool for a
single deli, and building an admin CLI first would delay the only step that produces new
information.

## 4. Step 1 — provisioning the certificate without leaking it

**The CLI must be built first.** `packages/credentials`'s `bin` entry points at `./dist/bin.js`, which
does not exist in a fresh checkout — `pnpm install` even warns about it. Run
`pnpm --filter @waitron/credentials build` before anything else in this step, or the command is
simply not found. (CI builds it as part of its smoke test; a working tree never does.)

`waitron-credentials set --tenant <uuid> --purpose fiscal.aeat` then takes its payload as a JSON
object **on stdin**. It deliberately refuses a payload as an argument (there is a test pinning that), and
it has no `get` command at all — the tool never prints a decrypted credential.

The passphrase must therefore reach stdin without passing through shell history, a temp file, or
this repository's transcripts:

```bash
# Portable across zsh and bash. Do NOT use bash's `read -p`: in zsh, this repo's default
# shell, -p means "read from a coprocess" and the command fails with "no coprocess".
printf 'PFX passphrase: '; stty -echo; read -r PFX_PASS; stty echo; echo
jq -n --arg pfx "$(base64 -i /path/to/cert.p12)" \
      --arg pass "$PFX_PASS" \
      --arg kind representante \
   '{pfxBase64: $pfx, passphrase: $pass, certKind: $kind}' \
 | waitron-credentials set --tenant "$TENANT_ID" --purpose fiscal.aeat
unset PFX_PASS
```

**The certificate file and its passphrase never appear in a Claude transcript, a commit, or a
command argument.** That constraint is part of the design, not an afterthought: a `.p12` with its
passphrase is the entity's signing identity.

## 5. Step 2 — prove the transport before involving anything else

One mTLS handshake against `prewww1.aeat.es` using the real certificate, asserting only that AEAT
answers. Nothing about serialization, chaining, or drain.

This is the cycle's first genuine unknown — whether an exported `representante` key works
unattended, and whether AEAT accepts it — and isolating it means a failure cannot be confused with
an XSD or chain-append problem three layers up.

It follows the repository's existing pattern for tests that talk to a real external service:
`packages/payments-stripe`'s `*.sandbox.test.ts` files, excluded from the default run by
`vitest.config.ts` and driven by their own config. The AEAT probe is the same shape — it runs only
when the credential is present, never in CI, and is invoked deliberately.

**Expected failure modes, all of which are useful:** the key is not usable headlessly; AEAT rejects
the certificate as unregistered for this service; the TLS chain needs an intermediate the runtime
does not ship; the host requires a `Content-Type` or SOAPAction the client does not send.

## 6. Step 3 — one real submission

Record one sale on the deli's till, let `drain` pick it up, and read what comes back. `drain`
already does the rest: the chain appends, the envío is serialized and submitted, and the ack path
records the outcome.

> **Corrected during execution.** This section originally read "`registro-sif` mints the installation
> number" as though that happened on the way through. It does not: `registerSif` had no production
> caller at all, so a till created by `bootstrap-tenant.sql` could not record a sale — `recordSale`
> threw `sif.not_registered`. Registering the till is a separate provisioning step, added by the
> plan's Step 4b. The rest of the sentence stands.

The success criterion is not "no error". It is **a submission whose outcome we can read** —
accepted, or rejected with a reason we can act on.

## 7. Step 4 — discovery, named as such

What AEAT rejects on first contact cannot be specified in advance, and a plan that pretends
otherwise will be wrong in a way that costs more than it saves. Expected: XSD strictness on fields
the fixtures never exercised, coherence requirements between the certificate holder, the deli's NIF
and the `IdSistemaInformatico`, and registration steps that pre-production enforces.

**The most valuable output of this cycle may be a finding, not a feature** — specifically, whether
the observability #35 and #36 built actually makes a first AEAT contact readable. If it does not,
that is worth more than a green submission.

## 8. Out of scope

- **Production submission.** Pre-production first, and switching over is its own decision.
- **A provisioning CLI** for tenants, tills and series.
- **Test-covering the grant recipe** — using it is in scope, fixing it if wrong is in scope,
  writing the test that pins it is not.
- **The webhook endpoint (C3).** Its scope is already decided — prompt-settle for Mode 3 hosted
  checkout, with reconcile remaining the safety net — and it resumes after this.
- **Obtaining a *sello* certificate**, unless §2's advisor question forces it.

## 9. How we will know it worked

- The transport probe completes a handshake against `prewww1.aeat.es` and receives a SOAP response.
- `bootstrap-tenant.sql` produces exactly one tenant with the deli's real NIF, one till and one
  series, on a database created by the README recipe.
- One sale reaches AEAT and its outcome is visible in `envios` and in the host's logs without
  reading the database by hand.
- A `drain` pass no longer skips every tenant — the degraded state PR #36 made legible is ended for
  the deli.
- Whatever failed on the way is written down, since it is the only part of this cycle nobody could
  have predicted.
