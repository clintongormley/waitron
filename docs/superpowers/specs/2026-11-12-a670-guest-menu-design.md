# A670: designed guest menus

**Proposal, 12 November 2026.** The owner requested a design, not these recommendations or a build.
Authority: Lane D `~/waitron-campaign-d/questions.md`, 12:14 relay: “these menus are mixing
concerns”, “why not just translate it now”, and “yes” to design first. The stopped
[plan](../plans/2026-11-12-a670-printable-guest-menu.md) remains historical. Keep this off main
until the owner sees it. Claude reads the design first; local mock-ups then accompany its presentation.

## Two products, one identity

You design a **printed menu**, downloaded as an A4 PDF to print yourself or send to a printer,
and an **online ordering menu**, used at a table or from outside for counter collection.
They share venue identity and dish content, with separate presentation settings.

Offer compact text and photo-led presets: venue display name, logo, optional cover,
section headings, image visibility/crop, spacing, font size, curated
typeface pair, and background/text/accent colours with readable contrast. Paper offers one/two
columns; screens adapt from phone list to desktop grid. Reuse dish images; choose/upload logo
and cover through the media library. Bundle curated fonts. Keep guest settings separate from
dashboard appearance, using declared `--wt-*` tokens and an independent theme root
([design system](../../developers/design-system.md)).

Preview paper, phone and desktop independently of dashboard theme. Paper captures one published
version and language. Keep headings with their first dish and each item's name, price and
declarations together; reserve key space, adding a final page if needed. Allow section page breaks.
Download ordinary A4 PDF; PDF/X, bleed and press colour management stay outside this proposal.

