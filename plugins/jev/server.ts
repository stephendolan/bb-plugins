// bb-plugin-jev — a native classification tool backed by TypeSafe's Jev.
//
// One evaluation path serves two surfaces: the `jev_classify` agent tool and
// the `bb jev` CLI. Both read the same settings, so a key or model change
// applies to whichever surface runs next.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  classify,
  createModel,
  DEFAULT_MODEL,
  missingKeyMessage,
  resolveKey,
  type Config,
  type Routing,
} from "./lib/jev.js";
import { classifyInputSchema, type ClassifyInput } from "./lib/questions.js";

const TOOL_DESCRIPTION = `Classify, score, or filter with Jev — an evaluation model that returns typed answers with calibrated probabilities instead of prose.

Give it one state (a string or a record) and a map of named questions:
- "choice" picks one of your declared options
- "score" grades an ordered rubric and returns a fractional position
- "boolean" returns P(true) for a proposition

Every question is answered against the same state in a single request. Reach for this when a judgment is repeated, high-volume, and the possible answers are known up front — routing, triage, labeling, relevance filtering, rubric grading. Do not reach for it when you need generated text, a written rationale, or a one-off decision you can simply make yourself: Jev returns numbers, never explanations.`;

const TOOL_INSTRUCTIONS = `jev_classify returns calibrated probabilities, not certainties. Compare them against a threshold you have checked on known examples before acting on them automatically, and fall back to your own judgment when the winning probability is close to the field.`;

interface ResolvedConfig extends Config {
  origin: "setting" | "environment" | "missing";
  envVar: string;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "API key",
      secret: true,
    },
    routing: {
      type: "select",
      label: "Routing",
      options: ["typesafe", "gateway"],
      default: "typesafe",
    },
    model: {
      type: "string",
      label: "Model",
      default: DEFAULT_MODEL,
    },
  });

  // Re-read per call so a settings change lands without a plugin reload.
  async function resolveConfig(): Promise<ResolvedConfig> {
    const current = await settings.get();
    const routing = current.routing as Routing;
    const model = current.model.trim() || DEFAULT_MODEL;
    const key = resolveKey(routing, current.apiKey);
    return { routing, model, ...key };
  }

  async function run(input: ClassifyInput, signal?: AbortSignal) {
    const config = await resolveConfig();
    return classify(createModel(config), input, { signal });
  }

  bb.agents.registerTool({
    name: "jev_classify",
    description: TOOL_DESCRIPTION,
    instructions: TOOL_INSTRUCTIONS,
    presentation: {
      label: {
        pending: "Classifying with Jev",
        completed: "Classified with Jev",
      },
    },
    parameters: classifyInputSchema,
    async execute(input, { signal }) {
      try {
        const result = await run(input, signal);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        bb.log.warn(`jev_classify failed: ${message}`);
        return {
          content: [{ type: "text", text: `Jev classification failed: ${message}` }],
          isError: true,
        };
      }
    },
  });

  bb.cli.register({
    name: "jev",
    summary: "Classify text with TypeSafe's Jev evaluation model",
    commands: [
      {
        name: "status",
        summary: "Show the configured routing, model, and key source",
        usage: "bb jev status [--json]",
      },
      {
        name: "check",
        summary: "Run one live probe to confirm the key and model work",
        usage: "bb jev check [--json]",
      },
      {
        name: "classify",
        summary: "Classify a state against a JSON map of questions",
        usage:
          'bb jev classify --state <text> --questions \'{"refund":{"type":"boolean","instructions":"Is a refund requested?"}}\' [--json]',
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command] = args;

      const fail = (message: string) => ({ exitCode: 1, stderr: `${message}\n` });
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`,
      });

      if (command === "status") {
        const config = await resolveConfig();
        return reply(
          {
            routing: config.routing,
            model: config.model,
            apiKey: config.origin,
            envVar: config.envVar,
          },
          [
            `Routing:  ${config.routing}`,
            `Model:    ${config.model}`,
            `API key:  ${
              config.origin === "missing"
                ? `not configured (set it, or export ${config.envVar})`
                : `from ${config.origin}`
            }`,
          ].join("\n"),
        );
      }

      if (command === "check") {
        const config = await resolveConfig();
        if (!config.apiKey) {
          return fail(missingKeyMessage(config.routing, config.envVar));
        }
        try {
          const result = await run(
            {
              state: "The customer was charged twice and wants their money back.",
              questions: {
                refund: {
                  type: "boolean",
                  instructions: "Is the customer asking for a refund?",
                },
              },
            },
            ctx.signal,
          );
          const probability = (result.answers.refund as { probability: number })
            .probability;
          return reply(result, `OK — ${result.model} answered P(true)=${probability}`);
        } catch (error) {
          return fail(
            `Probe failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (command === "classify") {
        const state = flagValue(args, "state");
        const questions = flagValue(args, "questions");
        if (!state || !questions) {
          return fail("Both --state and --questions are required.");
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(questions);
        } catch (error) {
          return fail(
            `--questions must be JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const input = classifyInputSchema.safeParse({ state, questions: parsed });
        if (!input.success) {
          return fail(
            input.error.issues
              .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
              .join("\n"),
          );
        }

        try {
          const result = await run(input.data, ctx.signal);
          return reply(result, formatAnswers(result));
        } catch (error) {
          return fail(
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return fail("Usage: bb jev <status|check|classify> [--json]");
    },
  });

  bb.log.info("jev_classify registered");
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index !== -1) return argv[index + 1];
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function formatAnswers(result: {
  model: string;
  answers: Record<string, unknown>;
}): string {
  const lines = Object.entries(result.answers).map(([id, answer]) => {
    const value = answer as Record<string, unknown>;
    if (value.type === "choice") {
      return `${id}: ${value.choice} (p=${value.probability ?? "n/a"})`;
    }
    if (value.type === "score") {
      return `${id}: ${value.score} of ${(value.levels as number) - 1} — ${value.nearestLevel}`;
    }
    return `${id}: P(true)=${value.probability}`;
  });
  return [`Model: ${result.model}`, ...lines].join("\n");
}
