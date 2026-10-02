# @e2e-dev/decision

Run `agent.act` and `agent.assert` with Cloudflare Clef, Clef-flash, or TypeSafe
Jev through their shared System One choice API.

```ts
import { clef, decisionExecutor } from '@e2e-dev/decision';

const executor = decisionExecutor({
  model: clef({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
  }),
});
```

Set `agents.default.executor` in the e2e config. Switch the transport to
`jev({ apiKey })` to use TypeSafe, or `systemOne({ endpoint, apiKey, model,
provider })` for a compatible server. The package does not need the AI SDK.

Actions choose their node and arguments from the latest redacted semantic
tree and the test's string params. Secrets remain handles filled through the
runner. A completion choice must pass an independent fresh-screen judgment.
Probability and confidence both default to a 0.9 gate. Every step calls the
model; the executor opts out of the replay cache.

Text generation, `waitFor`, and `extract` are outside this executor. Pixels are
opt-in through `vision: true` on vision models (Clef); Jev stays text-only.
See the [decision models guide](https://e2e.tester.army/docs/decision-models)
for supported actions, provider setup, policy gates, and the 255-choice limit.
