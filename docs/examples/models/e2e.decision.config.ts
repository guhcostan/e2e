import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { clef, jev, decisionExecutor } from '@e2e-dev/decision';

const provider = process.env.DECISION_PROVIDER ?? 'clef-flash';
if (!['clef', 'clef-flash', 'jev'].includes(provider)) {
  throw new Error('DECISION_PROVIDER must be clef, clef-flash, or jev.');
}
const model = provider === 'jev'
  ? jev({ apiKey: process.env.TYPESAFE_API_KEY ?? '' })
  : clef({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
      apiKey: process.env.CLOUDFLARE_AUTH_TOKEN ?? '',
      model: provider === 'clef' ? 'clef' : 'clef-flash',
    });

export default {
  targets: [{ engine: web(), app: { url: 'http://localhost:3000' } }],
  agents: { default: { executor: decisionExecutor({ model }) } },
} satisfies E2EConfig;
