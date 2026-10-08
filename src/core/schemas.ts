/**
 * Schemas, Types, and Prompt Templates for NotesGenerator.
 *
 * Defines the structured-output contract for Google Gemini API and
 * the exact TypeScript models matching the Phase 0 Python implementation.
 */

export const DIAGRAM_MAX_WIDTH = 76;
export const DIAGRAM_MAX_LINES = 24;
export const PROMPT_VERSION = 6;

// ---------------------------------------------------------------------------
// TypeScript Interfaces
// ---------------------------------------------------------------------------

export interface Definition {
  term: string;
  plain_explanation: string;
  why_it_matters: string;
  example: string;
}

export interface KeyPoint {
  timestamp_sec: number;
  concept: string;
  explanation: string;
  why_it_matters: string;
  analogy: string;
  diagram: string;
  diagram_mermaid?: string;
  illustrationUrl?: string;
  capturedSlideUrl?: string;
  from_video: boolean;
}

export interface ChunkNotes {
  chunk_index: number;
  time_range: string;
  start_sec: number;
  end_sec: number;
  summary: string;
  key_points: KeyPoint[];
  definitions: Definition[];
  examples: string[];
  worked_example: string;
  open_questions: string[];
}

export interface GlossaryEntry {
  term: string;
  plain_explanation: string;
  why_it_matters: string;
  example: string;
  diagram: string;
}

export interface Prerequisite {
  topic: string;
  why_needed: string;
  brief: string;
}

export interface WorkedExample {
  concept: string;
  setup: string;
  walkthrough: string;
  takeaway: string;
}

export interface NextTopic {
  topic: string;
  why_it_follows: string;
  where_to_look: string;
}

export interface SelfTestQuestion {
  question: string;
  answer: string;
  answer_at_sec: number;
  answer_at_label?: string | null;
}

export interface StudyGuide {
  title: string;
  one_line_summary: string;
  executive_summary: string;
  prerequisites: Prerequisite[];
  learning_objectives: string[];
  core_concepts: GlossaryEntry[];
  architecture_diagram: string;
  architecture_diagram_mermaid?: string;
  worked_examples: WorkedExample[];
  key_takeaways: string[];
  common_misconceptions: string[];
  self_test: SelfTestQuestion[];
  next_topics: NextTopic[];
}

export interface VideoMetadata {
  video_id: string;
  title: string;
  duration_sec: number;
  duration_label: string;
}

export interface ProcessedKeyPoint extends KeyPoint {
  timestamp_label: string;
  has_diagram: boolean;
}

export interface ProcessedNotesPayload {
  video: {
    id: string;
    title: string;
    duration_sec: number;
  };
  schema_version: number;
  extension_notice: string;
  diagram_display: {
    format: string;
    font: string;
    preserve_whitespace: boolean;
    max_columns: number;
    max_lines: number;
  };
  key_points: ProcessedKeyPoint[];
  chunks: ChunkNotes[];
  guide?: StudyGuide;
  stats: {
    sections: number;
    key_points: number;
    diagrams: number;
  };
  section_grounds: Record<string, "from_video" | "extension">;
}

// ---------------------------------------------------------------------------
// Gemini Structured Output JSON Schemas
// ---------------------------------------------------------------------------