Table ordering needs menu, dish choices, basket, submission and status, alongside A508's
waiter/bill/payment actions. Collection needs collection choices, basket, checkout and pickup status.
Tab credentials, guest permissions, payment providers/timing and fiscal recording remain undecided.
[A508/A509](../../backlog/till.md#a508-a-tables-qr-code-order-call-a-waiter-ask-for-the-bill-or-pay),
[payment decisions](../../backlog/payments.md#a-guest-paying-from-their-own-phone) and
[A951's current successor](../../backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)
still govern that work. A951-S staff access does not supply a customer entrance.

## Content and declarations

Reuse `packages/catalogue/src/menu-publication.ts#readLiveMenu` and published `MenuDocument`
(`packages/shared/src/menu-document/menu-document-types.ts`). Preserve section order/direct
inclusions. Use `customerName`, descriptions, published dish/variant prices and pricing units;
price extras separately. Reuse
`customer-menu-presentation.ts#resolveMenuText` and `product-presentation.ts` in that shared
directory. Dish, variant and extra declarations stay distinct (`menu-types.ts#OfferedExtraItem`).
References describe source inspection, not runtime verification.

Default to inline allergen and dietary icons after dish names, reusing
`packages/ui/src/nutrition-icons.ts`; add any missing dietary symbols there. Paper's written key
names the used icons once, at the end of the **last page**, in separate allergen and dietary groups.
Offer an each-page key or inline words. Online, labelled icon buttons reveal meaning on tap/focus,
with screen-reader text and dismissible explanations. Cereal/nut kinds stay written per item,
even in icon mode: wheat/walnuts, Catalan **blat/nous**, Galician **trigo/noces**.

Dietary marks represent positive declarations, not allergen absence. An absent icon says nothing
about safety; unreviewed and reviewed-empty information never become “allergen-free”. Preserve
A509's proposed allergen/diet filters in the later interactive work, without promising safe dishes.

## Languages added to this spec now

Offer every enabled venue **content language**, independently of staff app locales. Translate guest
controls, keys and explanations too, extending beyond current dashboard EN/ES tables. Missing dish
text follows `resolveMenuText`: requested language, venue default, then staff name where supplied;
descriptions can remain empty. Never infer a recipe or translate its ingredients from its name.

Complete short labels follow ACSA (CA) and SERGAS Annex V (GL), except **Froitos de casca**,
an editorial normalization of its printed “Froitos de cascara”. The older guide supplies vocabulary,
not current legal advice or every legal exception.

| Code | Catalan (CA) | Galician (GL) |
| --- | --- | --- |
| gluten | Cereals que continguin gluten | Cereais que conteñan glute |
| crustaceans | Crustacis | Crustáceos |
| eggs | Ous | Ovos |
| fish | Peix | Peixe |
| peanuts | Cacauets | Cacahuetes |
| soybeans | Soja | Soia |
| milk | Llet | Leite |
| nuts | Fruita seca de clofolla | Froitos de casca |
| celery | Api | Apio |
| mustard | Mostassa | Mostaza |
| sesame | Grans de sèsam | Grans de sésamo |
| sulphites | Anhídrid sulfurós i sulfits | Dióxido de xofre e sulfitos |
| lupin | Tramussos | Altramuces |
| molluscs | Mol·luscs | Moluscos |

Dietary labels are editorial UI translations, **not Annex II terms**. Official usage supports
vegan/vegetarian stems and GL halal/kosher. Masculine agreement with *plat/prato*, CA transliterations
and “without” labels are editorial choices.

| Declaration | CA | GL |
| --- | --- | --- |
| vegan | Vegà | Vegano |
| vegetarian | Vegetarià | Vexetariano |
| halal | Halal | Halal |
| kosher | Kosher | Kosher |
| no_meat | Sense carn | Sen carne |
| no_fish | Sense peix | Sen peixe |

The same sources supply the specific cereal/nut names. These short display forms follow their
lists; compound labels and modern spelling are editorial adaptations, not verbatim legislation.
The mock-ups exercise wheat and walnuts, not only generic categories.

| Kind | CA | GL |
| --- | --- | --- |
| wheat | Blat | Trigo |
| rye | Sègol | Centeo |
| barley | Ordi | Cebada |
| oats | Civada | Avea |
| spelt | Espelta | Espelta |
| kamut | Blat khorasan | Trigo khorasan |
| almonds | Ametlles | Améndoas |
| hazelnuts | Avellanes | Abelás |
| walnuts | Nous | Noces |
| cashews | Anacards | Anacardios |
| pecans | Pacanes | Pacanas |
| brazil_nuts | Nous del Brasil | Castañas de Pará |
| pistachios | Festucs | Pistachos |
| macadamia | Nous de macadàmia | Noces de macadamia |

### Vocabulary provenance

Checked 12 November 2026. Quotes are short source excerpts; interpretations describe their use here.

| Source | Exact excerpt | Interpretation |
| --- | --- | --- |
| [ACSA, Informació sobre al·lèrgens](https://acsa.gencat.cat/ca/seguretat_alimentaria/seguretat_alimentaria_per_temes/etiquetatge_dels_aliments/informacio_sobre_al_lergens/) | “Llet i derivats (inclosa la lactosa)” | Official CA list explicitly names Annex II; source for the 14 shortened labels and cereal/nut kinds. |
| [SERGAS, Guía de indicacións obrigatorias, Annex V, p. 16](https://www.sergas.gal/gal/documentacionTecnica/docs/SaudePublica/Alimentos/Guia%20de%20indicacions%20obrigatorias%20no%20etiquetado%20dos%20produtos%20alimenticios.pdf) | “Cereais que conteñan glute”; “Froitos de cascara” | Official older GL vocabulary list. The 14 groups checked against Annex V and the driver's local `receipts/a670-design/gl-sergas.txt`; nuts normalization disclosed above. |
| [Canal Salut, Alimentació saludable a l'escola](https://canalsalut.gencat.cat/ca/vida-saludable/alimentacio/saludable/escola/index.html) | “menú vegetarià o vegà” | CA dietary stems, not allergen terminology. |
| [Xunta, Proxecto CHEF: Cociña vexetariana e sen glute](https://recursos.edu.xunta.gal/sites/default/files/recurso/1525338193/Proxecto_CHEF_2017/cocia_vexetariana_e_sen_glute.html) | “vexetariano”; “vegano” | Official educational usage supports GL dietary stems; agreement remains editorial. |
| [Xunta GALP, Diversificación Bombóns de Mar](https://galp.xunta.gal/a-marina-ortegal/diversificacion-bombons-de-mar) | “certificación de calidade halal e kosher” | Official GL usage supports those spellings only; this spec makes no certification claim for dishes. |

## Proposed first phase and remaining size

Recommend two stages, to split into build PRs after the owner chooses the design. These are estimates, not commitments; the first row is too large for one campaign slice:

| Result | Production lines | Test lines |
| --- | --- | --- |
| Shared presets/media choices, paper preview and A4 PDF download | 700–1,100 | 350–650 |
| Responsive guest browsing renderer, language controls and accessible icon meanings | 450–750 | 300–500 |

Reuse `packages/media/src/routes.ts`, `packages/media/src/presentation.ts` and
`packages/media/src/renditions.ts` for images.
Check publication fidelity, separate extras, language fallback, escaping, icon accessibility and
long-menu pagination; inspect actual PDFs and phone/desktop output. No tests ran for this spec.
The browsing renderer is initially locally previewable; a deployed guest URL depends on the
customer entrance design. This proposed phase delivers no ordering and does not complete A508/A509.

Estimate later table ordering at **8–15 engineering days**, collection at **8–15**, after decisions;
shared work may overlap. Exclude customer hosting/payment integration. Credential lifetime,
staff acceptance/notifications, collection timing/pausing, readiness identification,
payment timing/provider and fiscal recording
need their own design before a reliable commitment. CSS theme upload comes later under a separate
design for styling boundaries, assets and preview compatibility; no arbitrary code in the first cut.

After Claude's read, show the owner local A4 and online 390/1280 mock-ups in EN/ES plus
Catalan, including a multipage last-page key. Keep them outside git; they are the next design evidence.

## Owner questions

1. Start with settings/presets and defer CSS theme upload? Recommend yes: compact text and photo-led
   examples make layout, colours, fonts and imagery editable immediately.
2. Deliver print plus browsing first, then ordering separately? Recommend yes, explicitly retaining
   both table and collection ordering in the full scope.
3. Use inline icons with the last-page key by default, retaining each-page key and words as choices?
   Recommend yes, with cereal/nut kinds always written per item.
