import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { clef, decisionExecutor, evaluationModel } from '@e2e-dev/decision';

const transport = clef({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
  model: process.env.BENCH_CLEF_MODEL === 'clef' ? 'clef' : 'clef-flash',
});
// BENCH_VIA_EVALUATE=1 routes every decision through AI SDK experimental_evaluate.
const model = process.env.BENCH_VIA_EVALUATE === '1' ? evaluationModel(transport) : transport;

export default {
  projectId: 'dev.e2e.bench-clef',
  tests: 'tests-bench/**/*.e2e.ts',
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        url: 'http://127.0.0.1:4272',
        command: { executable: 'node', args: ['app/server.mjs'], env: { PORT: '4272' } },
      },
    },
  ],
  timeout: 300_000,
  agents: {
    default: {
      executor: decisionExecutor({
        model,
        // BENCH_VISION=1 attaches the masked screenshot to every decision.
        ...(process.env.BENCH_VISION === '1' ? { vision: true } : {}),
        ...(process.env.BENCH_MIN_PROBABILITY === undefined ? {} : { minProbability: Number(process.env.BENCH_MIN_PROBABILITY) }),
        ...(process.env.BENCH_MIN_CONFIDENCE === undefined ? {} : { minConfidence: Number(process.env.BENCH_MIN_CONFIDENCE) }),
      }),
    },
  },
} satisfies E2EConfig;
