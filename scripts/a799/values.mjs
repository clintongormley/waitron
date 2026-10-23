import { isDeepStrictEqual } from "node:util";
import { fail } from "./contracts.mjs";

export function invalid(path) {
  fail("history.invalid", path);
}
export function object(value, fields, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(fields).length
  )
    invalid(path);
  for (const [key, parse] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`);
    parse(value[key], `${path}.${key}`);
  }
}
export function text(value, path) {
  if (typeof value !== "string" || !value.trim()) invalid(path);
}
export function boolean(value, path) {
  if (typeof value !== "boolean") invalid(path);
}
export function natural(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(path);
}
export function literal(...allowed) {
  return (v, p) => {
    if (!allowed.includes(v)) invalid(p);
  };
}
export function nullable(parse) {
  return (v, p) => {
    if (v !== null) parse(v, p);
  };
}
export function list(parse, minimum = 0) {
  return (v, p) => {
    if (!Array.isArray(v) || v.length < minimum) invalid(p);
    v.forEach((entry, i) => parse(entry, `${p}[${i}]`));
  };
}
export function unique(values, path) {
  if (new Set(values).size !== values.length) invalid(`${path}: duplicate`);
}
export function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${fingerprint(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function difference(subject, key, field, expected, actual, cause = "changed") {
  return { subject, key, field, expected, actual, cause };
}
export function compareKeyed(subject, expected, actual, keyFor, compare) {
  const diffs = [];
  const next = new Map(actual.map((v) => [keyFor(v), v]));
  const old = new Set(expected.map(keyFor));
  for (const v of expected) {
    const key = keyFor(v);
    if (!next.has(key)) diffs.push(difference(subject, key, "*", v, null, "missing"));
    else diffs.push(...compare(v, next.get(key), key));
  }
  for (const v of actual)
    if (!old.has(keyFor(v))) diffs.push(difference(subject, keyFor(v), "*", null, v, "unexpected"));
  return diffs;
}
export function compareFields(subject, key, expected, actual) {
  const diffs = [];
  for (const field of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!Object.hasOwn(expected, field))
      diffs.push(difference(subject, key, field, null, actual[field], "unexpected"));
    else if (!Object.hasOwn(actual, field))
      diffs.push(difference(subject, key, field, expected[field], null, "missing"));
    else if (!isDeepStrictEqual(expected[field], actual[field]))
      diffs.push(difference(subject, key, field, expected[field], actual[field]));
  }
  return diffs;
}
