import { z } from "zod";

/** Jev accepts one state per call; anything larger is rejected upstream. */
export const MAX_STATE_BYTES = 128_000;

const text = z.string().trim().min(1).max(2_000);

/**
 * The shared value every question is asked about. An array is one state, not a
 * batch of unrelated inputs.
 */
export const stateSchema = z.union([
  z.string().trim().min(1),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    instructions: text.describe("The decision to make about the state."),
    criteria: z
      .record(z.string().min(1).max(64), text.nullable())
      .describe("Option name to description. Null means no description.")
      .refine(
        (options) => {
          const count = Object.keys(options).length;
          return count >= 1 && count <= 255;
        },
        { message: "choice questions need between 1 and 255 options" },
      ),
  }),
  z.object({
    type: z.literal("score"),
    instructions: text.describe("The rubric to grade the state against."),
    criteria: z
      .array(text)
      .min(2)
      .max(10)
      .describe("Ordered level descriptions, lowest first."),
  }),
  z.object({
    type: z.literal("boolean"),
    instructions: text.describe("The proposition to estimate P(true) for."),
    criteria: z
      .object({ true: text.optional(), false: text.optional() })
      .optional()
      .describe("Optional descriptions of what each outcome means."),
  }),
]);

export const questionsSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), questionSchema)
  .refine(
    (questions) => {
      const count = Object.keys(questions).length;
      return count >= 1 && count <= 32;
    },
    { message: "ask between 1 and 32 questions per call" },
  );

export const classifyInputSchema = z.object({
  state: stateSchema.describe(
    "The text or structured record every question is asked about.",
  ),
  questions: questionsSchema.describe(
    "Named decisions to make about the state. Each answer comes back under its name.",
  ),
});

export type ClassifyInput = z.infer<typeof classifyInputSchema>;
export type Question = z.infer<typeof questionSchema>;

/** Reject an oversized state before spending a request on it. */
export function assertStateWithinLimit(state: ClassifyInput["state"]): void {
  const size = Buffer.byteLength(
    typeof state === "string" ? state : JSON.stringify(state),
    "utf8",
  );
  if (size > MAX_STATE_BYTES) {
    throw new Error(
      `State is ${size} bytes; Jev accepts at most ${MAX_STATE_BYTES}. Summarize or chunk it first.`,
    );
  }
}
