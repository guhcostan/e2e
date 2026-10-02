import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const noAiHook = `import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'ai' || specifier.startsWith('ai/')) throw new Error('The decision executor must not load ai.');
  return next(specifier, context);
} });`;
const root = fileURLToPath(new URL('../../', import.meta.url));
const password = 'decision-secret-test-value';
const requestSchema = z.object({
  model: z.string(), state: z.object({ screen: z.string(), path: z.string(), feedback: z.string() }),
  questions: z.object({ decision: z.object({ instructions: z.string(), criteria: z.record(z.string(), z.string()) }) }),
});
const reportSchema = z.object({ run: z.object({
  results: z.array(z.object({ titlePath: z.array(z.string()), status: z.string(), attempts: z.array(z.object({
    steps: z.array(z.object({ error: z.object({ code: z.string() }).optional(), agentMetrics: z.unknown().optional() })),
  })) })),
}) });

/** Starts an actual HTTP server and returns its ephemeral URL. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an HTTP address.');
  return `http://127.0.0.1:${address.port}`;
}

/** Reads generated artifacts recursively, including logs and reports. */
async function contents(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await contents(path));
    else result.push(await readFile(path, 'utf8'));
  }
  return result;
}

describe('decision executors through the built CLI and real Chromium', () => {
  let directory: string;
  let app: Server;
  let provider: Server;
  let report: z.infer<typeof reportSchema>;
  let artifacts: string[];
  const requests: unknown[] = [];
  let output = '';

  beforeAll(async () => {
    app = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      const login = request.url === '/login';
      response.end(`<!doctype html><html><body><h1>${login ? 'Login' : 'Form'}</h1>
        <label>Name<input id="name"></label>
        ${login ? '<label>Password<input id="password" type="password"></label>' : ''}
        <button id="save">${login ? 'Sign in' : 'Save'}</button><p role="status" id="status"></p>
        <script>document.getElementById('save').onclick = () => {
          const name = document.getElementById('name').value;
          const valid = ${login ? `document.getElementById('password').value === ${JSON.stringify(password)}` : 'true'};
          document.getElementById('status').textContent = valid ? 'Saved ' + name : 'Invalid password';
        };</script></body></html>`);
    });
    const appUrl = await listen(app);
    provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rawBody: unknown = JSON.parse(Buffer.concat(chunks).toString());
      const body = requestSchema.parse(rawBody);
      requests.push(rawBody);
      const { criteria, instructions } = body.questions.decision;
      const findAction = (action: string, value?: string, name?: string): string => {
        const match = Object.entries(criteria).find(([, description]) =>
          (description === action || description.startsWith(`${action} `)) &&
          (value === undefined || description.includes(JSON.stringify(value))) &&
          (name === undefined || description.includes(JSON.stringify(name))));
        if (!match) throw new Error(`The model was not offered ${action}.`);
        return match[0];
      };
      let choice: string;
      if ('holds' in criteria) choice = instructions.includes('negative') ? 'fails' : 'holds';
      else if (instructions.includes('unsafe')) choice = findAction('navigate');
      else if (!body.state.path.startsWith('/form') && !body.state.path.startsWith('/login')) choice = findAction('navigate');
      else if (!body.state.screen.includes('value="Ada"')) choice = findAction('type', 'Ada');
      else if (body.state.screen.includes('Saved Ada')) choice = 'complete';
      else if (body.state.path === '/login' && !body.state.feedback.includes('typeSecret')) choice = findAction('typeSecret');
      else choice = findAction('tap', undefined, body.state.path === '/login' ? 'Sign in' : 'Save');
      const invalid = instructions.includes('invalid');
      const uncertain = instructions.includes('uncertain');
      const result = {
        model: body.model,
        answers: { decision: {
          type: 'choice', choice: invalid ? 'invented-node' : choice, confidence: uncertain ? 0.1 : 1,
          probabilities: Object.fromEntries(Object.keys(criteria).map((key) => [key, key === choice ? 1 : 0])),
        } }, usage: { input_tokens: 100, output_tokens: 0 },
      };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/cloudflare' ? { success: true, result } : result));
    });
    const providerUrl = await listen(provider);
    directory = await mkdtemp(join(tmpdir(), 'e2e-decision-cli-'));
    await mkdir(join(directory, 'node_modules/@e2e-dev'), { recursive: true });
    await symlink(join(root, 'e2e'), join(directory, 'node_modules/e2e'));
    await symlink(join(root, 'decision'), join(directory, 'node_modules/@e2e-dev/decision'));
    await symlink(join(root, 'web'), join(directory, 'node_modules/@e2e-dev/web'));
    await writeFile(join(directory, 'e2e.config.ts'), `
      import { web } from '@e2e-dev/web';
      import { clef, jev, decisionExecutor } from '@e2e-dev/decision';
      export default {
        tests: 'decision.e2e.ts',
        targets: [{ engine: web(), app: { url: ${JSON.stringify(appUrl)} } }],
        credentials: { admin: { username: 'Ada', password: ${JSON.stringify(password)} } },
        agents: {
          clef: { executor: decisionExecutor({ model: clef({ accountId: 'test', apiKey: 'test', fetch: (_url, init) => fetch(${JSON.stringify(providerUrl + '/cloudflare')}, init) }) }) },
          jev: { executor: decisionExecutor({ model: jev({ apiKey: 'test', fetch: (_url, init) => fetch(${JSON.stringify(providerUrl + '/direct')}, init) }) }) },
        },
      };`);
    await writeFile(join(directory, 'decision.e2e.ts'), `
      import { test, expect, credentials } from 'e2e';
      for (const provider of ['clef', 'jev']) {
        test(provider + ' navigates, fills and saves', { agent: provider }, async ({ app, screen, agent }) => {
          await app.open('/');
          await agent.act('Open {destination}, fill Name with {name}, and save it.', { params: { destination: '/form', name: 'Ada' } });
          await expect(screen.getByRole('status')).toHaveText('Saved Ada');
          await agent.assert('The screen shows Saved Ada.');
        });
      }
      test('secret login', { agent: 'jev' }, async ({ app, screen, agent }) => {
        await app.open('/login');
        await agent.act('Sign in with {name} and {password}.', { params: { name: 'Ada', password: credentials.user('admin').password } });
        await expect(screen.getByRole('status')).toHaveText('Saved Ada');
        await agent.assert('The screen shows Saved Ada.');
      });
      test('negative assertion', { agent: 'jev' }, async ({ app, agent }) => {
        await app.open('/form'); await agent.assert('negative assertion');
      });
      test('uncertain assertion', { agent: 'clef' }, async ({ app, agent }) => {
        await app.open('/form'); await agent.assert('uncertain assertion');
      });
      test('invalid action', { agent: 'jev' }, async ({ app, agent }) => {
        await app.open('/form'); await agent.act('invalid fill {name}', { params: { name: 'Ada' } });
      });
      test('unsafe destination', { agent: 'jev' }, async ({ app, agent }) => {
        await app.open('/form'); await agent.act('unsafe destination {url}', { params: { url: 'file:///tmp/private' } });
      });
    `);
    try {
      const result = await execFileAsync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(noAiHook)}`, join(root, 'e2e/dist/cli/bin.js'), 'run', 'decision.e2e.ts', '--workers', '1', '--debug', '--video'], {
        cwd: directory, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }, timeout: 90_000,
      });
      output = result.stdout + result.stderr;
    } catch (error) {
      const result = z.object({ stdout: z.string(), stderr: z.string() }).parse(error);
      output = result.stdout + result.stderr;
    }
    const raw = JSON.parse(await readFile(join(directory, '.e2e/report.json'), 'utf8').catch((error) => { throw new Error(output, { cause: error }); }));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(join(root, 'e2e/schema/report-v1.schema.json'), 'utf8')));
    expect(validate(raw), JSON.stringify(validate.errors)).toBe(true);
    report = reportSchema.parse(raw);
    artifacts = await contents(join(directory, '.e2e'));
    const evidence = process.env.E2E_DECISION_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await cp(join(directory, '.e2e'), join(evidence, 'cli'), { recursive: true });
      await writeFile(join(evidence, 'cli-output.txt'), output);
    }
  }, 120_000);

  afterAll(async () => {
    await Promise.all([app, provider].filter(Boolean).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('completes navigation and a saved form with both providers', () => {
    expect(output).toContain('navigates, fills and saves');
    expect(report.run.results.filter((result) => result.titlePath.join(' ').includes('navigates, fills and saves')).map((result) => result.status)).toEqual(['passed', 'passed']);
  });

  it('fills a runner-authorized secret without sending it to either model or artifacts', () => {
    expect(report.run.results.find((result) => result.titlePath.at(-1) === 'secret login')?.status).toBe('passed');
    expect(JSON.stringify(requests)).not.toContain(password);
    for (const artifact of artifacts) expect(artifact).not.toContain(password);
  });

  it.each([
    ['negative assertion', 'ASSERTION_FAILED'], ['uncertain assertion', 'ASSERTION_INCONCLUSIVE'],
    ['invalid action', 'MODEL_OUTPUT_INVALID'], ['unsafe destination', 'POLICY_DENIED'],
  ])('reports %s with %s', (title, code) => {
    const result = report.run.results.find((entry) => entry.titlePath.at(-1) === title);
    expect(result?.status).not.toBe('passed');
    expect(result?.attempts.flatMap((attempt) => attempt.steps).map((step) => step.error?.code)).toContain(code);
  });
});
