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
   as a drain pass that skips every tenant — the same shape as having no certificate at all. Nothing
   currently warns on approaching expiry.
2. **The obligado's NIF is not the certificate holder's ID.** The certificate identifies a natural
   person acting for the company; the filing is made for the company. `ObligadoEmision.NIF` must be
   the deli's NIF, never the `SERIALNUMBER` in the certificate subject. Easy to get backwards, and
   getting it backwards files against the wrong taxpayer.

**What it does not establish:** that a *submission* will be accepted. `consultar` is a read — it
exercises no `RegistroAlta` XSD validation, no chaining, and no registration coherence between the
certificate, the NIF and the `IdSistemaInformatico`. Those remain open.
