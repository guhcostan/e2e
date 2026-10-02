import type { E2EConfig } from 'e2e';
import { clef, jev, decisionExecutor, systemOne } from '@e2e-dev/decision';

const model = clef({ accountId: 'test', apiKey: 'test', model: 'clef-flash' });
const executor = decisionExecutor({ model });
const agents: E2EConfig['agents'] = { default: { executor } };
void agents;
decisionExecutor({ model: jev({ apiKey: 'test', model: 'jev-1.13.0' }) });
systemOne({ endpoint: 'http://localhost:8000/v1/systemone', apiKey: 'test', model: 'local', provider: 'local' });

// @ts-expect-error Decision transports are not AI SDK language models.
const invalid: E2EConfig['agents'] = { default: { model } };
void invalid;
// @ts-expect-error Clef's hosted selectors are closed.
clef({ accountId: 'test', apiKey: 'test', model: 'unknown' });
// @ts-expect-error A decision executor requires a transport, not a model id.
decisionExecutor({ model: 'jev-latest' });
