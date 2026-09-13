import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONCEPT_CATALOG, CONCEPTS, isConceptCode } from "./concepts";
import { SKILL_CATALOG, SKILLS, isSkillCode } from "./skills";

/**
 * The catalogs exist twice — as TypeScript unions here, and as reference tables
 * in the migration, so that `skill_code` columns can carry a real foreign key.
 * Two copies drift, so this pins them together: a code added on one side and
 * forgotten on the other fails here rather than at runtime, where it would
 * surface as a foreign-key violation in the middle of someone's review session.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260913160000_learning_engine.sql"),
  "utf8",
);

/** Codes seeded by the `insert into public.<table> … values` block. */
function seededCodes(table: string): string[] {
  const start = MIGRATION.indexOf(`insert into public.${table} (`);
  expect(start).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("on conflict (code) do update", start);
  expect(end).toBeGreaterThan(start);

  const block = MIGRATION.slice(start, end);
  return [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((match) => match[1]);
}

describe("skill catalog", () => {
  it("matches the skills seeded by the migration", () => {
    expect(seededCodes("skills").sort()).toEqual(Object.keys(SKILL_CATALOG).sort());
  });

  it("is keyed consistently and ordered for display", () => {
    for (const [code, definition] of Object.entries(SKILL_CATALOG)) {
      expect(definition.code).toBe(code);
      expect(definition.labelPl.length).toBeGreaterThan(0);
    }
    const order = SKILLS.map((skill) => skill.sortOrder);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("claims evidence only for the skills Fluent actually exercises", () => {
    const assessed = SKILLS.filter((skill) => skill.isAssessed).map((s) => s.code);
    // Reading tests, the placement bank and the review deck — and nothing else.
    expect(assessed.sort()).toEqual([
      "grammar",
      "reading_comprehension",
      "receptive_vocabulary",
    ]);
    // Nothing in Fluent asks a learner to speak, so speaking stays unmeasured.
    expect(SKILL_CATALOG.speaking.isAssessed).toBe(false);
    expect(SKILL_CATALOG.active_vocabulary.isAssessed).toBe(false);
  });

  it("narrows unknown strings safely", () => {
    expect(isSkillCode("grammar")).toBe(true);
    expect(isSkillCode("telepathy")).toBe(false);
    expect(isSkillCode(null)).toBe(false);
  });
});

describe("concept catalog", () => {
  it("matches the concepts seeded by the migration", () => {
    expect(seededCodes("concepts").sort()).toEqual(
      Object.keys(CONCEPT_CATALOG).sort(),
    );
  });

  it("points every concept at a skill that exists", () => {
    for (const concept of CONCEPTS) {
      expect(isSkillCode(concept.skillCode)).toBe(true);
      expect(concept.labelPl.length).toBeGreaterThan(0);
      expect(concept.descriptionPl.length).toBeGreaterThan(0);
    }
  });

  it("keeps the taxonomy small enough to stay meaningful", () => {
    // A weakness list nobody can act on is worse than none. If this ever needs
    // raising, the question to ask first is whether the new codes are things a
    // learner could actually practise.
    expect(CONCEPTS.length).toBeLessThanOrEqual(40);
  });

  it("narrows unknown strings safely", () => {
    expect(isConceptCode("preposition_case")).toBe(true);
    expect(isConceptCode("vibes")).toBe(false);
    expect(isConceptCode(undefined)).toBe(false);
  });
});
