import {
  guestMenuWords,
  languageDisplayName,
  formatMoney,
  decimal,
  toScale,
  isStoredColor,
  type PublicGuestMenu,
  type GuestMember,
  type GuestDeclarations,
  type GuestMenuPaperAppearance,
} from "@waitron/shared";
import { formatDecimalInput } from "@waitron/ui-core/decimal-input";
import { NUTRITION_ICONS } from "@waitron/ui-core/nutrition-icons";
import { escapeHtml as esc } from "./html-page.js";
import { GUIDE_PAGE_TOKENS } from "./html-page-tokens.js";

export interface GuestMenuPaperOptions extends GuestMenuPaperAppearance {
  order?: number[];
  breaks?: number[];
  logo?: string;
}

const pageTokens = Object.entries(GUIDE_PAGE_TOKENS)
  .map(([name, value]) => `${name}:${typeof value === "string" ? value : value[0]}`)
  .join(";");

export function renderGuestMenuPage(
  menu: PublicGuestMenu,
  venueName: string,
  defaultLanguage: string,
  languageLinks = false,
  paper?: GuestMenuPaperOptions,
): string {
  const { language, text: words } = guestMenuWords(menu.language, defaultLanguage);
  const used = new Set<string>();
  const sections: { id: string; name: string }[] = [];
  let sequence = 0;
  const label = (code: string) => words[code]!;
  const glyph = (code: string) =>
    `<svg aria-hidden="true" viewBox="0 0 16 16"><path d="${NUTRITION_ICONS[code.startsWith("diet-") ? code : `allergen-${code}`]}"/></svg>`;
  const mark = (code: string, name: string, kinds: string[] = []) => {
    used.add(code);
    if (paper)
      return `<span>${glyph(code)}${paper.key === "inline" || kinds.length ? ` ${esc(name)}` : ""}</span>`;
    const id = `declaration-${sequence++}`;
    return `<button type="button" popovertarget="${id}" aria-label="${esc(name)}">${glyph(code)}${esc(kinds.map(label).join(", "))}</button><div id="${id}" popover>${esc(name)}</div>`;
  };
  const declarations = (value: GuestDeclarations) => {
    const allergens =
      value.allergens === null
        ? ""
        : Object.entries(value.allergens)
            .map(([code, entry]) =>
              mark(
                code,
                `${label(code)}${entry.kinds?.length ? ` (${entry.kinds.map(label).join(", ")})` : ""}`,
                entry.kinds,
              ),
            )
            .join("");
    return `<div class="declarations" lang="${language}">${allergens}${value.dietary.map((code) => mark(`diet-${code}`, label(code))).join("")}</div>`;
  };
  const portion = (amount: string) => {
    const places = (amount.split(".")[1] ?? "").replace(/0+$/, "").length;
    return formatDecimalInput(toScale(decimal(amount), places), menu.language);
  };
  const price = (amount: string, unit: string) => `${esc(amount)} <small>/ ${esc(unit)}</small>`;
  const walk = (members: GuestMember[], top = false): string =>
    members
      .map((member) => {
        if (member.kind === "section") {
          const id = `section-${sequence++}`;
          sections.push({ id, name: member.name });
          return `<section id="${id}"${top ? " data-paper-member" : ""}${top && paper?.breaks?.includes(menu.members.indexOf(member)) ? ' class="page-break"' : ""}><h2>${esc(member.name)}</h2>${walk(member.members)}</section>`;
        }
        const range =
          member.price.min === member.price.max
            ? formatMoney(member.price.min, menu.language)
            : `${formatMoney(member.price.min, menu.language)}–${formatMoney(member.price.max, menu.language)}`;
        return `<article><div class="line"><h3>${esc(member.name)}</h3><span>${price(range, member.unit)}</span></div>${member.description ? `<p>${esc(member.description)}</p>` : ""}${declarations(member)}
      ${member.variants.map((v) => `<div class="choice"><div class="line"><span>${esc(v.name)}</span><span>${price(formatMoney(v.price, menu.language), v.unit)}</span></div>${declarations(v)}</div>`).join("")}
      ${member.modifiers.map((m) => `<div class="choice"><h4>${esc(m.name)}</h4>${m.kind === "options" ? `<p>${m.labels.map(esc).join(" · ")}</p>` : m.items.map((extra) => `<div class="line"><span>${esc(extra.name)} <small>${esc(portion(extra.portion))} ${esc(extra.unit)}</small></span><span>${esc(formatMoney(extra.price, menu.language))}</span></div>${declarations(extra)}`).join("")}</div>`).join("")}</article>`;
      })
      .join("");
  // Presentation indices belong to this publication; the published document stays in its order.
  const ordered = paper?.order
    ? [...new Set([...paper.order, ...menu.members.map((_, index) => index)])]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < menu.members.length)
        .map((index) => menu.members[index]!)
    : menu.members;
  const groups: GuestMember[][] = [[]];
  for (const member of ordered) {
    if (paper?.breaks?.includes(menu.members.indexOf(member)) && groups.at(-1)!.length)
      groups.push([]);
    groups.at(-1)!.push(member);
  }
  const body =
    paper?.preset === "bistro"
      ? groups.map((group) => `<div class="paper-flow">${walk(group, true)}</div>`).join("")
      : walk(ordered, true);
  const key = (diet: boolean) =>
    [...used]
      .filter((code) => code.startsWith("diet-") === diet)
      .map((code) => `<li>${glyph(code)} ${esc(label(code.replace(/^diet-/, "")))}</li>`)
      .join("");
  const dietKey = key(true);

  return `<!doctype html><html lang="${esc(menu.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(venueName)} · ${esc(menu.name)}</title><style>
:root{${pageTokens};color-scheme:light${paper ? `;--wt-font-family:${paper.font === "serif" ? "Georgia, serif" : GUIDE_PAGE_TOKENS["--wt-font-family"]};--wt-color-text:${isStoredColor(paper.ink) ? paper.ink : "var(--wt-color-text-muted)"};--wt-color-primary-text:${isStoredColor(paper.accent) ? paper.accent : "var(--wt-color-text)"}` : ""}}
*{box-sizing:border-box}
body{margin:0;padding:var(--wt-space-4);font-family:var(--wt-font-family);font-size:var(--wt-font-size-md);color:var(--wt-color-text);background:var(--wt-color-bg);overflow-wrap:anywhere}
main{max-width:calc(var(--wt-space-6) * 28);margin:auto}
h1,h2,h3,h4,p{margin:0 0 var(--wt-space-2)}
h1{font-size:var(--wt-font-size-xl)}
h2{font-size:var(--wt-font-size-lg);margin-top:var(--wt-space-6)}
h3,h4{font-size:var(--wt-font-size-md)}
article{border-bottom:1px solid var(--wt-color-border);padding:var(--wt-space-4) 0;break-inside:avoid}
.line{display:flex;justify-content:space-between;gap:var(--wt-space-3)}
.line>:first-child{min-width:0}.line>:last-child{flex-shrink:0}
nav,.declarations{display:flex;flex-wrap:wrap;gap:var(--wt-space-2);margin:var(--wt-space-3) 0}
a{color:var(--wt-color-primary-text)}
button{font:inherit;color:inherit;background:transparent;border:1px solid var(--wt-color-border);border-radius:var(--wt-radius-md);padding:var(--wt-space-2);cursor:pointer;text-align:start;max-width:100%}
button:focus-visible,a:focus-visible{outline:var(--wt-focus-ring);outline-offset:var(--wt-focus-offset)}
svg{width:var(--wt-space-4);height:var(--wt-space-4);fill:currentColor;vertical-align:middle}
.choice{margin:var(--wt-space-3) 0 var(--wt-space-3) var(--wt-space-4)}
small{color:var(--wt-color-text-muted)}
[popover]{color:var(--wt-color-text);background:var(--wt-color-bg);padding:var(--wt-space-5);border:1px solid var(--wt-color-border);border-radius:var(--wt-radius-md);max-width:calc(100% - var(--wt-space-6))}
footer{margin-top:var(--wt-space-6)}footer li{margin-bottom:var(--wt-space-2)}
${
  paper
    ? `
