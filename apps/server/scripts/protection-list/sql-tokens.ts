type TokenKind = "word" | "number" | "quoted" | "blob" | "comment" | "lineComment" | "symbol";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface CheckClause {
  readonly name: string | null;
  readonly expression: string;
  readonly onConflict: string | null;
}

export interface IndexParts {
  /** One per key column, in key order, without its trailing COLLATE, ASC or DESC. */
  readonly keyTerms: readonly string[];
  readonly predicate: string | null;
}

export interface TriggerParts {
  readonly timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  readonly event: "DELETE" | "INSERT" | "UPDATE";
  readonly updateOf: readonly string[] | null;
  readonly when: string | null;
  readonly body: string;
}

// The engine's own whitespace: a no-break space, which \s matches, is part of a name to it.
const WHITESPACE = /[ \t\n\f\r]+/y;
const LEXEMES: readonly (readonly [TokenKind, RegExp])[] = [
  ["lineComment", /--[^\n]*/y],
  ["comment", /\/\*[\s\S]*?(?:\*\/|$)/y],
  ["blob", /[xX]'[^']*'?/y],
  ["quoted", /'[^']*(?:''[^']*)*'?|"[^"]*(?:""[^"]*)*"?|`[^`]*(?:``[^`]*)*`?|\[[^\]]*\]?/y],
  [
    "number",
    /(?:0[xX][0-9a-fA-F_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[A-Za-z0-9_$\u0080-￿]*/y,
  ],
  ["word", /[A-Za-z_$\u0080-￿][A-Za-z0-9_$\u0080-￿]*/y],
  ["symbol", /\|\||->>|->|<<|>>|<=|>=|==|!=|<>|[\s\S]/y],
];

function tokenise(sql: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const skipWhitespace = (): void => {
    WHITESPACE.lastIndex = at;
    if (WHITESPACE.test(sql)) at = WHITESPACE.lastIndex;
  };
  for (skipWhitespace(); at < sql.length; skipWhitespace()) {
    for (const [kind, pattern] of LEXEMES) {
      pattern.lastIndex = at;
      const match = pattern.exec(sql);
      if (match !== null) {
        tokens.push({ kind, text: match[0], start: at, end: at + match[0].length });
        at += match[0].length;
        break;
      }
    }
  }
  return tokens;
}

function significantTokens(sql: string): Token[] {
  return tokenise(sql).filter((token) => token.kind !== "comment" && token.kind !== "lineComment");
}

function staysTwoTokens(first: Token, second: Token): boolean {
  const joined = tokenise(first.text + second.text);
  return joined.length === 2 && joined[0]?.text === first.text;
}

/** Whitespace remains only where taking it out would change what the tokens are. */
export function normaliseSql(sql: string): string {
  let result = "";
  let previous: Token | undefined;
  for (const token of tokenise(sql)) {
    if (previous !== undefined && !staysTwoTokens(previous, token)) {
      result += previous.kind === "lineComment" ? "\n" : " ";
    }
    result += token.text;
    previous = token;
  }
  return result;
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === "word" && token.text.toUpperCase() === word;
}

function isSymbol(token: Token | undefined, symbol: string): boolean {
  return token?.kind === "symbol" && token.text === symbol;
}

function unquoted(text: string): string {
  const open = text[0];
  if (open === "[") return text.slice(1, -1);
  if (open === "'" || open === '"' || open === "`") {
    return text.slice(1, -1).replaceAll(open + open, open);
  }
  return text;
}

function sliceBetween(sql: string, start: number, end: number): string {
  return sql.slice(start, end).replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, "");
}

function matchingClose(tokens: readonly Token[], open: number, sql: string): number {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    if (isSymbol(tokens[at], "(")) depth += 1;
    if (isSymbol(tokens[at], ")")) depth -= 1;
    if (depth === 0) return at;
  }
  throw new Error(`Unbalanced brackets in: ${sql}`);
}

function at(tokens: readonly Token[], index: number, sql: string): Token {
  const token = tokens[index];
  if (token === undefined) throw new Error(`Could not read: ${sql}`);
  return token;
}

/**
 * A CONSTRAINT name stays current past other constraints until the next top-level comma: the engine
 * reports `a INT CONSTRAINT n NOT NULL CHECK (a > 0) CHECK (a < 9)`'s two CHECKs both as `n`.
 */
export function checkClausesIn(createSql: string): CheckClause[] {
  const tokens = significantTokens(createSql);
  const clauses: CheckClause[] = [];
  const open = tokens.findIndex((token) => isSymbol(token, "("));
  if (open === -1) return clauses;
  const close = matchingClose(tokens, open, createSql);
  let name: string | null = null;
  for (let index = open + 1; index < close; index += 1) {
    const token = at(tokens, index, createSql);
    if (isSymbol(token, "(")) {
      index = matchingClose(tokens, index, createSql);
    } else if (isSymbol(token, ",")) {
      name = null;
    } else if (isWord(token, "CONSTRAINT")) {
      index += 1;
      name = unquoted(at(tokens, index, createSql).text);
    } else if (isWord(token, "CHECK") && isSymbol(tokens[index + 1], "(")) {
      const end = matchingClose(tokens, index + 1, createSql);
      const hasConflict = isWord(tokens[end + 1], "ON") && isWord(tokens[end + 2], "CONFLICT");
      clauses.push({
        name,
        expression: sliceBetween(
          createSql,
          at(tokens, index + 1, createSql).end,
          at(tokens, end, createSql).start,
        ),
        onConflict: hasConflict ? at(tokens, end + 3, createSql).text : null,
      });
      index = end;
    }
  }
  return clauses;
}

export function checksIn(createSql: string): { name: string | null; expression: string }[] {
  return checkClausesIn(createSql).map(({ name, expression }) => ({ name, expression }));
}

export function hasAutoincrement(createSql: string): boolean {
  return significantTokens(createSql).some((token) => isWord(token, "AUTOINCREMENT"));
}

function keyTerm(sql: string, tokens: readonly Token[]): string {
  let last = tokens.length - 1;
  if (isWord(tokens[last], "ASC") || isWord(tokens[last], "DESC")) last -= 1;
  if (isWord(tokens[last - 1], "COLLATE")) last -= 2;
  return sql.slice(at(tokens, 0, sql).start, at(tokens, last, sql).end);
}

export function indexParts(indexSql: string): IndexParts {
  const tokens = significantTokens(indexSql);
  const open = tokens.findIndex((token) => isSymbol(token, "("));
  if (open === -1) throw new Error(`Could not read: ${indexSql}`);
  const close = matchingClose(tokens, open, indexSql);
  const keyTerms: string[] = [];
  let termStart = open + 1;
  for (let index = open + 1; index <= close; index += 1) {
    if (isSymbol(tokens[index], "(")) index = matchingClose(tokens, index, indexSql);
    else if (index === close || isSymbol(tokens[index], ",")) {
      keyTerms.push(keyTerm(indexSql, tokens.slice(termStart, index)));
      termStart = index + 1;
    }
  }
  const where = tokens[close + 1];
  return {
    keyTerms,
    predicate: isWord(where, "WHERE")
      ? sliceBetween(indexSql, at(tokens, close + 1, indexSql).end, indexSql.length)
      : null,
  };
}

/**
 * Reads the stored form, `CREATE TRIGGER name [timing] event ON table [FOR EACH ROW] [WHEN expr]
 * BEGIN body END`, by position: BEFORE, AFTER and BEGIN are all legal unquoted names to the engine.
 */
export function triggerParts(triggerSql: string): TriggerParts {
  const tokens = significantTokens(triggerSql);
  const token = (index: number): Token => at(tokens, index, triggerSql);
  let index = 3;
  if (isSymbol(tokens[index], ".")) index += 2;

  let timing: TriggerParts["timing"] = "BEFORE";
  if (isWord(tokens[index], "BEFORE")) {
    index += 1;
  } else if (isWord(tokens[index], "AFTER")) {
    timing = "AFTER";
    index += 1;
  } else if (isWord(tokens[index], "INSTEAD")) {
    timing = "INSTEAD OF";
    index += 2;
  }

  const eventWord = token(index).text.toUpperCase();
  if (eventWord !== "DELETE" && eventWord !== "INSERT" && eventWord !== "UPDATE") {
    throw new Error(`Could not read the event of: ${triggerSql}`);
  }
  index += 1;

  let updateOf: string[] | null = null;
  if (isWord(tokens[index], "OF")) {
    updateOf = [];
    for (index += 1; !isWord(tokens[index], "ON"); index += 1) {
      if (!isSymbol(token(index), ",")) updateOf.push(unquoted(token(index).text));
    }
  }

  index += 2;
  if (isWord(tokens[index], "FOR")) index += 3;

  const whenAt = isWord(tokens[index], "WHEN") ? index : null;
  while (!isWord(tokens[index], "BEGIN") || isSymbol(tokens[index - 1], ".")) {
    if (isSymbol(token(index), "(")) index = matchingClose(tokens, index, triggerSql);
    index += 1;
  }
  const begin = token(index);
  const end = token(tokens.length - 1);
  if (!isWord(end, "END")) throw new Error(`Could not read the body of: ${triggerSql}`);

  return {
    timing,
    event: eventWord,
    updateOf,
    when: whenAt === null ? null : sliceBetween(triggerSql, token(whenAt).end, begin.start),
    body: sliceBetween(triggerSql, begin.end, end.start),
  };
}