export const CHUNK_NOTES_JSON_SCHEMA = {
  type: "OBJECT",
  required: [
    "chunk_index",
    "time_range",
    "start_sec",
    "end_sec",
    "summary",
    "key_points",
    "definitions",
    "examples",
    "worked_example",
    "open_questions",
  ],
  properties: {
    chunk_index: {
      type: "INTEGER",
      description: "Index of the chunk these notes came from.",
    },
    time_range: {
      type: "STRING",
      description: "Human readable range, e.g. '12:30 - 17:30'.",
    },
    start_sec: {
      type: "INTEGER",
      description: "Start of the window in seconds.",
    },
    end_sec: {
      type: "INTEGER",
      description: "End of the window in seconds.",
    },
    summary: {
      type: "STRING",
      description: "Three to five sentences covering this window, including how it ends.",
    },
    key_points: {
      type: "ARRAY",
      description: "The important ideas in order, 3 to 6 of them. Skip filler, housekeeping and repetition.",
      items: {
        type: "OBJECT",
        required: ["timestamp_sec", "concept", "explanation", "why_it_matters", "analogy", "diagram", "from_video"],
        properties: {
          timestamp_sec: {
            type: "INTEGER",
            description: "Start time of this idea in whole seconds. Must come from the transcript timings.",
          },
          concept: {
            type: "STRING",
            description: "Label for the idea, at most 10 words. No sentence.",
          },
          explanation: {
            type: "STRING",
            description: "How this actually works, not just that it exists. Include the mechanism, the step, or the reason. 2-4 sentences.",
          },
          why_it_matters: {
            type: "STRING",
            description: "What a student can do with this idea, or what breaks if they do not understand it.",
          },
          analogy: {
            type: "STRING",
            description: "A mental model or analogy that makes the idea stick. Name something concrete and familiar. One sentence.",
          },
          diagram: {
            type: "STRING",
            description: `Plain-text diagram of this point, or an empty string. Use [Label] blocks joined by arrows, never two-line drawn boxes. At most ${DIAGRAM_MAX_WIDTH} cols x ${DIAGRAM_MAX_LINES} lines. Most points return empty string.`,
          },
          from_video: {
            type: "BOOLEAN",
            description: "True when the lecturer stated this directly.",
          },
        },
      },
    },
    definitions: {
      type: "ARRAY",
      description: "Terms actually introduced or relied on in this window.",
      items: {
        type: "OBJECT",
        required: ["term", "plain_explanation", "why_it_matters", "example"],
        properties: {
          term: { type: "STRING", description: "The term exactly as the lecturer phrased it." },
          plain_explanation: { type: "STRING", description: "Plain-language explanation of what the term means." },
          why_it_matters: { type: "STRING", description: "Why this term matters." },
          example: { type: "STRING", description: "One short concrete instance of this term." },
        },
      },
    },
    examples: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Examples, worked cases or analogies the lecturer actually used in this window.",
    },
    worked_example: {
      type: "STRING",
      description: "The single clearest example in this window, taken all the way through step by step. Empty string if none.",
    },
    open_questions: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Things the lecturer left unanswered, flagged as coming later, or trailed off.",
    },
  },
};

