# Setup wizard A2

You should be able to try Waitron with your own operator account and a location name and address, without inventing fiscal configuration. Prepare and Live still collect your real business identity.

## Decisions

- Keep the initial register and prefill its name with `Caja 1`. Prefill invoice series with `FS` and `FR`, and the business day boundary with `04:00`. Explain their purpose beside the fields with the shared help control.
- The fiscal contribution supplies its operation-description default (`Venta en establecimiento` for Veri*Factu), through a generic setup defaults endpoint. Label it “Invoice operation description” and explain that it is copied to filed records. Invoice languages do not translate this value.
- Demo hides business identity, invoice languages, operation description, day boundary, register and series fields. A country-owned generator creates a checksum-valid company tax ID only when Demo is selected. Use the location name for the demo business name. Keep the resulting draft stable on Back and show the selected values on Review. Switching out of Demo discards its generated business configuration before collecting real details.
- Add a dashboard location setting for the operation description, protected by the existing configuration permission and tenant/location predicates. Validate through the selected fiscal contribution. Existing immutable records retain their original text; subsequent sales read the location setting.
- Preserve the operator's description exactly, including leading or trailing spaces, so saving does not silently change the reviewed value. Validate the complete value; do not trim it to make an overlong description pass. A regime without a venue-field validator imposes no additional filing-format rules.
- Every invalid shop field receives an explanation, required controls have visible markers, and the form uses the shared error summary and action row. Add help for setup inputs and icon reveal controls for Password, PIN and certificate passphrase.
- The certificate screen offers Windows, macOS and Firefox export instructions, initially selecting the detected platform/browser. Keep other instructions accessible without relying on detection.
- Unknown setup navigation paths redirect to `/`. Missing assets and API paths keep their existing responses; the shared trading SPAs retain their routing.

## Validation

Use failing behavioral tests before implementation. Cover defaults, manual overrides, Demo backtracking and mode switches, country generator validation, individual errors, native password visibility, export-help selection, and redirects with asset/API controls. Exercise the dashboard write through its authorization and tenant boundaries and retain validation failures. Run changed-package coverage, then the repository gate and update the backlog.

## Certificate help provenance (checked 2026-09-12)

| Guidance | Source words | Application |
| --- | --- | --- |
| Windows export | “Exportar la clave privada” | Include the private key and protect the exported copy with a password. [FNMT Windows guide](https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-). |
| macOS export | “Su certificado será guardado con extensión .p12.” | Use Keychain Access, select your certificate, export and set the export password. [FNMT Keychain guide](https://www.sede.fnmt.gob.es/eu/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-). |
| Firefox export | “Seleccione su certificado y pulse \"Hacer copia\".” | Back up the certificate from Your Certificates and save it with a .p12 extension and export password. [FNMT Firefox guide](https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-). |

Browser detection selects an initial disclosure only. It cannot establish where you installed the certificate; every guide remains available. These instructions were checked against the linked guides, not executed in the three operating-system certificate stores.
