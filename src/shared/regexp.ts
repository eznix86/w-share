import {
  anyOf,
  caseInsensitive,
  charIn,
  charNotIn,
  createRegExp,
  digit,
  exactly,
  global,
  maybe,
  oneOrMore,
} from "magic-regexp";

const urlSchemeSeparator = "://";

export const uuidHyphenPattern = createRegExp("-", [global]);

export const leadingVersionPrefixPattern = createRegExp(exactly("v").at.lineStart());

export const websocketUrlPattern = createRegExp(
  exactly("ws", maybe("s"), urlSchemeSeparator).at.lineStart(),
  [caseInsensitive],
);

export const httpUrlPattern = createRegExp(
  exactly("http", maybe("s"), urlSchemeSeparator).at.lineStart(),
  [caseInsensitive],
);

export const validSubdomainPattern = createRegExp(
  charIn("").from("a", "z").orChar.from("0", "9").orChar("-").times.atLeast(1).at.lineStart().at.lineEnd(),
);

export const hostWithPortPattern = createRegExp(
  charNotIn(":/").times.atLeast(1).at.lineStart(),
  ":",
  oneOrMore(digit).at.lineEnd(),
);

export const trailingColonPattern = createRegExp(exactly(":").at.lineEnd());

export const wrappingDoubleQuotePattern = createRegExp(
  anyOf(exactly('"').at.lineStart(), exactly('"').at.lineEnd()),
  [global],
);

export const colonPattern = createRegExp(":", [global]);

export const wShareHelpPattern = createRegExp(
  anyOf(
    "Lightweight HTTP tunnel for local sites",
    exactly("Show the installed w", maybe("-share"), " version"),
  ),
);
