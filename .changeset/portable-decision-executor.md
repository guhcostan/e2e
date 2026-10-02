---
"@e2e-dev/decision": minor
---

Add a decision-model executor over the System One choice API, hosted or self-hosted.
Clef, Clef-flash, and Jev are included transports. It chooses bounded
semantic actions, fills values supplied in test params, and judges assertions
against the current screen, with optional probability and confidence gates
(off by default). Secrets,
node authorization, navigation policy, and action budgets follow the runner's
existing contracts.
On structured transports (Clef, Jev) each action iteration now asks two
narrower questions — the operation, then the target within it — with
structured instructions and element records instead of one flat string
choice. Flat compatible endpoints keep the single choice unchanged.
`decisionExecutor` also accepts AI SDK evaluation models, such as
`typeSafeAi.evaluationModel('jev-latest')`, and decides through
`experimental_evaluate`; `ai` loads only on that path. `evaluationModel()`
exposes `clef()`, `jev()`, and `systemOne()` endpoints to
`experimental_evaluate`. Rounded distributions validate with the same
half-unit tolerance the AI SDK uses, and `jev()` declares TypeSafe's two
places.
An operation with a single target dispatches it without a one-option
question, acting decisions receive the step's action history, and the repeat
guard counts the same action on the same screen across the whole step.
