/**
 * Transcript processing, cleaning, and time-window chunking.
 *
 * Direct TypeScript port of Phase 0 `transcript.py`.
 */

export interface Segment {
  start: number;
  duration: number;
  text: string;
}

export interface Chunk {
  index: number;
  start: number;
  end: number;
  segments: Segment[];
  timeRange: string;
  wordCount: number;
  render: () => string;
}

const FILLER_WORDS = new Set([
  "yeah", "yes", "no", "okay", "ok", "uh", "um", "mm", "hmm", "right", "so", "well", "like"
]);

const REPEAT_REGEX = /\b(\w+)(\s+\1\b)+/gi;
const UNIFORM_GAP_EPSILON = 0.25;

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const remainder = total % 3600;
  const minutes = Math.floor(remainder / 60);
  const secs = remainder % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function parseVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/(?:embed|shorts|live|v)\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) {
    return url;
  }
  return null;
}

export function stripLeadingFillers(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < words.length - 1) {
    const cleanWord = words[start].replace(/[,.;:!?]/g, "").toLowerCase();
    if (FILLER_WORDS.has(cleanWord)) {
      start++;
    } else {
      break;
    }
  }
  return words.slice(start).join(" ");
}

export function cleanText(text: string): string {
  if (!text) return "";
  // Unescape basic HTML entities
  let clean = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, " ")
    .replace(/\[Music\]/gi, "")
    .replace(/\[Applause\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Collapse stutters (e.g. "we we" -> "we")
  clean = clean.replace(REPEAT_REGEX, "$1");
  clean = stripLeadingFillers(clean);
  // Fix punctuation spacing
  clean = clean.replace(/\s+([,.!?;:])/g, "$1");
  return clean.trim();
}

export function createChunk(index: number, start: number, end: number, segments: Segment[]): Chunk {
  const timeRange = `${formatTimestamp(start)} - ${formatTimestamp(end)}`;
  const wordCount = segments.reduce((sum, s) => sum + s.text.split(/\s+/).filter(Boolean).length, 0);

  return {
    index,
    start,
    end,
    segments,
    timeRange,
    wordCount,
    render: () => segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join("\n"),
  };
}

export function splitChunk(chunk: Chunk): Chunk[] {
  const segments = chunk.segments;
  if (segments.length < 2) {
    return [chunk];
  }

  // Find largest gap between consecutive captions
  let bestGap = -1;
  let splitAt = 0;

  for (let i = 0; i < segments.length - 1; i++) {
    const nextStart = segments[i + 1].start;
    const currentEnd = segments[i].start + segments[i].duration;
    const gap = nextStart - currentEnd;
    if (gap > bestGap) {
      bestGap = gap;
      splitAt = i;
    }
  }

  if (bestGap <= UNIFORM_GAP_EPSILON) {
    splitAt = Math.floor(segments.length / 2) - 1;
  }

  const firstPart = segments.slice(0, splitAt + 1);
  const secondPart = segments.slice(splitAt + 1);

  if (firstPart.length === 0 || secondPart.length === 0) {
    return [chunk];
  }

  const chunk1 = createChunk(
    0,
    firstPart[0].start,
    firstPart[firstPart.length - 1].start + firstPart[firstPart.length - 1].duration,
    firstPart
  );
  const chunk2 = createChunk(
    1,
    secondPart[0].start,
    secondPart[secondPart.length - 1].start + secondPart[secondPart.length - 1].duration,
    secondPart
  );

  return [chunk1, chunk2];
}

export function chunkSegments(
  segments: Segment[],
  windowSeconds = 300,
  minSegments = 6
): Chunk[] {
  if (segments.length === 0) return [];

  const rawWindows: Segment[][] = [];
  let current: Segment[] = [];
  let windowStart = segments[0].start;

  for (const seg of segments) {
    if (current.length > 0 && seg.start - windowStart >= windowSeconds) {
      rawWindows.push(current);
      current = [];
      windowStart = seg.start;
    }
    current.push(seg);
  }

  if (current.length > 0) {
    rawWindows.push(current);
  }

  // Merge trailing thin window
  if (rawWindows.length > 1 && rawWindows[rawWindows.length - 1].length < minSegments) {
    const tail = rawWindows.pop()!;
    rawWindows[rawWindows.length - 1].push(...tail);
  }

  const chunks: Chunk[] = [];
  for (let i = 0; i < rawWindows.length; i++) {
    const win = rawWindows[i];
    const start = win[0].start;
    const end = win[win.length - 1].start + win[win.length - 1].duration;

    if (chunks.length > 0 && start - chunks[chunks.length - 1].start < 1.0) {
      continue;
    }

    chunks.push(createChunk(chunks.length, start, end, win));
  }

  return chunks;
}