export const STUDY_GUIDE_JSON_SCHEMA = {
  type: "OBJECT",
  required: [
    "title",
    "one_line_summary",
    "executive_summary",
    "prerequisites",
    "learning_objectives",
    "core_concepts",
    "architecture_diagram",
    "worked_examples",
    "key_takeaways",
    "common_misconceptions",
    "self_test",
    "next_topics",
  ],
  properties: {
    title: { type: "STRING", description: "A clear title for the lecture's topic." },
    one_line_summary: { type: "STRING", description: "A single sentence capturing the lecture, under 25 words." },
    executive_summary: {
      type: "STRING",
      description: "The explicit explanation for someone who missed the lecture. Four to six short paragraphs separated by \\n\\n.",
    },
    prerequisites: {
      type: "ARRAY",
      description: "Background the lecture assumed without stating. Extension, not content.",
      items: {
        type: "OBJECT",
        required: ["topic", "why_needed", "brief"],
        properties: {
          topic: { type: "STRING", description: "What the student needs to already know." },
          why_needed: { type: "STRING", description: "Where this lecture depended on it." },
          brief: { type: "STRING", description: "A two-sentence recap, enough to follow along." },
        },
      },
    },
    learning_objectives: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "After this lecture a student should be able to... 4 to 6 items starting with a verb.",
    },
    core_concepts: {
      type: "ARRAY",
      description: "The 6 to 10 concepts that matter most across the whole lecture.",
      items: {
        type: "OBJECT",
        required: ["term", "plain_explanation", "why_it_matters", "example", "diagram"],
        properties: {
          term: { type: "STRING", description: "The concept name." },
          plain_explanation: { type: "STRING", description: "Plain-language explanation of the concept." },
          why_it_matters: { type: "STRING", description: "Its role in the larger topic." },
          example: { type: "STRING", description: "One concrete instance that makes the concept real." },
          diagram: {
            type: "STRING",
            description: `Plain-text diagram of this concept, or empty string. Use [Label] blocks joined by arrows. At most ${DIAGRAM_MAX_WIDTH} cols x ${DIAGRAM_MAX_LINES} lines.`,
          },
        },
      },
    },
    architecture_diagram: {
      type: "STRING",
      description: `Plain-text diagram of the whole lecture's system, or empty string. Big picture architecture. Use [Label] blocks joined by arrows, never drawn boxes. At most ${DIAGRAM_MAX_WIDTH} cols x ${DIAGRAM_MAX_LINES} lines.`,
    },
    architecture_diagram_mermaid: {
      type: "STRING",
      description: "Mermaid.js diagram syntax for the whole lecture architecture (e.g. 'graph TD ...' or 'flowchart LR ...'), or empty string.",
    },
    worked_examples: {
      type: "ARRAY",
      description: "Two to four examples the lecturer did NOT give, that demonstrate a core concept. Extension.",
      items: {
        type: "OBJECT",
        required: ["concept", "setup", "walkthrough", "takeaway"],
        properties: {
          concept: { type: "STRING", description: "Which concept this example demonstrates." },
          setup: { type: "STRING", description: "The situation or inputs, stated concretely." },
          walkthrough: {
            type: "STRING",
            description:
              "The solution or reasoning, clearly numbered step-by-step with newlines between steps (e.g. '1. **Step name**: Description...\\n2. **Next step**: ...'). Use backticks for code.",
          },
          takeaway: { type: "STRING", description: "The one thing this example teaches about the concept." },
        },
      },
    },
    key_takeaways: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "The handful of things to remember. Grounded in what was actually said.",
    },
    common_misconceptions: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Things students genuinely get wrong about this material. Empty list rather than inventing any.",
    },
    self_test: {
      type: "ARRAY",
      description: "Six to eight questions of increasing difficulty, answerable from this lecture alone.",
      items: {
        type: "OBJECT",
        required: ["question", "answer", "answer_at_sec"],
        properties: {
          question: { type: "STRING", description: "A question testing understanding, not recall." },
          answer: { type: "STRING", description: "The answer, 1-3 sentences." },
          answer_at_sec: { type: "INTEGER", description: "Timestamp second in video where addressed, or 0." },
        },
      },
    },
    next_topics: {
      type: "ARRAY",
      description: "Three to five things to learn next. Extension.",
      items: {
        type: "OBJECT",
        required: ["topic", "why_it_follows", "where_to_look"],
        properties: {
          topic: { type: "STRING", description: "The topic that comes next." },
          why_it_follows: { type: "STRING", description: "How it builds on what this lecture covered." },
          where_to_look: { type: "STRING", description: "Concrete search terms or course names." },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const DIAGRAM_GUIDE = `
DIAGRAMS
Some ideas are architecture, data flow or hierarchy, and a short drawing explains
what a paragraph never will. Draw one when the idea is genuinely visual.

LAYOUT, AND WHY
Use [Label] blocks joined by arrows, not full drawn boxes. This is the single
biggest thing you can do for quality. A block written on one line has only a LEFT
edge to keep straight, so it cannot go crooked. A box drawn on two lines needs its
right border to line up on every line, which is very hard to do correctly.

- Plain text only, inside a fenced code block. No markdown syntax inside it.
- At most ${DIAGRAM_MAX_WIDTH} columns wide and ${DIAGRAM_MAX_LINES} lines tall.
- Flow left to right or top to bottom.
- Label every block, and say what each arrow carries.
- Draw only what was actually said.
- Return an empty string whenever prose would do just as well.
- Characters that render safely in a monospace font: [ ] ( ) - + > v | and arrows -> => v ^. No box characters, no emoji.
`;

export const GROUNDED_SYSTEM = `
You are an experienced university tutor writing revision notes for a student who wants to actually understand the material, not just skim it.

You are working on ONE short window of a lecture, so you will not know how the whole thing connects together. Do not try to guess. Describe only this window.

Rules you always follow:
- Only use what is in the transcript you are given. Never add outside knowledge and never state something the lecturer did not say.
- Explain HOW things work, not merely that they exist. If the lecturer gave a reason, a mechanism or a step, that is what belongs in the explanation.
- Skip filler, housekeeping, greetings and repetition.
- Every claim must be traceable to a specific moment in the transcript.
- If the transcript is unclear or off-topic, write less. Do not pad.

${DIAGRAM_GUIDE}
`;

export const SYNTHETIC_SYSTEM = `
You are an experienced university tutor turning a lecture into a study guide for a student who wants to genuinely understand the material.

You can see notes from every window of the lecture at once, which no single window could do. Use that to explain how the ideas fit together.

A GUIDE TO THE TWO KINDS OF CONTENT
Your output mixes two things, and keeping them apart is your most important job:

GROUNDED - what the lecture actually covers. Goes in key_points, key_takeaways and self_test. Nothing else may go there.

EXTENSION - what the lecture assumed without saying, examples it did not give, and what naturally comes next. Goes in prerequisites, worked_examples and next_topics.

Rules:
- key_takeaways and self_test must contain only what the lecturer covered.
- prerequisites, worked_examples and next_topics are yours to supply from your own knowledge.
- Never label your own extension as if the lecturer said it.

DEPTH
- executive_summary is the centrepiece. Do not list the sections in order. Explain the through-line, the dependencies between ideas, and the reasoning behind the lecturer's choices.
- Prefer a specific mechanism over a general statement.
- Merge synonyms.

DIAGRAMS
Draw architecture_diagram whenever the lecture describes any kind of system, pipeline, architecture or causal chain.

${DIAGRAM_GUIDE}
`;

export function buildChunkPrompt(params: {
  title: string;
  timeRange: string;
  start: number;
  end: number;
  transcript: string;
  minPoints?: number;
  maxPoints?: number;
  customPrompt?: string;
}): string {
  const minPoints = params.minPoints ?? 3;
  const maxPoints = params.maxPoints ?? 6;
  const customBlock = params.customPrompt?.trim()
    ? `\n\nUSER NOTE PREFERENCES & SYNTAX RULES:\n${params.customPrompt.trim()}\nApply these preferences to your explanations, tone, formatting, and examples while remaining strictly grounded in the transcript.`
    : "";

  return `Below is a transcript excerpt from the video "${params.title}".

The excerpt covers ${params.timeRange} (seconds ${params.start.toFixed(0)} to ${params.end.toFixed(0)}).
All timestamps you cite MUST fall between ${params.start.toFixed(0)} and ${params.end.toFixed(0)} seconds, and must match a [mm:ss] marker present in the excerpt.

<transcript>
${params.transcript}
</transcript>

Write notes for this excerpt.

Produce ${minPoints} to ${maxPoints} key points, ordered as they appear. For each one:
- timestamp_sec: the second at which the idea begins.
- concept: a short label, at most 10 words.
- explanation: HOW this works. The mechanism, the step, the reason the lecturer gave.
- why_it_matters: what a student can do with this, or what breaks without it.
- analogy: one concrete, familiar mental model that makes the idea stick. Name a real, ordinary thing.

Also record any term the lecturer actually defined or relied on. If the excerpt introduces no new terms, return an empty list rather than inventing some.

Finally, take the clearest example in this excerpt and walk it through completely in worked_example, so a student could reproduce it. If there is no example worth walking through, return an empty string.${customBlock}`;
}

export function buildSynthesisPrompt(params: {
  title: string;
  duration: string;
  chunks: number;
  notes: string;
  customPrompt?: string;
}): string {
  const customBlock = params.customPrompt?.trim()
    ? `\n\nUSER NOTE PREFERENCES & SYNTAX RULES:\n${params.customPrompt.trim()}\nApply these preferences to the executive summary, takeaways, self-test questions, and formatting while adhering to factual accuracy.`
    : "";

  return `Below is the notes from every window of the video "${params.title}" (${params.duration}, ${params.chunks} sections). Each section carries its own time range.

<notes>
${params.notes}
</notes>

Write one study guide for the whole video.

executive_summary is the field that matters most. Write it for a student who completely missed the lecture: the through-line, how the ideas depend on each other, and the reasoning behind what the lecturer did. Do not walk the sections in order.

Then supply the extension material:
- prerequisites: background this lecture assumed without stating. Only what is genuinely needed to follow along.
- worked_examples: examples the lecturer did NOT give, demonstrating a core concept, concrete enough to work through alone.
- next_topics: where this lecture stops and what continues from it, with concrete search terms or a chapter name.

key_takeaways and self_test must contain only what the lecture actually covered. Do not put your own extension in either.${customBlock}`;
}
