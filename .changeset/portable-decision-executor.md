---
"@e2e-dev/decision": minor
---

Add `@e2e-dev/decision`, an executor that runs `agent.act` and `agent.assert`
through a decision model instead of an LLM. It accepts any AI SDK evaluation
model with choice distributions, such as `typeSafeAi.evaluationModel('jev-latest')`,
and decides through `experimental_evaluate` (`ai` loads only on that path), or
the built-in `clef()`, `jev()`, and `systemOne()` transports for hosted,
self-hosted, and local System One endpoints; `evaluationModel()` exposes those
transports to `experimental_evaluate` too.

The executor chooses bounded semantic actions, fills values supplied in test
params, and judges assertions against the current screen. Native transports
ask the operation first and then the target within it; a lone target
dispatches directly. Acting decisions see the step's action history, and the
same action on the same screen three times anywhere in the step blocks it.
Probability and confidence gates are opt-in. A `complete` choice passes only
after an independent judgment on a fresh screen. An opt-in `vision: true`
attaches the masked viewport screenshot for transports that declare vision
(Clef); Jev and AI SDK evaluation models stay text-only, and withheld or
tainted viewports fall back to semantic text. Secrets, node authorization,
navigation policy, and action budgets follow the runner's existing contracts.
