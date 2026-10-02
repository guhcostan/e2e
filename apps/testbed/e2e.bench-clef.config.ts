import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { clef, decisionExecutor } from '@e2e-dev/decision';

const model = clef({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
});

export default {
  projectId: 'dev.e2e.bench-clef',
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
      executor: decisionExecutor({ model }),
    },
  },
} satisfies E2EConfig;
