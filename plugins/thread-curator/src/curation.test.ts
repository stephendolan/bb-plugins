import { describe, expect, it } from "vitest";
import {
  buildCuratorPrompt,
  normalizeCategories,
  parseCuratorAnswer,
  type CuratableThread,
} from "./curation";

const threads: CuratableThread[] = [
  { id: "a", title: "Fix auth", project: "App", status: "idle", updatedAt: 1 },
  { id: "b", title: "Plan launch", project: "Site", status: "active", updatedAt: 2 },
  { id: "c", title: "Write tests", project: "App", status: "idle", updatedAt: 3 },
];

describe("curator output", () => {
  it("accepts fenced JSON and rejects prose-only output", () => {
    expect(
      parseCuratorAnswer(
        '```json\n{"names":[],"categories":[{"label":"Ship","threadIndexes":[0]}]}\n```',
      ).categories[0]?.label,
    ).toBe("Ship");
    expect(() => parseCuratorAnswer("looks good")).toThrow(/no JSON/i);
  });

  it("deduplicates assignments and catches omitted threads", () => {
    const answer = parseCuratorAnswer(
      JSON.stringify({
        names: [],
        categories: [
          { label: "Build", threadIndexes: [0, 1, 1, 99] },
          { label: "Build", threadIndexes: [1] },
        ],
      }),
    );
    expect(normalizeCategories(answer, threads)).toEqual([
      { id: "build", label: "Build", threadIds: ["a", "b"] },
      { id: "uncategorized", label: "Unsorted", threadIds: ["c"] },
    ]);
  });

  it("uses integer indexes and includes continuity without repeating ids", () => {
    const prompt = buildCuratorPrompt({
      threads,
      namingCandidates: [],
      previous: [{ id: "work", label: "Work", threadIds: ["b"] }],
      namingInstruction: "Name the job",
    });
    expect(prompt).toContain('"previousCategories":[{"label":"Work","threadIndexes":[1]}]');
    expect(prompt).not.toContain('"threadIds"');
  });
});
