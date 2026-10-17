import { css, html, nothing } from "lit";

/** A day's name breaks only between its words; a word wider than its place is cut with an
 *  ellipsis, so a caller must put the whole name in the `title` of the element holding these words. */
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
