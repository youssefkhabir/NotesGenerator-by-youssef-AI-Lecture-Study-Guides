/**
 * Two-stage note generation pipeline for Chrome Extension.
 *
 * Stage 1: Windowed extraction (strictly grounded in transcript).
 * Stage 2: Whole-lecture synthesis (produces study guide, big picture diagram, and extensions).
 */

import {
  buildChunkPrompt,
  buildSynthesisPrompt,
  CHUNK_NOTES_JSON_SCHEMA,
  ChunkNotes,
  GROUNDED_SYSTEM,
  ProcessedNotesPayload,
  STUDY_GUIDE_JSON_SCHEMA,
  StudyGuide,
  SYNTHETIC_SYSTEM,
  VideoMetadata,
} from "./schemas";
import { Chunk, chunkSegments, formatTimestamp, Segment, splitChunk } from "./transcript";
import { LLMClient, TruncationError } from "./gemini";

export interface PipelineProgress {
  stage: "chunks" | "synthesis" | "done" | "error";
  currentWindow?: number;
  totalWindows?: number;
  message: string;
}

const SYNTHESIS_OUTPUT_TOKENS = 12288;

function clamp(chunkNotes: ChunkNotes, chunk: Chunk): ChunkNotes {
  chunkNotes.chunk_index = chunk.index;
  chunkNotes.time_range = chunk.timeRange;
  chunkNotes.start_sec = Math.floor(chunk.start);
  chunkNotes.end_sec = Math.floor(Math.max(chunk.end, chunk.start + 1));

  const low = chunkNotes.start_sec;
  const high = chunkNotes.end_sec;

  for (const point of chunkNotes.key_points) {
    point.timestamp_sec = Math.min(Math.max(point.timestamp_sec, low), high);
  }
  return chunkNotes;
}

async function noteWindow(
  client: LLMClient,
  video: VideoMetadata,
  chunk: Chunk,
  maxPoints: number,
  customPrompt?: string
): Promise<ChunkNotes[]> {
  const prompt = buildChunkPrompt({
    title: video.title,
    timeRange: chunk.timeRange,
    start: chunk.start,
    end: chunk.end,
    transcript: chunk.render(),
    maxPoints,
    customPrompt,
  });

  try {
    const rawNotes = await client.structured<ChunkNotes>({
      prompt,
      schema: CHUNK_NOTES_JSON_SCHEMA,
      systemInstruction: GROUNDED_SYSTEM,
    });
    return [clamp(rawNotes, chunk)];
  } catch (err) {
    if (err instanceof TruncationError) {
      const halves = splitChunk(chunk);
      if (halves.length < 2) {
        throw err;
      }
      console.warn(`[Pipeline] Window ${chunk.timeRange} too dense. Splitting into 2 halves...`);
      const notes: ChunkNotes[] = [];
      for (const half of halves) {
        const subNotes = await noteWindow(client, video, half, maxPoints, customPrompt);
        notes.push(...subNotes);
      }
      return notes;
    }
    throw err;
  }
}

