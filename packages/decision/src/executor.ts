import type { LanguageModel } from "ai";
import type { StepExecutor, StepExecutorContext, StepTurn, StepVerdict } from "e2e";
import { AgentError, isAgentError } from "e2e/agent";
import { actionSpace, type ActionSpace, type Control, type Operation, type Target } from "./elements.ts";
import { evaluate, type Decision } from "./evaluate.ts";
import { decisionRequest, elementRecords, nonSecretParams, targetKeyIndex, verdictRequest, type DecisionRequest, type HistoryEntry } from "./questions.ts";
import { fieldText } from "./text.ts";
import type { DecisionExecutorOptions } from "./types.ts";
/** Error codes the runtime owns: rethrown untouched, never absorbed as history. */
const RUNTIME_CODES = new Set(["STEP_BUDGET_EXHAUSTED", "STEP_TIMEOUT", "CANCELLED"]);
/** Builds a step executor that acts through a decision model and an optional text model. */
export function decisionExecutor(options: DecisionExecutorOptions): StepExecutor {
  const minProbability = options.minProbability ?? 0;
  const minConfidence = options.minConfidence ?? 0;
  if (!inUnit(minProbability) || !inUnit(minConfidence)) throw new Error("minProbability and minConfidence must be between 0 and 1.");
  if (!options.model.supportedQuestionTypes.includes("choice")) throw new Error("The decision model must answer choice questions.");
  const textModel = options.textModel;
  return { name: "decision", version: "1", cache: "inherit", ...(textModel === undefined ? {} : { model: textModel }), async runStep(ctx) { return run(ctx, options, minProbability, minConfidence); } };
}
function inUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
/** An action the loop dispatched, still open to its outcome suffix. */
interface Taken {
  readonly target: Target;
  readonly operation: string;
  readonly elementKey: string;
}
async function run(ctx: StepExecutorContext, options: DecisionExecutorOptions, minProbability: number, minConfidence: number): Promise<StepVerdict> {
  const model = options.model;
  let calls = 0;
  const turns: StepTurn[] = [];
  const transcript: string[] = [];
  const history: HistoryEntry[] = seedHistory(ctx);
  const language = ctx.model as Exclude<LanguageModel, string> | undefined;
  const canType = language !== undefined && ctx.target.verbs.has("type");
  let previousFingerprint: string | undefined;
  let lastTurn: StepTurn | undefined;
  let rejectedTerminals = 0;
  const finish = (verdict: StepVerdict): StepVerdict => {
    ctx.attachTurns(turns);
    ctx.attachTranscript(transcript.join("\n"));
    return verdict;
  };
  const gated = (decision: Decision): boolean => decision.probability >= minProbability && decision.confidence >= minConfidence;
  const describe = (decision: Decision): string => "p=" + decision.probability.toFixed(3) + ", confidence " + decision.confidence.toFixed(3);
  const budgetMessage = (): string => "The step did not conclude within its " + ctx.budgets.maxModelCalls + " decision calls.";
  const ask = async (request: DecisionRequest): Promise<Record<string, Decision> | undefined> => {
    if (calls >= ctx.budgets.maxModelCalls) return undefined;
    transcript.push(JSON.stringify({ state: request.state, questions: request.questions }));
    calls += 1;
    const answers = await evaluate(ctx, model, request);
    transcript.push(JSON.stringify(answers));
    return answers;
  };
  const askText = async (goal: string, field: { label: string; role: string; value?: string }, page: string): Promise<string | null | undefined> => {
    if (calls >= ctx.budgets.maxModelCalls) return undefined;
    if (language === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model chose type with no text model configured.");
    calls += 1;
    return fieldText(ctx, language, { goal, context: ctx.agentContext ?? null, params: nonSecretParams(ctx.step.params), field, page, recentActions: history.slice(-6) });
  };
  if (ctx.step.kind === "assert") {
    const observation = await ctx.observe({ tree: true });
    if (observation.treeUnavailable || observation.tree === undefined || emptyTree(observation)) return finish(inconclusive("A complete semantic observation is required."));
    const space = actionSpace(ctx, { path: observation.path ?? "", viewport: observation.viewport, tree: observation.tree }, false);
    const answers = await ask(verdictRequest(ctx.step.instruction, observation.path ?? "", space.pageText, elementRecords(space), []));
    if (answers === undefined) return finish(blocked(budgetMessage()));
    const verdict = need(answers.verdict, "verdict");
    if (verdict.choice === "holds" && gated(verdict)) return finish({ status: "passed", summary: "The screen shows the assertion holds (" + describe(verdict) + ")." });
    if (verdict.choice === "fails" && gated(verdict)) return finish({ status: "failed", errorCode: "ASSERTION_FAILED", summary: "The screen contradicts the assertion (" + describe(verdict) + ")." });
    return finish(inconclusive("The screen does not settle the assertion (" + describe(verdict) + ")."));
  }
  for (;;) {
    const observation = await ctx.observe({ tree: true });
    if (observation.treeUnavailable || observation.tree === undefined || emptyTree(observation)) return finish(blocked("A complete semantic observation is required."));
    const space = actionSpace(ctx, { path: observation.path ?? "", viewport: observation.viewport, tree: observation.tree }, canType);
    if (lastTurn !== undefined) {
      lastTurn.outcome += space.fingerprint !== previousFingerprint ? ", page changed" : ", page unchanged";
      lastTurn = undefined;
    }
    const previous = history.length === 0 ? undefined : history[history.length - 1];
    if (previous !== undefined) history[history.length - 1] = { ...previous, pageChanged: space.fingerprint !== previousFingerprint };
    previousFingerprint = space.fingerprint;
    if (stalled(history)) return finish(blocked("Three actions in a row changed nothing on screen."));
    const answers = await ask(decisionRequest(ctx, space, history, observation.path ?? ""));
    if (answers === undefined) return finish(blocked(budgetMessage()));
    const op = need(answers.operation, "operation");
    if (!gated(op)) return finish(blocked("The next operation is uncertain (" + describe(op) + ")."));
    if (op.choice === "blocked") return finish(blocked("The decision model cannot make progress."));
    if (op.choice === "done" || op.choice === "failed") {
      const terminal = await terminalCheck(op.choice);
      if (terminal !== undefined) return finish(terminal);
      continue;
    }
    const resolved = resolveTarget(op.choice, answers, space);
    if (resolved.targetAnswer !== undefined && !gated(resolved.targetAnswer)) return finish(blocked("The next target is uncertain (" + describe(resolved.targetAnswer) + ")."));
    const taken = resolved.taken;
    if (op.choice === "type") {
      const field = elementField(space, taken.elementKey);
      const text = await askText(ctx.step.instruction, field, space.pageText);
      if (text === undefined) return finish(blocked(budgetMessage()));
      if (text === null || text === "") {
        history.push({ action: taken.target.description, error: "no value for this field" });
        continue;
      }
      const outcome = await runTarget(taken, op.choice, op, resolved.targetAnswer, space, text, text);
      if (outcome !== undefined) return finish(outcome);
      continue;
    }
    let secret: string | undefined;
    if (op.choice === "typeSecret") {
      const resolvedSecret = resolveSecret(answers.secret);
      if (resolvedSecret.answer !== undefined && !gated(resolvedSecret.answer)) return finish(blocked("The next target is uncertain (" + describe(resolvedSecret.answer) + ")."));
      secret = resolvedSecret.name;
    }
    const outcome = await runTarget(taken, op.choice, op, resolved.targetAnswer, space, secret, undefined);
    if (outcome !== undefined) return finish(outcome);
  }
  /** Resolves the chosen operation to a bound target. Throws MODEL_OUTPUT_INVALID for anything the request did not offer. */
  function resolveTarget(choice: string, answers: Record<string, Decision>, space: ActionSpace): { taken: Taken; targetAnswer?: Decision } {
    const control = space.controls.get(choice as Control);
    if (control !== undefined) return { taken: { target: control, operation: choice, elementKey: "" } };
    const group = space.targets.get(choice as Operation);
    if (group === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model chose an unavailable operation.");
    if (group.size === 1) {
      const only = group.entries().next();
      if (only.done === true) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model chose an unavailable target.");
      return { taken: { target: only.value[1], operation: choice, elementKey: only.value[0] } };
    }
    const answer = answers[choice + "_target"];
    if (answer === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model returned no target answer.");
    const target = group.get(answer.choice);
    if (target === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model chose an unavailable target.");
    return { taken: { target, operation: choice, elementKey: answer.choice }, targetAnswer: answer };
  }
  /** Resolves the secret fill: the declared secret, or the gated secret answer with 2+ secrets. */
  function resolveSecret(answer: Decision | undefined): { name: string; answer?: Decision } {
    const secrets = ctx.step.secrets;
    if (secrets.length === 1 && secrets[0] !== undefined) return { name: secrets[0].name };
    if (answer === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model returned no secret answer.");
    const found = secrets.find((secret) => secret.name === answer.choice);
    if (found === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model chose an undeclared secret.");
    return { name: found.name, answer };
  }
  /** Dispatches a bound target, recording the turn and the history entry. Returns a verdict, or undefined to continue. */
  async function runTarget(taken: Taken, operation: string, op: Decision, targetAnswer: Decision | undefined, space: ActionSpace, argument?: string, historyText?: string): Promise<StepVerdict | undefined> {
    const outcome = "op p=" + op.probability.toFixed(3) + (targetAnswer === undefined ? "" : ", target p=" + targetAnswer.probability.toFixed(3));
    const turn: StepTurn = { index: turns.length + 1, calls: [callLabel(space, taken, operation, argument)], outcome };
    turns.push(turn);
    lastTurn = turn;
    try {
      await taken.target.run(argument);
    } catch (error) {
      if (isAgentError(error) && RUNTIME_CODES.has(error.code)) throw error;
      const code = isAgentError(error) ? error.code : error instanceof Error ? error.name : "unknown";
      history.push({ action: taken.target.description, ...(historyText === undefined ? {} : { text: historyText }), error: code });
      return undefined;
    }
    history.push({ action: taken.target.description, ...(historyText === undefined ? {} : { text: historyText }) });
    return undefined;
  }
  /** One turn call label, e.g. type [3] textbox "New todo" = "Buy milk". */
  function callLabel(space: ActionSpace, taken: Taken, operation: string, text?: string): string {
    if (taken.elementKey === "") return taken.target.description;
    const element = space.elements.find((item) => item.index === targetKeyIndex(taken.elementKey));
    if (element === undefined) return taken.target.description;
    return operation + " [" + element.index + "] " + element.role + " " + JSON.stringify(element.label) + (text === undefined ? "" : " = " + JSON.stringify(text));
  }
  /** Field the text helper writes, falling back to the key when the element is gone. */
  function elementField(space: ActionSpace, key: string): { label: string; role: string; value?: string } {
    const element = space.elements.find((item) => item.index === targetKeyIndex(key));
    if (element === undefined) return { label: key, role: "textbox" };
    return { label: element.label, role: element.role, ...(element.value === undefined ? {} : { value: element.value }) };
  }
  /**
   * Verifies a done/failed claim on a fresh screen with the actions taken so
   * far, but no model reasoning. Returns a verdict, or undefined to continue
   * the loop. The second rejected claim in a step ends it.
   */
  async function terminalCheck(claim: "done" | "failed"): Promise<StepVerdict | undefined> {
    const observation = await ctx.observe({ tree: true });
    const path = observation.path ?? "";
    const treed = observation.tree === undefined || observation.treeUnavailable ? undefined : actionSpace(ctx, { path, viewport: observation.viewport, tree: observation.tree }, false);
    const request = verdictRequest(ctx.step.instruction, path, treed?.pageText ?? "", treed === undefined ? undefined : elementRecords(treed), history.map((entry) => entry.action));
    const answers = await ask(request);
    if (answers === undefined) return blocked(budgetMessage());
    const verdict = need(answers.verdict, "verdict");
    if (claim === "done" && verdict.choice === "holds") return { status: "passed", summary: "The screen shows the step is done (" + describe(verdict) + ")." };
    if (claim === "failed" && verdict.choice === "fails") return { status: "failed", errorCode: "ACTION_FAILED", summary: "The screen shows the step failed (" + describe(verdict) + ")." };
    rejectedTerminals += 1;
    history.push({ action: claim, error: "check: " + verdict.choice });
    if (rejectedTerminals >= 2) {
      return claim === "failed"
        ? { status: "failed", errorCode: "ACTION_FAILED", summary: "A failed claim the screen does not confirm." }
        : blocked("A done claim the screen does not confirm.");
    }
    return undefined;
  }
}
/** Requires an answer the model returned; its absence is our bug or a broken transport. */
function need(answer: Decision | undefined, what: string): Decision {
  if (answer === undefined) throw new AgentError("MODEL_OUTPUT_INVALID", "The decision model returned no " + what + " answer.");
  return answer;
}
/** Seeds history from a replayed prefix, flagging the uncertain action. */
function seedHistory(ctx: StepExecutorContext): HistoryEntry[] {
  const prefix = ctx.replayedPrefix;
  if (prefix === undefined) return [];
  const seeded: HistoryEntry[] = prefix.replayedActions.map((action) => ({ action, replayed: true as const }));
  if (prefix.uncertainAction !== undefined) seeded.push({ action: prefix.uncertainAction, replayed: true, uncertain: true });
  return seeded;
}
/** Three recorded actions in a row with no page change. */
function stalled(history: readonly HistoryEntry[]): boolean {
  if (history.length < 3) return false;
  return history.slice(-3).every((entry) => entry.pageChanged === false);
}
/** No nodes to build an action space from. A truncated observation still acts on what is there. */
function emptyTree(observation: { tree?: { children?: readonly unknown[] } | undefined; text: string }): boolean {
  return observation.tree === undefined || ((observation.tree.children ?? []).length === 0 && observation.text.trim() === "");
}
/** An automation limitation says nothing about the application correctness. */
function blocked(summary: string): StepVerdict {
  return { status: "blocked", errorCode: "AUTOMATION_UNSUPPORTED", summary };
}
/** Insufficient evidence must never become an assertion pass. */
function inconclusive(summary: string): StepVerdict {
  return { status: "failed", errorCode: "ASSERTION_INCONCLUSIVE", summary };
}
