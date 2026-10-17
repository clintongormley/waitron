import { css, html, nothing } from "lit";

/** A day's name breaks only between its words; a word wider than its place is cut with an
 *  ellipsis, so the element showing the name carries the whole name as its `title`. */
export const dayNameWordStyles = css`
  .word {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: top;
  }
`;

export function dayNameWords(name: string) {
  return name
    .split(/[ \t\r\n]+/)
    .filter(Boolean)
    .map((word, index) => html`${index ? " " : nothing}<span class="word">${word}</span>`);
}
