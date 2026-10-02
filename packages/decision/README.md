# @e2e-dev/decision

Run `agent.act` and `agent.assert` with a decision model instead of an LLM:
any AI SDK evaluation model with choice distributions, or a System One
endpoint such as Cloudflare Clef, TypeSafe Jev, or a self-hosted model.

```ts
import { clef, decisionExecutor } from '@e2e-dev/decision';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';

// Through AI SDK experimental_evaluate (needs the ai package):
const jevExecutor = decisionExecutor({ model: typeSafeAi.evaluationModel('jev-latest') });

// Through the built-in Cloudflare transport:
const clefExecutor = decisionExecutor({
  model: clef({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
  }),
});
```

Set `agents.default.executor` in the e2e config. The built-in transports are
`clef()`, `jev({ apiKey })`, and `systemOne({ endpoint, apiKey, model,
provider })` for a compatible server; they need no AI SDK, and
`evaluationModel()` exposes them to `experimental_evaluate`.

Actions choose their node and arguments from the latest redacted semantic
tree and the test's string params. Secrets remain handles filled through the
runner. A completion choice must pass an independent fresh-screen judgment.
Probability and confidence gates are opt-in through `minProbability` and
`minConfidence`. Every step calls the model; the executor opts out of the
replay cache.

Text generation, `waitFor`, and `extract` are outside this executor. Pixels are
opt-in through `vision: true` on vision transports (Clef); Jev and AI SDK
evaluation models stay text-only.
See the [decision models guide](https://e2e.tester.army/docs/decision-models)
for supported actions, provider setup, policy gates, and the 255-choice limit.
