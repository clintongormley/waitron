# Nutrition icons

The shared paths in `packages/ui/src/nutrition-icons.ts` use the sources below. Register
`NUTRITION_ICONS` with `registerIcons` and draw, for example,
`<wt-icon name="allergen-eggs"></wt-icon>` beside the translated allergen name.
Names use `allergen-` followed by the allergen code, or `diet-` followed by the diet
code (including `diet-no_meat` and `diet-no_fish`); `allergies` is the product-button mark.
`wt-icon` hides its SVG from assistive technology, so supply words beside the icon or an
accessible name on its enclosing control.

| Source                                                                                                                        | Pinned revision                            | Source wording                                                                                                                                               | Adaptation                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Erudus/erudus-icons](https://github.com/Erudus/erudus-icons/tree/7e25e14a09b1aa0af4f85dc69ebfb03ff99480b7)                   | `7e25e14a09b1aa0af4f85dc69ebfb03ff99480b7` | "Erudus icons are licensed under the MIT License" ([source](https://github.com/Erudus/erudus-icons/blob/7e25e14a09b1aa0af4f85dc69ebfb03ff99480b7/README.md)) | Plain gluten, crustaceans, eggs, fish, peanuts, soya, milk, nuts, celery, mustard, sesame, molluscs, halal and kosher. Paths scaled from the 64-unit viewBox to 16 units. |
| [Templarian/MaterialDesign](https://github.com/Templarian/MaterialDesign/tree/2424e748e0cc63ab7b9c095a099b9fe239b737c0)       | `2424e748e0cc63ab7b9c095a099b9fe239b737c0` | "Icons: Apache 2.0" ([source](https://github.com/Templarian/MaterialDesign/blob/2424e748e0cc63ab7b9c095a099b9fe239b737c0/LICENSE))                           | food-drumstick-off (called meat-off in the design) and fish-off. Paths scaled from 24 to 16 units.                                                                        |
| [google/material-design-icons](https://github.com/google/material-design-icons/tree/49d4db35df873165d6bd6ba09b063c7dafbac2f4) | `49d4db35df873165d6bd6ba09b063c7dafbac2f4` | "Apache License" ([source](https://github.com/google/material-design-icons/blob/49d4db35df873165d6bd6ba09b063c7dafbac2f4/LICENSE))                           | Material Symbols outlined allergies, scaled and translated from its 960-unit viewBox to 16 units.                                                                         |

The full Erudus MIT notice is in `Erudus-LICENSE.txt`. The Pictogrammers source notice is
in `Pictogrammers-LICENSE.txt`; the Apache 2.0 licence is in
`../licenses/Apache-2.0.txt`. Material Symbols' existing notice is in
`../README.md`, under Material Symbols icons.

Lupin (a flower spike), sulphites (a flask), vegan (a two-leaf sprout) and vegetarian
(a carrot) are original Waitron drawings. They replace the source set's lupin, sulphites,
vegan and vegetarian drawings. No circled Erudus variant or coeliac mark is included.

The imported path coordinates are rounded to four decimal places after scaling. Multiple
source paths are joined into one SVG path. The 16-unit drawing uses `currentColor` through
`wt-icon`; no font or image file is needed at runtime.
