---
"@e2e-dev/decision": minor
---

Add a decision-model executor over the System One choice API, hosted or self-hosted.
Clef, Clef-flash, and Jev are included transports. It chooses bounded
semantic actions, fills values supplied in test params, and judges assertions
against the current screen with probability and confidence gates. Secrets,
node authorization, navigation policy, and action budgets follow the runner's
existing contracts.
An opt-in `vision: true` attaches the masked viewport screenshot for models
that declare vision (Clef); Jev stays text-only and withheld or tainted
viewports fall back to semantic text.
