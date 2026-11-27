# First contact with the Agencia Tributaria

A running record, written as it happens rather than summarised afterwards. Failures are the point:
the second deli should cost a fraction of the first.

> **Identifying details omitted.** The obligado's registered name, NIF and any named individuals are
> intentionally kept out of this repository; `<DELI SL>` and `<NIF>` are placeholders.

---

## 2026-07-28 — the certificate works unattended

**The probe succeeded on its first run.** `apps/server`'s `aeat.preprod.test.ts` completed an mTLS
`consultar` against `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
in 300 ms:

```json
{
  "ResultadoConsulta": "SinDatos",
  "IndicadorPaginacion": "N",
  "registros": []
}
```

`SinDatos` is the correct and expected answer: this obligado has filed nothing, so there is nothing
to return. It is a well-formed reply to a well-formed query, not a fault.

**What this establishes, none of which had ever been observed before:**

- The exported PKCS#12 `representante` key is usable **unattended** — no hardware token, no
  interactive unlock, no per-request human step. This was the single risk that could have
  invalidated the entire unattended-submission design.
- The mTLS handshake succeeds with the runtime's default trust store. No intermediate certificate
  had to be supplied.
- `packages/verifactu`'s SOAP serializer produced an envelope **AEAT accepted**, and its parser
  handled a **real AEAT response**. Every prior test of both ran against fixtures.
- The obligado is recognised by pre-production.

**The certificate**

- Issuer: `C=ES, O=FNMT-RCM, OU=CERES, CN=AC Representación` — confirms `certKind: "representante"`,
  which is what routes to `SOAP_ENDPOINTS` rather than `SOAP_ENDPOINTS_SELLO`.
- Obligado: the deli's SL, NIF `<NIF>` (from the subject's `organizationIdentifier`,
  `VATES-<NIF>`).
- **Valid 2025-10-03 → 2027-10-03.**

**Two things this raises, neither blocking:**

1. **Renewal is now an operational deadline.** The certificate expires 2027-10-03. A Veri*Factu host
   whose certificate silently expires stops being able to file, and the failure would first appear
   as a drain pass that skips its due work — the same shape as having no certificate at all. Nothing
   currently warns on approaching expiry.
   > **Pointer, 2026-10-18:** measured since, against a test server that refuses an expired
   > certificate during the connection, it does NOT appear as a skipped pass: the filing pass backs
   > it off like a network failure and raises no "awaiting certificate" alert. That AEAT refuses the
   > same way is assumed, not measured. See A795's design, §2.3
   > ([2026-10-18-a795-aeat-certificate-after-setup-design.md](../superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md)).
   >
   > **Pointer, 2026-10-19:** A795 adds expiry warnings: a dashboard alert as the AEAT certificate
   > nears expiry and once it has expired, and an email to each active manager and administrator
   > with an email address, on a box that files records and has outgoing mail set up, at most once each when the warning starts, when it turns urgent and when
   > the certificate expires. How AEAT itself answers an expired certificate is still one of the owner's
   > checks, run after A795 lands (A888 in the backlog).
   >
   > **Pointer, 2026-11-25:** run. See
   > [below](#2026-11-25--real-certificates-against-both-environments).
2. **The obligado's NIF is not the certificate holder's ID.** The certificate identifies a natural
   person acting for the company; the filing is made for the company. `ObligadoEmision.NIF` must be
   the deli's NIF, never the `SERIALNUMBER` in the certificate subject. Easy to get backwards, and
   getting it backwards files against the wrong taxpayer.

**What it does not establish:** that a *submission* will be accepted. `consultar` is a read — it
exercises no `RegistroAlta` XSD validation, no chaining, and no registration coherence between the
certificate, the NIF and the `IdSistemaInformatico`. Those remain open.

---

## 2026-11-25 — real certificates against both environments

The owner's session for A888, on `main` at `9ea1020ca1`: read-only queries, nothing filed. The
two certificates went first through the shipped code
(`apps/server/src/aeat-certificate-check.preprod.test.ts`). A throwaway script on the same transport,
not following redirects, then showed AEAT's raw answers and added the controls. What it changes is [A1571](../backlog/fiscal.md#a1571-what-aeats-answers-to-real-certificates-change).

| Sent | Test environment | Production |
| --- | --- | --- |
| Representative certificate, its own address (`prewww1`, `www1`) | accepted | accepted |
| The same, at the seal address (`prewww10`, `www10`) | accepted | accepted |
| No certificate, either address | 302 to `erro4033.html` | 302 to `erro4033.html` |
| An expired and revoked certificate, either address | 302 to `erro4011.html` | 302 to `erro4011.html` |
| A self-signed certificate, either address | 302 to `erro4011.html` | not sent |
| Representative certificate, asking about another company | SOAP fault `Codigo[4112]` | not sent |

"Accepted" is HTTP 200 with a well-formed reply to a query. It says nothing about a filing.
*(Dated note, 2026-11-27: A1571 PR 3 reads the type from the certificate's policies, so a
representative certificate is no longer sent to the seal address by a wrong choice.)*

- **`erro4011.html` reads** "401 No autorizado. Se ha producido un error al verificar el certificado
  presentado", and lists an unrecognised issuer, a certificate type not valid for the service, and an
  expired certificate (fetched 2026-11-25). In the test environment a nonsense body got the same
  redirect, so the answer did not depend on the query.
- **Expiry alone was not isolated.** The refused certificate ran from June 2021 to 9 June 2023, and
  FNMT's OCSP service and revocation list both say it was revoked on 23 May 2023 as superseded. The
  company is closed. A second expired certificate could not be opened: its password was not known.
- **What the shipped code makes of it.** It follows the redirect and reports `check_failed`. The
  library throws on that page for a filing as well as a query (run on the real page); that the filing
  pass then backs the batch off was read in `drain.ts`, not run.
  _2026-11-27, A1571 PR 1: the transport no longer follows AEAT's redirect to `erro4011.html` or
  `erro4033.html`; the check reports `not_accepted`, and a filing pass that meets that redirect records
  the fingerprint of the certificate it sent with (`aeat-transport.test.ts`,
  `drain.certificate-refused.test.ts`)._
- **The 4112 fault:** HTTP 200, `faultcode` `env:Client`, `faultstring` "Codigo[4112].El titular del
  certificado debe ser Obligado Emisión, Colaborador Social, Apoderado o Sucesor." A wrong company name
  beside the right tax ID was accepted.
- **Both certificates** carry `O` and `organizationIdentifier` (`VATES-<NIF>`). Both files use 3DES
  with a SHA-1 check and open on Node 26.13.1, on the Mac and in `node:26-slim`.
- **Exports, with throwaway certificates.** macOS (`security export` and the `SecItemExport` API; the
  Keychain Access app itself was not clicked through): RC2 for the certificate, refused as
  `old_encryption`, in `node:26-slim` too. Firefox 160.0.1 (its own export code): AES, opens. Windows:
  not run. *(Dated note, 2026-11-27: A1571 PR 2 rewrites such a file once when it is installed
  through the dashboard or setup, so it is accepted.)*
- **An accented password** opens a Firefox export, and passes the password check on a file from the
  macOS API. The `security` command stores it misencoded, so a file made that way is refused as a wrong
  password. *(Dated note, 2026-11-27: A1571 PR 2 also opens such a file through the dashboard or setup:
  it reads the passphrase as the `security` command wrote it and stores an AES copy under the passphrase as typed.)*
- **Time to open a Firefox export** (600,000 rounds of PBKDF2): about 885 ms for the whole child
  process on an idle i5-6400T box, in its own app image. The opener's limit is 2,000 ms.
- **Not run:** a company seal at either address (owner: "i don't need it - each owner has their own
  cert").
