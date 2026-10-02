import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionExecutor, jev, systemOne } from '@e2e-dev/decision';

// TypeSafe's API by default; BENCH_JEV_ENDPOINT points at a System One-compatible
// gateway serving Jev instead, which takes flat strings.
const endpoint = process.env.BENCH_JEV_ENDPOINT;
const apiKey = process.env.JEV_API_KEY ?? '';
const modelId = process.env.BENCH_JEV_MODEL ?? 'jev-latest';
const model = endpoint === undefined
  ? jev({ apiKey, model: modelId })
  : systemOne({ endpoint, apiKey, model: modelId, provider: 'jev-compatible' });

export default {
  projectId: 'dev.e2e.bench-jev',
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
  agents: { default: { executor: decisionExecutor({ model }) } },
} satisfies E2EConfig;
