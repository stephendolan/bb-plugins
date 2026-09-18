import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from "ai/test";
import { describe, expect, it } from "vitest";
import { classify, gatewayModelId, resolveKey } from "./jev.js";
import { classifyInputSchema, MAX_STATE_BYTES } from "./questions.js";

describe("resolveKey", () => {
  it("prefers the configured secret over the environment", () => {
    const resolved = resolveKey("typesafe", " configured ", {
      TYPESAFE_AI_API_KEY: "from-env",
    });
    expect(resolved).toMatchObject({ apiKey: "configured", origin: "setting" });
  });

  it("falls back to the routing's environment variable", () => {
    expect(resolveKey("gateway", "", { AI_GATEWAY_API_KEY: "gw" })).toMatchObject({
      apiKey: "gw",
      origin: "environment",
      envVar: "AI_GATEWAY_API_KEY",
    });
  });

  it("reports a missing key rather than returning a blank one", () => {
    expect(resolveKey("typesafe", undefined, {})).toMatchObject({
      apiKey: undefined,
      origin: "missing",
    });
  });
});

describe("gatewayModelId", () => {
  it("qualifies a bare model id", () => {
    expect(gatewayModelId("jev-latest")).toBe("typesafe-ai/jev-latest");
  });

  it("leaves an already-qualified id alone", () => {
    expect(gatewayModelId("typesafe-ai/jev-1.13")).toBe("typesafe-ai/jev-1.13");
  });
});

describe("classifyInputSchema", () => {
  it("rejects a score question with fewer than two levels", () => {
    const parsed = classifyInputSchema.safeParse({
      state: "hello",
      questions: {
        severity: { type: "score", instructions: "How bad?", criteria: ["Fine"] },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty question map", () => {
    expect(
      classifyInputSchema.safeParse({ state: "hello", questions: {} }).success,
    ).toBe(false);
  });

  it("accepts a record state", () => {
    const parsed = classifyInputSchema.safeParse({
      state: { subject: "refund", body: "charged twice" },
      questions: {
        refund: { type: "boolean", instructions: "Refund requested?" },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("classify", () => {
  const model = new MockEvaluationModel({
    provider: "typesafe-ai",
    modelId: "jev-1.13",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async () => ({
      answers: {
        department: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.9, support: 0.1 },
        },
        severity: { type: "score", score: 1.2 },
        refund: { type: "boolean", probability: 0.97 },
      },
      warnings: [],
      usage: { inputTokens: 42 },
      providerMetadata: { typesafe: { confidence: { department: 0.88 } } },
      response: { modelId: "jev-1.13", timestamp: new Date() },
    }),
  });

  const input = classifyInputSchema.parse({
    state: "I was charged twice.",
    questions: {
      department: {
        type: "choice",
        instructions: "Which team?",
        criteria: { billing: "Charges and refunds", support: "Everything else" },
      },
      severity: {
        type: "score",
        instructions: "How severe?",
        criteria: ["Cosmetic", "Workaround exists", "Blocking"],
      },
      refund: { type: "boolean", instructions: "Refund requested?" },
    },
  });

  it("surfaces the chosen option's own probability and confidence", async () => {
    const result = await classify(model, input);
    expect(result.answers.department).toMatchObject({
      choice: "billing",
      probability: 0.9,
      confidence: 0.88,
    });
  });

  it("labels a fractional score with its nearest level", async () => {
    const result = await classify(model, input);
    expect(result.answers.severity).toMatchObject({
      score: 1.2,
      levels: 3,
      nearestLevel: "Workaround exists",
    });
  });

  it("reports the resolved model id, not the requested alias", async () => {
    const result = await classify(model, input);
    expect(result.model).toBe("jev-1.13");
  });

  it("refuses a state larger than the request limit", async () => {
    await expect(
      classify(model, {
        state: "x".repeat(MAX_STATE_BYTES + 1),
        questions: input.questions,
      }),
    ).rejects.toThrow(/at most/);
  });
});

describe("tool parameter schema", () => {
  // BB converts this schema for the provider at agent session start, not at
  // plugin load, so an unrepresentable schema would fail far from here.
  it("converts to JSON Schema for the provider", async () => {
    const { z } = await import("zod");
    const schema = z.toJSONSchema(classifyInputSchema, { io: "input" });
    expect(schema).toMatchObject({ type: "object" });
    expect(Object.keys(schema.properties ?? {})).toEqual(["state", "questions"]);
    expect(JSON.stringify(schema)).not.toContain("$ref");
  });
});
