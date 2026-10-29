import type { RecipientIdentifierPolicy, RecipientIdentifierType } from "@waitron/country";
import { validateSpanishNif } from "./spain.js";

// Issuing codes follow AEAT's CountryType2, independently of postal-country membership.
const documentCountryCodes: readonly string[] = Object.freeze(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BQ " +
    "BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ " +
    "DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GG GH GI GL GM GN GQ GR " +
    "GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH " +
    "KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM " +
    "MN MO MP MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF " +
    "PG PH PK PL PM PN PR PS PT PW PY QA QU RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL " +
    "SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XB XG XN XU YE YT ZA ZM ZW"
  ).split(" "),
);

const foreignDocumentTypes: readonly RecipientIdentifierType[] = Object.freeze([
  "vat-number",
  "passport",
  "residence-country-id",
  "residence-certificate",
  "other-document",
]);
const spanishDocumentTypes: readonly RecipientIdentifierType[] = Object.freeze(["passport"]);

export const SPAIN_RECIPIENT_IDENTIFIER_POLICY: RecipientIdentifierPolicy = Object.freeze({
  taxCountryCode: "ES",
  taxIdentifier: { validate: validateSpanishNif },
  documentCountryCodes,
  documentTypesFor: (countryCode: string) =>
    countryCode === "ES" ? spanishDocumentTypes : foreignDocumentTypes,
  documentMaxLength: 20,
});

export const SPAIN_RECIPIENT_IDENTIFIER_LABELS: Readonly<
  Record<"en" | "es" | "ca" | "gl" | "eu", Readonly<Record<RecipientIdentifierType, string>>>
> = {
  en: {
    "tax-number": "Spanish tax ID",
    "vat-number": "VAT number",
    passport: "Passport",
    "residence-country-id": "Residence-country ID",
    "residence-certificate": "Residence certificate",
    "other-document": "Other document",
  },
  es: {
    "tax-number": "NIF español",
    "vat-number": "Número de IVA",
    passport: "Pasaporte",
    "residence-country-id": "Documento de identidad del país de residencia",
    "residence-certificate": "Certificado de residencia",
    "other-document": "Otro documento",
  },
  ca: {
    "tax-number": "NIF espanyol",
    "vat-number": "Número d’IVA",
    passport: "Passaport",
    "residence-country-id": "Document d’identitat del país de residència",
    "residence-certificate": "Certificat de residència",
    "other-document": "Altre document",
  },
  gl: {
    "tax-number": "NIF español",
    "vat-number": "Número de IVE",
    passport: "Pasaporte",
    "residence-country-id": "Documento de identidade do país de residencia",
    "residence-certificate": "Certificado de residencia",
    "other-document": "Outro documento",
  },
  eu: {
    "tax-number": "Espainiako IFZ",
    "vat-number": "BEZ zenbakia",
    passport: "Pasaportea",
    "residence-country-id": "Bizileku-herrialdeko nortasun-agiria",
    "residence-certificate": "Egoitza-ziurtagiria",
    "other-document": "Beste dokumentu bat",
  },
};
