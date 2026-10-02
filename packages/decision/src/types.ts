import type { JsonValue } from 'e2e';

/**
 * One bounded choice. Flat transports receive plain strings throughout;
 * structured transports receive objects (instructions as a labeled record,
 * criteria values as element records). Some compatible endpoints reject
 * structured values the native APIs accept.
 * The binding of verb, node, and arguments stays in code; the model
 * only ever sees the choice id and its description.
 */
export interface DecisionRequest {
  readonly state: JsonValue;
  readonly instructions: JsonValue;
  readonly criteria: Readonly<Record<string, JsonValue>>;
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
  /**
   * Whether the endpoint accepts structured instructions and criteria
   * values. Native Clef and Jev do; compatible endpoints may not, so they
   * stay on flat strings unless they opt in.
   */
  readonly structured?: boolean;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/** A System One-compatible HTTP endpoint. Credentials stay in the transport closure. */
export interface SystemOneOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly provider: string;
  readonly envelope?: 'direct' | 'cloudflare';
  /** Set for endpoints that accept structured values, such as Clef and Jev. Defaults to false. */
  readonly structured?: boolean;
  readonly fetch?: typeof fetch;
}

/** Cloudflare's hosted Clef models. */
export interface ClefOptions {
  readonly accountId: string;
  readonly apiKey: string;
  /** Defaults to 'clef-flash'. */
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