function buildSynthesisInput(chunkNotes: ChunkNotes[]): string {
  const blocks: string[] = [];
  for (const notes of chunkNotes) {
    const lines = [`### ${notes.time_range}`, notes.summary];
    for (const point of notes.key_points) {
      const stamp = formatTimestamp(point.timestamp_sec);
      lines.push(`- [${stamp}] ${point.concept}: ${point.explanation}`);
      if (point.analogy) {
        lines.push(`  - analogy: ${point.analogy}`);
      }
      if (point.diagram && point.diagram.trim()) {
        lines.push(`  - diagram:\n    ${point.diagram.replace(/\n/g, "\n    ")}`);
      }
    }
    for (const def of notes.definitions) {
      lines.push(`  - term: ${def.term} (${def.plain_explanation})`);
    }
    if (notes.worked_example) {
      lines.push(`  - worked example: ${notes.worked_example}`);
    }
    for (const ex of notes.examples) {
      lines.push(`  - example given: ${ex}`);
    }
    if (notes.open_questions && notes.open_questions.length > 0) {
      lines.push(`  - unresolved: ${notes.open_questions.join("; ")}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export async function runPipeline(params: {
  video: VideoMetadata;
  segments: Segment[];
  gemini: LLMClient;
  windowSeconds?: number;
  maxPoints?: number;
  customPrompt?: string;
  onProgress?: (progress: PipelineProgress) => void;
}): Promise<ProcessedNotesPayload> {
  const { video, segments, gemini, windowSeconds = 300, maxPoints = 6, customPrompt, onProgress } = params;

  if (segments.length === 0) {
    throw new Error("Cannot run pipeline on empty transcript.");
  }

  const chunks = chunkSegments(segments, windowSeconds);
  if (chunks.length === 0) {
    throw new Error("Transcript was empty after chunking.");
  }

  onProgress?.({
    stage: "chunks",
    currentWindow: 0,
    totalWindows: chunks.length,
    message: `Analyzing lecture in ${chunks.length} sections (${Math.round(windowSeconds / 60)}m windows)...`,
  });

  const chunkNotesResults: ChunkNotes[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    onProgress?.({
      stage: "chunks",
      currentWindow: i + 1,
      totalWindows: chunks.length,
      message: `Extracting key points from section ${i + 1}/${chunks.length} (${chunk.timeRange})...`,
    });

    const notes = await noteWindow(gemini, video, chunk, maxPoints, customPrompt);
    chunkNotesResults.push(...notes);
  }

  // Sort and re-index in case of window splits
  chunkNotesResults.sort((a, b) => a.start_sec - b.start_sec);
  chunkNotesResults.forEach((n, idx) => (n.chunk_index = idx));

  // Stage 2: Synthesis
  onProgress?.({
    stage: "synthesis",
    message: "Synthesizing full study guide, architecture diagram, and self-test...",
  });

  const synthesisPrompt = buildSynthesisPrompt({
    title: video.title,
    duration: video.duration_label,
    chunks: chunkNotesResults.length,
    notes: buildSynthesisInput(chunkNotesResults),
    customPrompt,
  });

  const guide = await gemini.structured<StudyGuide>({
    prompt: synthesisPrompt,
    schema: STUDY_GUIDE_JSON_SCHEMA,
    systemInstruction: SYNTHETIC_SYSTEM,
    maxOutputTokens: SYNTHESIS_OUTPUT_TOKENS,
  });

  // Assemble full ProcessedNotesPayload matching Phase 0 render contract
  const allKeyPoints = chunkNotesResults.flatMap((c) => c.key_points);

  let diagramCount = 0;
  if (guide.architecture_diagram?.trim()) diagramCount++;
  guide.core_concepts?.forEach((c) => {
    if (c.diagram?.trim()) diagramCount++;
  });
  allKeyPoints.forEach((kp) => {
    if (kp.diagram?.trim()) diagramCount++;
  });

  const payload: ProcessedNotesPayload = {
    video: {
      id: video.video_id,
      title: video.title,
      duration_sec: video.duration_sec,
    },
    schema_version: 3,
    extension_notice: "Not covered in the video — added to help you understand it.",
    diagram_display: {
      format: "plain_text",
      font: "monospace",
      preserve_whitespace: true,
      max_columns: 76,
      max_lines: 24,
    },
    key_points: allKeyPoints.map((kp) => ({
      ...kp,
      timestamp_label: formatTimestamp(kp.timestamp_sec),
      has_diagram: Boolean(kp.diagram && kp.diagram.trim()),
    })),
    chunks: chunkNotesResults,
    guide: {
      ...guide,
      self_test: guide.self_test?.map((q) => ({
        ...q,
        answer_at_label: q.answer_at_sec > 0 ? formatTimestamp(q.answer_at_sec) : null,
      })),
    },
    stats: {
      sections: chunks.length,
      key_points: allKeyPoints.length,
      diagrams: diagramCount,
    },
    section_grounds: {
      title: "from_video",
      one_line_summary: "from_video",
      executive_summary: "from_video",
      architecture_diagram: "from_video",
      learning_objectives: "from_video",
      core_concepts: "from_video",
      key_points: "from_video",
      key_takeaways: "from_video",
      common_misconceptions: "from_video",
      self_test: "from_video",
      prerequisites: "extension",
      worked_examples: "extension",
      next_topics: "extension",
    },
  };

  onProgress?.({
    stage: "done",
    message: "Study guide generated successfully!",
  });

  return payload;
}
