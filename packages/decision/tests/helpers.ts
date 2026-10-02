import type { ExecutorActions, ExecutorModelCall, ExecutorNode, ExecutorObservation, JsonValue, StepExecutorContext } from 'e2e';
import { vi } from 'vitest';
import type { DecisionRequest, DecisionResult } from '../src/index.ts';

/** Makes a confident distribution over exactly the alternatives that were offered. */
export function answer(request: DecisionRequest, choice: string): DecisionResult {
  return {
    choice, modelId: 'scripted', confidence: 1,
    probabilities: Object.fromEntries(Object.keys(request.criteria).map((key) => [key, key === choice ? 1 : 0])),
    inputTokens: 100, outputTokens: 0,
  };
}

/**
 * Finds an atomic action by its verb and declared arguments, without
 * relying on its generated id. Descriptions start with the verb, so
 * `type` never matches `typeSecret`.
 */
export function actionChoice(request: DecisionRequest, action: string, value?: string): string {
  const flat: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(request.criteria)) if (typeof candidate === 'string') flat[key] = candidate;
  const entry = Object.entries(flat).find(([, description]) =>
    (description === action || description.startsWith(`${action} `)) &&
    (value === undefined || description.includes(JSON.stringify(value))));
  if (!entry) throw new Error(`No ${action} choice was offered.`);
  return entry[0];
}

/** Whether any string-valued criterion starts with the prefix. */
export function offersPrefix(request: DecisionRequest, prefix: string): boolean {
  return Object.values(request.criteria).some((value) => typeof value === 'string' && value.startsWith(prefix));
}

/** Finds a hierarchical target by its verb and declared arguments. */
export function actionTarget(request: DecisionRequest, action: string, value?: string): string {
  const entry = Object.entries(request.criteria).find(([, criterion]) => {
    if (typeof criterion !== 'object' || criterion === null || Array.isArray(criterion)) return false;
    const element = (criterion as Record<string, JsonValue>)['element'];
    return typeof element === 'string' &&
      (element === action || element.startsWith(action + ' ')) &&
      (value === undefined || element.includes(JSON.stringify(value)));
  });
  if (!entry) throw new Error('No ' + action + ' target was offered.');
  return entry[0];
}

export function context(options: {
  kind?: 'act' | 'assert'; params?: Readonly<Record<string, JsonValue>>;
  tree?: ExecutorNode; maxModelCalls?: number; observation?: Partial<ExecutorObservation>;
} = {}) {
  const signal = new AbortController().signal;
  const noop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const actions: ExecutorActions = {
    tap: vi.fn<ExecutorActions['tap']>().mockResolvedValue(undefined),
    type: vi.fn<ExecutorActions['type']>().mockResolvedValue(undefined),
    typeSecret: vi.fn<ExecutorActions['typeSecret']>().mockResolvedValue(undefined),
    navigate: vi.fn<ExecutorActions['navigate']>().mockResolvedValue(undefined),
    doubleTap: noop, longPress: noop, secondaryTap: noop, hover: noop,
    press: vi.fn<ExecutorActions['press']>().mockResolvedValue(undefined),
    select: vi.fn<ExecutorActions['select']>().mockResolvedValue(undefined),
    check: vi.fn<ExecutorActions['check']>().mockResolvedValue(undefined),
    drag: noop, scrollTo: noop, scrollUntil: noop,
    upload: noop,
    scroll: vi.fn<ExecutorActions['scroll']>().mockResolvedValue(undefined),
    back: vi.fn<ExecutorActions['back']>().mockResolvedValue(undefined),
    typeText: noop, pressKey: noop,
    dismissKeyboard: vi.fn<ExecutorActions['dismissKeyboard']>().mockResolvedValue(undefined),
    tapAt: async (point) => ({ point, summary: 'tap' }),
    hoverAt: async (point) => ({ point, summary: 'hover' }),
    hitTest: async (point) => ({ point, summary: 'hit' }),
  };
  const tree = options.tree ?? { id: 'root', children: [{ id: 'name', role: 'textbox', name: 'Name', value: '' }] };
  const observe = vi.fn<StepExecutorContext['observe']>().mockResolvedValue({
    revision: '1', text: '#name textbox "Name"', truncated: false,
    viewport: { width: 800, height: 600 }, tree, ...options.observation,
  });
  const usage: ExecutorModelCall[] = [];
  const ctx: StepExecutorContext = {
    step: { kind: options.kind ?? 'act', index: 0, instruction: 'Fill Name with {name}', params: options.params,
      secrets: [{ name: 'password', purpose: 'password' }] },
    attempt: { testId: 'test', attemptId: 'attempt', index: 0, signal, memory: new Map() },
    signal, target: { name: 'web', platform: 'web', verbs: new Set(Object.keys(actions) as (keyof ExecutorActions)[]) },
    model: undefined, providerOptions: undefined, ledger: 'the actor claimed success', agentContext: 'project context',
    actions, observe, pixelsTainted: true, attachTranscript: () => {}, attachTurns: () => {}, attachScreenshot: async () => 'screenshot',
    budgets: { maxActions: 25, maxModelCalls: options.maxModelCalls ?? 25, remainingMs: () => 60_000,
      actionsUsed: () => 0, recordModelCall: (call) => { usage.push(call ?? {}); }, runTool: (_call, body) => body() },
  };
  return { ctx, usage, observe, actions };
}
