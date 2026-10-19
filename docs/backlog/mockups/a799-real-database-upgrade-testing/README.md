# A799: older-database upgrade review boards

These static boards accompany the [design proposal](../../../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md). They illustrate proposed checks and worked examples. They are not product screenshots, a proposed dashboard or evidence that an upgrade test passed. The design and build still await owner agreement.

Start with board A on your phone. The recommendation is an invented restaurant created through an older image’s normal product paths. The alternative is a private venue snapshot with separately approved custody. Answering A alone does not approve the later release-window, artifact-store, issued-F1 or determinism choices.

| Board | What you can assess                                              | English phone                                                                             | Spanish phone                                                                             |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A     | Invented venue versus a private venue copy; first owner question | [Light](a-source-choice-en-light-390.png) · [Dark](a-source-choice-en-dark-390.png)       | [Light](a-source-choice-es-light-390.png) · [Dark](a-source-choice-es-dark-390.png)       |
| B     | Frozen sale facts, a changed quantity and a separate new sale    | [Light](b-preserved-facts-en-light-390.png) · [Dark](b-preserved-facts-en-dark-390.png)   | [Light](b-preserved-facts-es-light-390.png) · [Dark](b-preserved-facts-es-dark-390.png)   |
| C     | A760’s reset boundary and the first supported old image          | [Light](c-history-boundary-en-light-390.png) · [Dark](c-history-boundary-en-dark-390.png) | [Light](c-history-boundary-es-light-390.png) · [Dark](c-history-boundary-es-dark-390.png) |
| D     | Input/start/comparison failures and the issued-F1 coverage limit | [Light](d-run-and-results-en-light-390.png) · [Dark](d-run-and-results-en-dark-390.png)   | [Light](d-run-and-results-es-light-390.png) · [Dark](d-run-and-results-es-dark-390.png)   |

Each board has English (`en`) and Spanish (`es`) versions, light and dark, at 390 and 1280 px. Replace `390` in a linked filename with `1280` for the desktop version. Every PNG has a same-named SVG source beside it. The resolved palette comes from `packages/ui-core/src/tokens/colors.css` at the design’s source SHA.

Ana’s illustrative sale is 0.350 kg of cheese at €22.00/kg (€7.70), coffee €2.20 and wine €3.63, totalling €13.53. A new cheese price of €24.00/kg gives €8.40 for the same quantity; it must not change the earlier €7.70 line. An unpaid order with recipient details is not an issued full invoice. Required issued-F1 coverage stays open when the selected older image cannot create it through a supported product path.

All numbers and outcomes are examples. The capture, migration, preservation and continued-operation checks have not been built or run. A760 is a separate approved operator job; these boards authorize no squash, reset or conversion across its boundary.
