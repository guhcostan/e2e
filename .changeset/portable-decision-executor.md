---
"@e2e-dev/decision": minor
---

Add a decision-model executor over the System One choice API, hosted or self-hosted.
Clef, Clef-flash, and Jev are included transports. It chooses bounded
semantic actions, fills values supplied in test params, and judges assertions
against the current screen with probability and confidence gates. Secrets,
node authorization, navigation policy, and action budgets follow the runner's
existing contracts.
On structured transports (Clef, Jev) each action iteration now asks two
narrower questions — the operation, then the target within it — with
structured instructions and element records instead of one flat string
choice. Flat compatible endpoints keep the single choice unchanged.