@page{size:A4 portrait;margin:12mm}
body{background:var(--wt-color-bg);padding:0;print-color-adjust:exact}
main{max-width:186mm;column-count:2;column-gap:var(--wt-space-5)}
header,footer{column-span:all}
header img{max-width:50mm;max-height:25mm;object-fit:contain}
header{border-bottom:1px solid var(--wt-color-primary-text);padding-bottom:var(--wt-space-4)}
h2{color:var(--wt-color-primary-text);break-after:avoid;margin-top:var(--wt-space-4)}
article{padding:${paper.spacing === "compact" ? "var(--wt-space-2)" : "var(--wt-space-4)"} 0}
.declarations{font-size:var(--wt-font-size-md)}
.page-break{break-before:page}
${paper.preset === "lunch-wine" ? `main{display:grid;grid-template-columns:2fr 1fr;column-count:auto;column-gap:var(--wt-space-5)}header,footer{grid-column:1 / -1}main>section,main>article{grid-column:1}header{text-transform:uppercase}main>section~section:last-of-type{grid-column:2;grid-row:2 / span ${Math.max(1, ordered.length - 1)};border-inline-start:var(--wt-space-2) solid var(--wt-color-primary-text);padding-inline-start:var(--wt-space-3)}` : `main{column-count:auto}.paper-flow{column-count:2;column-gap:var(--wt-space-5)}.paper-flow+.paper-flow{break-before:page}header{text-align:center}`}
`
    : ""
}
</style></head><body><main><header>${paper?.logo ? `<img src="${esc(paper.logo)}" alt="">` : ""}<p>${esc(venueName)}</p><h1>${esc(menu.name)}</h1></header>${paper ? "" : `<nav aria-label="${esc(menu.name)}">${sections.map((s) => `<a href="#${s.id}">${esc(s.name)}</a>`).join("")}</nav>`}${languageLinks && !paper ? `<nav lang="${language}" aria-label="${esc(words.languages!)}">${menu.languages.map((code) => `<a href="?language=${encodeURIComponent(code)}" lang="${esc(code)}">${esc(languageDisplayName(code, code))}</a>`).join(" · ")}</nav>` : ""}${body}<footer lang="${language}"><h2>${esc(words.key!)}</h2><p>${esc(words.keyLanguage!)}</p><p>${esc(words.note!)}</p><ul>${key(false)}</ul>${dietKey ? `<h2>${esc(words.diet!)}</h2><ul>${dietKey}</ul>` : ""}</footer></main></body></html>`;
}

export function renderGuestMenuUnavailable(requested: string, fallback: string): string {
  const { language, text } = guestMenuWords(requested, fallback);
  return `<!doctype html><html lang="${esc(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(text.unavailable!)}</title><style>:root{${pageTokens}}body{margin:0;font-size:var(--wt-font-size-md);font-family:var(--wt-font-family);color:var(--wt-color-text);background:var(--wt-color-bg);padding:var(--wt-space-4)}h1{font-size:var(--wt-font-size-xl)}</style></head><body><h1>${esc(text.unavailable!)}</h1></body></html>`;
}
