import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
} from "ai";
import { assertStateWithinLimit, type ClassifyInput } from "./questions.js";

/** Which service the request is billed through, and therefore which key applies. */
export type Routing = "typesafe" | "gateway";

/**
 * The state shape `evaluate` accepts, derived from the call it is passed to so
 * it cannot drift. Tool and CLI input is validated as JSON before it gets here.
 */
type EvaluateState = Parameters<typeof evaluate>[0]["state"];

export const DEFAULT_MODEL = "jev-latest";

const KEY_ENV_VAR: Record<Routing, string> = {
  typesafe: "TYPESAFE_AI_API_KEY",
  gateway: "AI_GATEWAY_API_KEY",
};

export interface Config {
  routing: Routing;
  model: string;
  apiKey: string | undefined;
}

export interface KeySource {
  apiKey: string | undefined;
  origin: "setting" | "environment" | "missing";
  envVar: string;
}

/**
 * The configured secret wins; the environment variable the upstream SDKs
 * already read is the fallback, so an operator who exports it globally does not
 * have to duplicate it into plugin settings.
 */
export function resolveKey(
  routing: Routing,
  settingValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): KeySource {
  const envVar = KEY_ENV_VAR[routing];
  const configured = settingValue?.trim();
  if (configured) return { apiKey: configured, origin: "setting", envVar };
  const fromEnv = env[envVar]?.trim();
  if (fromEnv) return { apiKey: fromEnv, origin: "environment", envVar };
  return { apiKey: undefined, origin: "missing", envVar };
}

/**
 * Gateway routes are namespaced by provider. A bare model id is the common
 * setting, so qualify it rather than failing the call.
 */
export function gatewayModelId(model: string): string {
  return model.includes("/") ? model : `typesafe-ai/${model}`;
}

export function missingKeyMessage(routing: Routing, envVar: string): string {
  return [
    `No API key configured for ${routing} routing.`,
    `Set one with \`bb plugin config jev set apiKey <key>\`, or export ${envVar} for the bb server process.`,
  ].join(" ");
}

export function createModel(config: Config): EvaluationModel {
  const { routing, model, apiKey } = config;
  if (!apiKey) throw new Error(missingKeyMessage(routing, KEY_ENV_VAR[routing]));
  return routing === "gateway"
    ? createGateway({ apiKey }).evaluationModel(gatewayModelId(model))
    : createTypeSafeAi({ apiKey }).evaluationModel(model);
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probability?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  levels: number;
  nearestLevel: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface BooleanAnswer {
  type: "boolean";
  probability: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | BooleanAnswer;

export interface ClassifyResult {
  model: string;
  answers: Record<string, Answer>;
  usage: { inputTokens?: number; outputTokens?: number };
  warnings?: string[];
}

/** TypeSafe reports Choice and Score confidence beside the answers. */
function confidenceFor(
  providerMetadata: Record<string, unknown> | undefined,
  id: string,
): number | undefined {
  const namespace = providerMetadata?.typesafe as
    | Record<string, unknown>
    | undefined;
  const confidence = namespace?.confidence as Record<string, unknown> | undefined;
  const value = confidence?.[id];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function classify(
  model: EvaluationModel,
  input: ClassifyInput,
  options: { signal?: AbortSignal } = {},
): Promise<ClassifyResult> {
  assertStateWithinLimit(input.state);

  const result = await evaluate({
    model,
    state: input.state as EvaluateState,
    questions: input.questions,
    abortSignal: options.signal,
  });

  const metadata = result.providerMetadata as
    | Record<string, unknown>
    | undefined;
  const answers: Record<string, Answer> = {};

  for (const [id, answer] of Object.entries(result.answers)) {
    const confidence = confidenceFor(metadata, id);
    if (answer.type === "choice") {
      answers[id] = {
        type: "choice",
        choice: answer.choice,
        probability: answer.probabilities?.[answer.choice],
        probabilities: answer.probabilities,
        confidence,
      };
    } else if (answer.type === "score") {
      const levels = input.questions[id];
      const criteria =
        levels?.type === "score" ? levels.criteria : ([] as string[]);
      answers[id] = {
        type: "score",
        score: answer.score,
        levels: criteria.length,
        nearestLevel: criteria[Math.round(answer.score)] ?? "",
        probabilities: answer.probabilities,
        confidence,
      };
    } else {
      answers[id] = { type: "boolean", probability: answer.probability };
    }
  }

  const warnings = result.warnings.map((warning) =>
    "message" in warning && typeof warning.message === "string"
      ? warning.message
      : warning.type,
  );

  return {
    model: result.response.modelId,
    answers,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
