import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { decisionExecutor } from '@e2e-dev/decision';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';

// Reads TYPESAFE_AI_API_KEY. Any AI SDK evaluation model with choice
// distributions works the same way.
export default {
  targets: [{ engine: web(), app: { url: 'http://localhost:3000' } }],
  agents: {
    default: { executor: decisionExecutor({ model: typeSafeAi.evaluationModel('jev-latest') }) },
  },
} satisfies E2EConfig;
