import {
  fingerprint,
  invalid,
  object,
  text,
  boolean,
  natural,
  literal,
  nullable,
  list,
  unique,
} from "./values.mjs";

/** Whitespace is ignored only outside quoted SQL tokens; raw SQL stays in the input. */
export function sqlTokens(sql) {
  text(sql, "sql");
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    const start = i;
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      tokens.push(sql.slice(start, i));
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) invalid("sql: unterminated comment");
      i = end + 2;
      tokens.push(sql.slice(start, i));
      continue;
    }
    const number =
      /^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?)/.exec(
        sql.slice(i),
      );
    if (number) {
      i += number[0].length;
      tokens.push(number[0]);
      continue;
    }
    const operator = /^(?:->>|->|\|\||<<|>>|<=|>=|==|!=|<>)/.exec(sql.slice(i));
    if (operator) {
      i += operator[0].length;
      tokens.push(operator[0]);
      continue;
    }
    if (/[xX]/.test(sql[i]) && sql[i + 1] === "'") i++;
    const opener = sql[i];
    if (["'", '"', "`", "["].includes(opener)) {
      const close = opener === "[" ? "]" : opener;
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (opener !== "[" && sql[i] === close) {
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) invalid("sql: unterminated quote");
    } else if (/[\p{L}\p{N}_$]/u.test(opener)) {
      while (i < sql.length && /[\p{L}\p{N}_$]/u.test(sql[i])) i++;
    } else i++;
    tokens.push(sql.slice(start, i));
  }
  return tokens;
}
const sql = (v, p) => {
  text(v, p);
  sqlTokens(v);
};
const names = list(text, 1);
const column = (v, p) =>
  object(
    v,
    { name: text, type: text, notNull: boolean, defaultSql: nullable(sql), primaryKey: natural },
    p,
  );
const key = (v, p) =>
  object(v, { name: text, kind: literal("primary", "unique"), columns: names }, p);
const foreignKey = (v, p) => {
  const action = literal("NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT");
  object(
    v,
    {
      columns: names,
      target: text,
      targetColumns: names,
      onUpdate: action,
      onDelete: action,
      match: text,
      deferred: boolean,
    },
    p,
  );
  if (v.columns.length !== v.targetColumns.length) invalid(p);
};

export function parseSchema(value) {
  list((v, p) => {
    const common = {
      kind: literal("table", "index", "trigger", "view"),
      name: text,
      table: text,
      module: text,
      protection: literal("ordinary", "fiscal", "disabled", "engine"),
      rawSql: sql,
    };
    const fields = {
      table: {
        columns: list(column, 1),
        keys: list(key),
        checks: list(sql),
        foreignKeys: list(foreignKey),
      },
      index: { unique: boolean, expressions: list(sql, 1), predicate: nullable(sql) },
      trigger: { target: text, body: sql },
      view: { body: sql },
    };
    if (!Object.hasOwn(fields, v?.kind)) invalid(p);
    object(v, { ...common, ...fields[v.kind] }, p);
    if (v.kind === "table") {
      unique(
        v.columns.map((c) => c.name),
        p,
      );
      unique(
        v.keys.map((k) => k.name),
        p,
      );
      unique(v.foreignKeys.map(fingerprint), p);
    }
  })(value, "schema");
  unique(
    value.map((v) => `${v.kind}:${v.name}`),
    "schema",
  );
  return globalThis.structuredClone(value);
}
