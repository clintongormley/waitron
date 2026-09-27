/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

/** Keywords whose parenthesised head is followed by a statement, so a `/` after its `)` opens a
 * regular expression. */
const STATEMENT_HEADS: ReadonlySet<string> = new Set(["if", "while", "for", "with"]);

const LF = 0x0a;
const CR = 0x0d;
const BANG = 0x21;
const DOUBLE_QUOTE = 0x22;
const DOLLAR = 0x24;
const QUOTE = 0x27;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const STAR = 0x2a;
const PLUS = 0x2b;
const MINUS = 0x2d;
const DOT = 0x2e;
const SLASH = 0x2f;
const BRACKET_OPEN = 0x5b;
const BACKSLASH = 0x5c;
const BRACKET_CLOSE = 0x5d;
const BACKTICK = 0x60;
const BRACE_OPEN = 0x7b;
const BRACE_CLOSE = 0x7d;

function isSpace(code: number): boolean {
  return /\s/.test(String.fromCharCode(code));
}

/** A character of a name or number. Any non-ASCII character that is not a space counts, as an
 * accented letter in a name does. */
function isWordPart(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x5f ||
    code === DOLLAR ||
    (code > 0x7f && !isSpace(code))
  );
}

/** The characters that end a line comment or a regular expression. A string may hold U+2028 and
 * U+2029, so only LF and CR end one. */
function isLineTerminator(code: number): boolean {
  return code === LF || code === CR || code === 0x2028 || code === 0x2029;
}

/**
 * `source` with each comment replaced by what `replace` returns for it, and nothing else changed.
 *
 * Comments are found by walking the source, guessing as described below, so a `//` or `/*` inside
 * a string, a template literal or a regular expression is not a comment, and a `/*` inside a `//`
 * comment opens nothing. Without a parser, whether a `/` opens a regular expression is guessed from
 * what precedes it, and known wrong guesses include: a regular expression after the `)` of
 * `for await (…)`, or after a word `REGEX_AFTER_WORD` does not list (`export default /x/`), is read
 * as a division; a division after a name spelled like a listed word (a variable called `of`), or
 * after a `!` parted from its value by a space, is read as a regular expression. A wrong guess is
 * not confined to its line: a quote, backtick or `/*` in the misread text can open a string,
 * template or comment the source does not have, and either direction can then hand `replace` code
 * on a later line as if it were a comment, or leave a comment there in place as if it were code.
 */
export function mapComments(source: string, replace: (comment: string) => string): string {
  const parts: string[] = [];
  let copiedFrom = 0;
  let i = 0;
  let regexAllowed = true;
  let afterDot = false;
  // The word just read, while no other token has followed it; "" for a property name.
  let lastWord = "";
  // One entry per open `(`: whether a statement follows its `)`.
  const parens: boolean[] = [];
  // One entry per open `${`: how many `{` inside it are still open.
  const substitutions: number[] = [];

  const blank = (start: number, end: number): void => {
    parts.push(source.slice(copiedFrom, start), replace(source.slice(start, end)));
    copiedFrom = end;
  };
  /** Skips a template literal's text from `i` to past its closing backtick or its next `${`. */
  const skipTemplate = (): void => {
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === BACKTICK) {
        i += 1;
        regexAllowed = false;
        return;
      }
      if (code === DOLLAR && source.charCodeAt(i + 1) === BRACE_OPEN) {
        i += 2;
        substitutions.push(0);
        regexAllowed = true;
        return;
      }
      i += code === BACKSLASH ? 2 : 1;
    }
  };
  /** Skips a string from its opening quote at `i` to past its closing quote, or to an LF or CR. */
  const skipString = (quote: number): void => {
    i += 1;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (code === quote) {
        i += 1;
        return;
      }
      if (code === LF || code === CR) return;
      i += code !== BACKSLASH ? 1 : source.startsWith("\r\n", i + 1) ? 3 : 2;
    }
  };
  /** Skips a regular expression from its opening `/` at `i` to past its closing `/`, or to its
   * line's end. */
  const skipRegex = (): void => {
    let inClass = false;
    i += 1;
    while (i < source.length) {
      const code = source.charCodeAt(i);
      if (isLineTerminator(code)) return;
      if (code === SLASH && !inClass) {
        i += 1;
        return;
      }
      if (code === BACKSLASH) i += 1;
      else if (code === BRACKET_OPEN) inClass = true;
      else if (code === BRACKET_CLOSE) inClass = false;
      i += 1;
    }
  };

  while (i < source.length) {
    const code = source.charCodeAt(i);
    if (code === SLASH && source.charCodeAt(i + 1) === SLASH) {
      const start = i;
      i += 2;
      while (i < source.length && !isLineTerminator(source.charCodeAt(i))) i += 1;
      blank(start, i);
      continue;
    }
    if (code === SLASH && source.charCodeAt(i + 1) === STAR) {
      const close = source.indexOf("*/", i + 2);
      const start = i;
      i = close < 0 ? source.length : close + 2;
      blank(start, i);
      continue;
    }
    if (isSpace(code)) {
      i += 1;
      continue;
    }
    if (isWordPart(code)) {
      const start = i;
      do i += 1;
      while (i < source.length && isWordPart(source.charCodeAt(i)));
      // A name after a `.`, but not after a spread's `...`, is a property, so a value even when it
      // is spelled like a keyword.
      lastWord = afterDot ? "" : source.slice(start, i);
      regexAllowed = REGEX_AFTER_WORD.has(lastWord);
      afterDot = false;
      continue;
    }
    const wordBefore = lastWord;
    lastWord = "";
    afterDot = false;
    if (code === QUOTE || code === DOUBLE_QUOTE) {
      skipString(code);
      regexAllowed = false;
    } else if (code === SLASH && regexAllowed) {
      skipRegex();
      regexAllowed = false;
    } else if (code === BACKTICK) {
      i += 1;
      skipTemplate();
    } else if ((code === PLUS || code === MINUS) && source.charCodeAt(i + 1) === code) {
      // `++` and `--` leave the guess alone: postfix after a value, prefix before one.
      i += 2;
    } else if (code === BANG && !isSpace(source.charCodeAt(i - 1))) {
      // A `!` touching what precedes it keeps the guess: after a value it is a non-null assertion.
      i += 1;
    } else {
      i += 1;
      afterDot = code === DOT && source.charCodeAt(i - 2) !== DOT;
      // A `/` dividing what a `}` ends is a type error (TS2362: arithmetic on an object, a function
      // or a class), so after `}` it opens a regular expression.
      regexAllowed = code !== BRACKET_CLOSE;
      if (code === PAREN_OPEN) parens.push(STATEMENT_HEADS.has(wordBefore));
      else if (code === PAREN_CLOSE) regexAllowed = parens.pop() === true;
      else if (code === BRACE_OPEN && substitutions.length > 0) {
        substitutions[substitutions.length - 1]! += 1;
      } else if (code === BRACE_CLOSE && substitutions.length > 0) {
        const open = substitutions.length - 1;
        if (substitutions[open]! > 0) substitutions[open]! -= 1;
        else {
          substitutions.pop();
          skipTemplate();
        }
      }
    }
  }
  parts.push(source.slice(copiedFrom));
  return parts.join("");
}

/** `source` with every character of each comment but its newlines replaced by a space, so every
 * line of code stays on the line it was on. Finds comments as `mapComments` does, wrong guesses
 * included. */
export function blankComments(source: string): string {
  return mapComments(source, (comment) => comment.replace(/[^\n]/g, " "));
}
