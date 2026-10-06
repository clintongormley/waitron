import type {
  AdministrativeArea,
  CountryPack,
  FiscalJurisdiction,
  ValidationResult,
} from "@waitron/country";

import { SPAIN_HOLIDAY_CALENDAR } from "./holidays.js";
import { SPAIN_RECEIPT_LABELS } from "./receipt-labels.js";

export type SpanishNifKind = "personal" | "foreigner" | "tax-assigned-personal" | "entity";
export type SpanishPhoneKind = "mobile" | "geographic";

const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const ENTITY_CONTROL_LETTERS = "JABCDEFGHI";

function compact(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

function personalControl(number: string): string {
  return NIF_LETTERS[Number(number) % 23]!;
}

function entityControl(digits: string): { digit: string; letter: string } {
  let sum = 0;
  for (const [index, character] of [...digits].entries()) {
    const digit = Number(character);
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  const control = (10 - (sum % 10)) % 10;
  return { digit: String(control), letter: ENTITY_CONTROL_LETTERS[control]! };
}

export function validateSpanishNif(value: string): ValidationResult<SpanishNifKind> {
  const normalized = compact(value);
  if (normalized === "") return { valid: false, reason: "empty" };

  const dni = /^(\d{8})([A-Z])$/.exec(normalized);
  if (dni !== null) {
    return dni[2] === personalControl(dni[1]!)
      ? { valid: true, normalized, kind: "personal" }
      : { valid: false, reason: "checksum" };
  }

  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(normalized);
  if (nie !== null) {
    const prefix = { X: "0", Y: "1", Z: "2" }[nie[1] as "X" | "Y" | "Z"];
    return nie[3] === personalControl(`${prefix}${nie[2]}`)
      ? { valid: true, normalized, kind: "foreigner" }
      : { valid: false, reason: "checksum" };
  }

  const taxAssignedWithNumericBody = /^[KLM](\d{7})([A-Z])$/.exec(normalized);
  if (taxAssignedWithNumericBody !== null) {
    return taxAssignedWithNumericBody[2] === personalControl(taxAssignedWithNumericBody[1]!)
      ? { valid: true, normalized, kind: "tax-assigned-personal" }
      : { valid: false, reason: "checksum" };
  }

  if (/^[KLM][A-Z0-9]{7}[A-Z]$/.test(normalized)) {
    return { valid: true, normalized, kind: "tax-assigned-personal" };
  }

  const entity = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(normalized);
  if (entity !== null) {
    const control = entityControl(entity[2]!);
    const expected = /^[ABEH]$/.test(entity[1]!)
      ? [control.digit]
      : /^[NPQRSW]$/.test(entity[1]!)
        ? [control.letter]
        : [control.digit, control.letter];
    return expected.includes(entity[3]!)
      ? { valid: true, normalized, kind: "entity" }
      : { valid: false, reason: "checksum" };
  }

  return { valid: false, reason: "format" };
}

export function validateSpanishPostalCode(value: string): ValidationResult<"postal-code"> {
  const normalized = value.trim();
  if (normalized === "") return { valid: false, reason: "empty" };
  return /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(normalized)
    ? { valid: true, normalized, kind: "postal-code" }
    : { valid: false, reason: "format" };
}

export function validateSpanishPhone(value: string): ValidationResult<SpanishPhoneKind> {
  const compacted = value.trim().replace(/[\s().-]/g, "");
  if (compacted === "") return { valid: false, reason: "empty" };
  const domestic = compacted.startsWith("+34")
    ? compacted.slice(3)
    : compacted.startsWith("0034")
      ? compacted.slice(4)
      : compacted;
  if (!/^[6789]\d{8}$/.test(domestic)) return { valid: false, reason: "format" };
  return {
    valid: true,
    normalized: `+34${domestic}`,
    kind: /^[67]/.test(domestic) ? "mobile" : "geographic",
  };
}

const PROVINCES = [
  ["01", "Araba/Álava", ["Álava", "Araba"]],
  ["02", "Albacete"],
  ["03", "Alicante/Alacant", ["Alicante", "Alacant"]],
  ["04", "Almería"],
  ["05", "Ávila"],
  ["06", "Badajoz"],
  ["07", "Balears, Illes", ["Illes Balears", "Baleares"]],
  ["08", "Barcelona"],
  ["09", "Burgos"],
  ["10", "Cáceres"],
  ["11", "Cádiz"],
  ["12", "Castellón/Castelló", ["Castellón", "Castelló"]],
  ["13", "Ciudad Real"],
  ["14", "Córdoba"],
  ["15", "Coruña, A", ["A Coruña", "La Coruña"]],
  ["16", "Cuenca"],
  ["17", "Girona", ["Gerona"]],
  ["18", "Granada"],
  ["19", "Guadalajara"],
  ["20", "Gipuzkoa", ["Guipúzcoa"]],
  ["21", "Huelva"],
  ["22", "Huesca"],
  ["23", "Jaén"],
  ["24", "León"],
  ["25", "Lleida", ["Lérida"]],
  ["26", "Rioja, La", ["La Rioja"]],
  ["27", "Lugo"],
  ["28", "Madrid"],
  ["29", "Málaga"],
  ["30", "Murcia"],
  ["31", "Navarra", ["Nafarroa"]],
  ["32", "Ourense", ["Orense"]],
  ["33", "Asturias"],
  ["34", "Palencia"],
  ["35", "Palmas, Las", ["Las Palmas"]],
  ["36", "Pontevedra"],
  ["37", "Salamanca"],
  ["38", "Santa Cruz de Tenerife"],
  ["39", "Cantabria"],
  ["40", "Segovia"],
  ["41", "Sevilla"],
  ["42", "Soria"],
  ["43", "Tarragona"],
  ["44", "Teruel"],
  ["45", "Toledo"],
  ["46", "Valencia/València", ["Valencia", "València"]],
  ["47", "Valladolid"],
  ["48", "Bizkaia", ["Vizcaya"]],
  ["49", "Zamora"],
  ["50", "Zaragoza"],
  ["51", "Ceuta"],
  ["52", "Melilla"],
] as const;

const CATALAN = new Set(["03", "07", "08", "12", "17", "25", "43", "46"]);
const CATALONIA_PROVINCES = new Set(["08", "17", "25", "43"]);
const VALENCIAN_PROVINCES = new Set(["03", "12", "46"]);
const GALICIAN = new Set(["15", "27", "32", "36"]);
const BASQUE = new Set(["01", "20", "48"]);

function localeFor(code: string): string | undefined {
  if (CATALAN.has(code)) return "ca-ES";
  if (GALICIAN.has(code)) return "gl-ES";
  if (BASQUE.has(code)) return "eu-ES";
  return undefined;
}

type LanguageLaw = Pick<
  AdministrativeArea,
  "requiredContentLocales" | "defaultContentLocale" | "foreignLanguageNotice" | "fixedReceiptLocale"
>;

// Catalonia: Llei 1/1998 art. 32.3 puts "documents offering services" at least in Catalan, which
// the Agència Catalana del Consum reads as covering the menu. STC 88/2017 upheld the Consumer Code's
// language rule (art. 128-1.2) only on the reading that customers can also get the documents in
// Spanish; Waitron keeps Spanish enabled for that.
// The receipt is fixed to Catalan by the Consumer Code (Llei 22/2010) art. 128-1.2.a, which gives
// customers the right to receive "les factures i els altres documents que hi facin referència o
// que en derivin" in Catalan, and by the agency's reading that invoices are at least in Catalan and
// till receipts ("tiquets de caixa") are owed in Catalan. Art. 32.3 is not the receipt's source:
// putting invoices under it is the agency's reading, not the statute's.
// A copy can print in another pack language (`printSaleReceipt`, apps/server/src/till-sale.ts).
// Sources: docs/compliance/regional-language-rules.md, Catalonia table, "Receipts / invoices" rows.
const CATALONIA: LanguageLaw = {
  requiredContentLocales: ["ca-ES", "es-ES"],
  defaultContentLocale: "ca-ES",
  fixedReceiptLocale: {
    locale: "ca-ES",
    reason: {
      en: "In Catalonia, customers have the right to receive invoices in Catalan (Catalan Consumer Code, Llei 22/2010, art. 128-1.2.a). The Agència Catalana del Consum lists invoices among what must be at least in Catalan, and says customers are entitled to till receipts in Catalan. Receipts here are printed in Catalan; a copy can be printed in another language.",
      es: "En Cataluña, los consumidores tienen derecho a recibir las facturas en catalán (Código de consumo de Cataluña, Ley 22/2010, art. 128-1.2.a). La Agència Catalana del Consum incluye las facturas entre lo que debe estar como mínimo en catalán, e indica que los consumidores tienen derecho a recibir los tiques de caja en catalán. Aquí los tiques se imprimen en catalán; una copia se puede imprimir en otro idioma.",
    },
  },
};

// Decree 36/2023 arts. 9.9 and 12.4: both official languages and at least one foreign language,
// preferably English. Art. 1.2.g exempts takeaway-only and delivery-only places; Waitron does
// not distinguish them and keeps both languages enabled everywhere in the region.
const VALENCIAN_COMMUNITY: LanguageLaw = {
  requiredContentLocales: ["ca-ES", "es-ES"],
  foreignLanguageNotice: {
    minimumForeign: 1,
    text: {
      en: "In the Valencian Community, a restaurant or bar must also offer its menu and price list in at least one foreign language, preferably English (Decree 36/2023, arts. 9.9 and 12.4). Places that only sell takeaway or delivery are exempt.",
      es: "En la Comunitat Valenciana, los restaurantes y bares deben ofrecer además la carta y la lista de precios en al menos un idioma extranjero, preferentemente el inglés (Decreto 36/2023, arts. 9.9 y 12.4). Los establecimientos que solo venden para llevar o a domicilio están exentos.",
    },
  },
};

// Decree 108/2006 art. 27.2, and the menu rule as amended by Decree 8/2007. Arts. 1-2 limit the
// decree to restaurants and cafeterias; Waitron does not distinguish venue types and keeps both
// languages enabled everywhere in the region.
const GALICIA: LanguageLaw = {
  requiredContentLocales: ["gl-ES", "es-ES"],
  foreignLanguageNotice: {
    minimumForeign: 2,
    text: {
      en: "In Galicia, a restaurant rated three forks or more must also offer its menu in at least two foreign languages (Decree 108/2006, art. 27.2, as amended by Decree 8/2007).",
      es: "En Galicia, los restaurantes de tres tenedores o más deben ofrecer además la carta en al menos dos idiomas extranjeros (Decreto 108/2006, art. 27.2, modificado por el Decreto 8/2007).",
    },
  },
};

function languageLawFor(code: string): LanguageLaw {
  if (CATALONIA_PROVINCES.has(code)) return CATALONIA;
  if (VALENCIAN_PROVINCES.has(code)) return VALENCIAN_COMMUNITY;
  if (GALICIAN.has(code)) return GALICIA;
  return {};
}

const administrativeAreas: readonly AdministrativeArea[] = PROVINCES.map(
  ([code, name, aliases]) => ({
    code,
    name,
    ...(aliases === undefined ? {} : { aliases }),
    postalPrefixes: [code],
    ...(localeFor(code) === undefined ? {} : { defaultLocale: localeFor(code) }),
    timeZone: code === "35" || code === "38" ? "Atlantic/Canary" : "Europe/Madrid",
    ...languageLawFor(code),
  }),
);

const unsupportedFiscalJurisdictions = [
  { id: "ES-foral-basque", areaCodes: ["01", "20", "48"], supported: false },
  { id: "ES-foral-navarre", areaCodes: ["31"], supported: false },
  { id: "ES-canary", areaCodes: ["35", "38"], supported: false },
  { id: "ES-ceuta", areaCodes: ["51"], supported: false },
  { id: "ES-melilla", areaCodes: ["52"], supported: false },
] satisfies readonly FiscalJurisdiction[];

const unsupportedAreaCodes = new Set(
  unsupportedFiscalJurisdictions.flatMap(({ areaCodes }) => areaCodes),
);

export const SPAIN: CountryPack = {
  countryCode: "ES",
  defaultLocale: "es-ES",
  defaultTimeZone: "Europe/Madrid",
  invoiceLocales: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  receiptLabels: SPAIN_RECEIPT_LABELS,
  officialLocales: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  moduleIds: ["workforce-es"],
  availableForVenueSetup: true,
  administrativeAreas,
  fiscalJurisdictions: [
    {
      id: "ES-common",
      areaCodes: administrativeAreas
        .map(({ code }) => code)
        .filter((code) => !unsupportedAreaCodes.has(code)),
      supported: true,
      modules: { filing: "verifactu", tax: "vat" },
    },
    ...unsupportedFiscalJurisdictions,
  ],
  demo: {
    legalName: "Waitron Demo S.L.",
    taxId: "B00000000",
    locationName: "Casa Delgado",
    departmentTradingNames: { restaurant: "Bar Casa Delgado", deli: "Deli Delgado" },
  },
  taxIdentifier: { label: "NIF", validate: validateSpanishNif },
  postalCode: { validate: validateSpanishPostalCode },
  telephone: { validate: validateSpanishPhone },
  holidayCalendar: SPAIN_HOLIDAY_CALENDAR,
};
