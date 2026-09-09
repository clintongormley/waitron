import type { AdministrativeArea, CountryPack, ValidationResult } from "@waitron/country";

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

const CATALAN = new Set(["07", "08", "12", "17", "25", "43", "46"]);
const GALICIAN = new Set(["15", "27", "32", "36"]);
const BASQUE = new Set(["01", "20", "48"]);

function localeFor(code: string): string | undefined {
  if (CATALAN.has(code)) return "ca-ES";
  if (GALICIAN.has(code)) return "gl-ES";
  if (BASQUE.has(code) || code === "31") return "eu-ES";
  return undefined;
}

const administrativeAreas: readonly AdministrativeArea[] = PROVINCES.map(
  ([code, name, aliases]) => ({
    code,
    name,
    ...(aliases === undefined ? {} : { aliases }),
    postalPrefixes: [code],
    ...(localeFor(code) === undefined ? {} : { defaultLocale: localeFor(code) }),
    timeZone: code === "35" || code === "38" ? "Atlantic/Canary" : "Europe/Madrid",
  }),
);

const excludedFromCommon = new Set(["01", "20", "31", "35", "38", "48", "51", "52"]);

export const SPAIN: CountryPack = {
  countryCode: "ES",
  name: "España",
  defaultLocale: "es-ES",
  defaultTimeZone: "Europe/Madrid",
  invoiceLocales: ["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"],
  moduleIds: ["workforce-es"],
  administrativeAreas,
  fiscalJurisdictions: [
    {
      id: "ES-common",
      areaCodes: administrativeAreas
        .map(({ code }) => code)
        .filter((code) => !excludedFromCommon.has(code)),
      supported: true,
      modules: { filing: "verifactu", tax: "vat" },
    },
    { id: "ES-foral-basque", areaCodes: ["01", "20", "48"], supported: false },
    { id: "ES-foral-navarre", areaCodes: ["31"], supported: false },
    { id: "ES-canary", areaCodes: ["35", "38"], supported: false },
    { id: "ES-ceuta", areaCodes: ["51"], supported: false },
    { id: "ES-melilla", areaCodes: ["52"], supported: false },
  ],
  taxIdentifier: { label: "NIF", validate: validateSpanishNif },
  postalCode: { label: "Código postal", validate: validateSpanishPostalCode },
  telephone: { label: "Teléfono", validate: validateSpanishPhone },
};
