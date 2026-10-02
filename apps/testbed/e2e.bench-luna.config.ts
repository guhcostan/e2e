import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export default {
  projectId: 'dev.e2e.bench-luna',
  tests: 'tests-agent/**/*.e2e.ts',
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
      model: createOpenAICompatible({
        name: 'opencodex',
        baseURL: process.env.OPENCODEX_BASE_URL ?? 'http://127.0.0.1:10100/v1',
        apiKey: process.env.OPENCODEX_API_KEY ?? 'local',
      }).languageModel(process.env.BENCH_LUNA_MODEL ?? 'gpt-6-luna'),
      judgmentTimeout: 90_000,
      maxSteps: 40,
      maxModelCalls: 60,
      context: 'This is the e2e playground app: a small multi-page site with todos, forms, a sign-in flow, a workspace wizard, and release notes.',
    },
  },
} satisfies E2EConfig;
