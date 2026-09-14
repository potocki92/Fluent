/**
 * The AI boundary.
 *
 * WHAT IS AND IS NOT A JOB FOR A MODEL. Almost everything Phase 5 computes is
 * deterministic and cheap: word frequencies, dictionary coverage, personal
 * difficulty, which words to pre-teach, which questions to ask. None of it is
 * sent anywhere, because sending a solved arithmetic problem to a language model
 * buys nothing and costs money, latency, and a privacy surface. The one thing
 * Fluent genuinely cannot compute is what a chapter MEANS — and therefore what a
 * comprehension question about it would be. That, and only that, is behind this
 * interface.
 *
 * THE MODEL'S OUTPUT IS A CANDIDATE, NEVER A FACT. Everything that comes back
 * goes through `validateQuestion`: schema, answer structure, grounding against
 * sentences that actually exist in this chapter. A malformed, ambiguous or
 * hallucinated question is rejected with a reason, and nothing unvalidated
 * reaches a learner. That is why this file defines a *request* and a *response*
 * and no behaviour at all.
 *
 * NO PROVIDER IS IMPORTED ANYWHERE ELSE. `openai.whatever()` sprayed across
 * twelve files is how a codebase acquires a vendor. There is one interface, one
 * registration point, and domain code that has never heard of a provider.
 *
 * SERVER ONLY. Every implementation of this interface needs a key, and a key in
 * a browser bundle is a key that has been published. Nothing in this directory
 * may be imported from a `"use client"` module.
 *
 * PRIVACY. A `private_import` chapter is somebody's own document. The request
 * below carries the minimum a generator needs — the chunk's sentences and their
 * ids — and the pipeline never sends a whole book, never logs chapter text, and
 * records ids rather than content on the job. A deployment that wires up an
 * external provider is making a data-flow decision about private content, and
 * `docs/architecture/story-learning-engine.md` is where that decision is
 * written down.
 */

import type { QuestionCandidate, QuestionScope } from "@/lib/story/questions";

/** One sentence handed to a generator, with the id its questions must cite. */
export interface GenerationSentence {
  id: number;
  paragraphPosition: number;
  text: string;
}

/** A word the chapter uses, offered as a vocabulary target. */
export interface GenerationWord {
  wordId: number;
  lemma: string;
  translationPl: string | null;
  occurrenceCount: number;
}

/** What a generator is asked to write questions about. */
export interface ChapterQuestionRequest {
  /** Opaque to the provider; used for logging ids and for idempotency. */
  chapterId: string;
  /** The chapter's language. German today; the interface does not assume it. */
  language: string;
  chapterTitle: string | null;
  /**
   * Whether this request covers one slice of the chapter or the whole of it.
   *
   * `local` asks for detail, vocabulary and grammar questions about the text in
   * front of it; `chapter` asks for the questions that need the whole arc —
   * main idea, sequence — and receives a condensed view rather than every
   * sentence.
   */
  scope: QuestionScope;
  sentences: readonly GenerationSentence[];
  /** Vocabulary worth asking about, already filtered to words in this chunk. */
  vocabulary: readonly GenerationWord[];
  /** How many candidates to propose. The pipeline asks for more than it keeps. */
  targetCount: number;
  /** Concept codes the generator may tag; anything else is rejected downstream. */
  allowedConceptCodes: readonly string[];
  /**
   * True when the source is a learner's private import.
   *
   * A provider that cannot honour a no-retention, no-training guarantee must
   * REFUSE rather than proceed — see {@link ProviderCapabilities}.
   */
  isPrivateContent: boolean;
}

/** What a provider guarantees. Checked before a private chapter is ever sent. */
export interface ProviderCapabilities {
  /** Human-readable provider id, stored on the job for cost attribution. */
  name: string;
  /** Model id, stored on the job. */
  model: string;
  /**
   * The provider is configured so that content is not retained or trained on.
   *
   * NOT a claim this codebase can verify — it is an assertion the deployment
   * makes when it registers a provider, and the pipeline refuses private content
   * without it. An unverifiable guarantee that is at least explicit is what makes
   * the refusal possible at all.
   */
  supportsPrivateContent: boolean;
  /** Whether the provider can be held to a JSON schema. Required; see below. */
  supportsStructuredOutput: boolean;
}

