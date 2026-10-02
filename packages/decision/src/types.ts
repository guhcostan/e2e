import type { JsonValue } from 'e2e';

/**
 * One bounded choice. Descriptions and instructions are plain strings:
 * gateways in front of a System One API may reject structured values.
 * The binding of verb, node, and arguments stays in code; the model
 * only ever sees the choice id and its description string.
 */
export interface DecisionRequest {
  readonly state: JsonValue;
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** A choice and its distribution, with optional provider token accounting. */
export interface DecisionResult {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** The transport an executor uses; it has no dependency on an engine or the AI SDK. */
export interface DecisionModel {
  readonly provider: string;
  readonly modelId: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** A System One-compatible HTTP endpoint. Credentials stay in the transport closure. */
export interface SystemOneOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly provider: string;
  readonly envelope?: 'direct' | 'cloudflare';
  readonly fetch?: typeof fetch;
}

/** Cloudflare's hosted Clef models. */
export interface ClefOptions {
  readonly accountId: string;
  readonly apiKey: string;
  readonly model?: 'clef' | 'clef-flash';
  readonly fetch?: typeof fetch;
}

/** TypeSafe's hosted Jev model or a pinned Jev version. */
export interface JevOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly fetch?: typeof fetch;
}

/** Confidence and probability gates apply to every action and assertion. */
export interface DecisionExecutorOptions {
  readonly model: DecisionModel;
  /** Minimum probability of the selected option, greater than 0.5 and at most 1. Default 0.9. */
  readonly minProbability?: number;
  /** Minimum reported confidence, between 0 and 1. Default 0.9. */
  readonly minConfidence?: number;
}
