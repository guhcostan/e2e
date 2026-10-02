import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionExecutor, systemOne } from '@e2e-dev/decision';

// Laya serves the System One API and accepts structured values.
const model = systemOne({
  endpoint: 'https://api.laya.studio/v1/systemone',
  apiKey: process.env.LAYA_API_KEY ?? '',
  model: process.env.BENCH_LAYA_MODEL ?? 'laya-rl-agent',
  provider: 'laya',
  structured: true,
});

export default {
  projectId: 'dev.e2e.bench-laya',
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
        ...(process.env.BENCH_MIN_PROBABILITY === undefined ? {} : { minProbability: Number(process.env.BENCH_MIN_PROBABILITY) }),
        ...(process.env.BENCH_MIN_CONFIDENCE === undefined ? {} : { minConfidence: Number(process.env.BENCH_MIN_CONFIDENCE) }),
      }),
    },
  },
} satisfies E2EConfig;