/** What one generation call cost. Developer-facing; never shown to a learner. */
export interface GenerationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** In whatever currency the deployment accounts in, when it can compute one. */
  costUsd: number | null;
}

export interface ChapterQuestionResponse {
  /** Candidates, exactly as the provider returned them. Unvalidated by contract. */
  candidates: readonly QuestionCandidate[];
  usage: GenerationUsage | null;
}

/**
 * The whole AI surface of Fluent.
 *
 * Two methods, both optional to implement beyond the first: a provider that can
 * only write questions is a useful provider.
 */
export interface StoryQuestionProvider {
  capabilities: ProviderCapabilities;
  generateChapterQuestions(
    request: ChapterQuestionRequest,
  ): Promise<ChapterQuestionResponse>;
}

/**
 * Why a generation run could not use AI at all.
 *
 * Returned rather than thrown, for the same reason the server actions return
 * their failures: this is an expected outcome that the admin UI has to render,
 * not an exception.
 */
export type ProviderRefusal =
  | "not_configured"
  | "private_content_not_permitted"
  | "structured_output_required";

/**
 * The registry.
 *
 * Deliberately a mutable module-level slot rather than a dependency-injection
 * framework: there is one provider per deployment, it is registered once at
 * startup, and everything else asks for it by calling {@link getQuestionProvider}.
 * With nothing registered, Fluent behaves exactly as it does today — the
 * deterministic half of the pipeline runs, admins can author questions by hand,
 * and chapters without a bank simply have no Challenge.
 */
let provider: StoryQuestionProvider | null = null;

export function registerQuestionProvider(next: StoryQuestionProvider | null): void {
  provider = next;
}

export function getQuestionProvider(): StoryQuestionProvider | null {
  return provider;
}

/**
 * May this provider be given this request?
 *
 * The private-content check is the important one and it fails CLOSED: a chapter
 * belonging to one learner is never sent to a provider that has not declared it
 * will not retain it, whatever the admin clicked.
 */
export function checkProvider(
  candidate: StoryQuestionProvider | null,
  request: Pick<ChapterQuestionRequest, "isPrivateContent">,
): ProviderRefusal | null {
  if (!candidate) return "not_configured";
  if (!candidate.capabilities.supportsStructuredOutput) {
    // Parsing "Question: … Answer: …" out of prose with a regular expression is
    // how a pipeline acquires silent, undetectable corruption. A provider that
    // cannot be held to a schema is not usable here.
    return "structured_output_required";
  }
  if (request.isPrivateContent && !candidate.capabilities.supportsPrivateContent) {
    return "private_content_not_permitted";
  }
  return null;
}

/**
 * The JSON schema a provider must hold its output to.
 *
 * Exported as data rather than described in a prose prompt so that a structured
 * output mode can be handed exactly this, and so the shape cannot drift away
 * from {@link QuestionCandidate} without someone editing them together.
 */
export const QUESTION_CANDIDATE_SCHEMA = {
  type: "object",
  required: ["questions"],
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "type", "prompt", "skillCode", "sourceSentenceIds"],
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["comprehension", "contextual_vocabulary", "grammar", "transfer"],
          },
          type: {
            type: "string",
            enum: ["multiple_choice", "true_false", "cloze", "sequence"],
          },
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIdx: { type: "integer" },
          acceptedAnswers: { type: "array", items: { type: "string" } },
          sequenceItems: { type: "array", items: { type: "string" } },
          skillCode: { type: "string" },
          conceptCodes: { type: "array", items: { type: "string" } },
          wordId: { type: ["integer", "null"] },
          difficulty: { type: ["integer", "null"] },
          sourceSentenceIds: { type: "array", items: { type: "integer" } },
          explanationPl: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
