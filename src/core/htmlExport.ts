/**
 * Standalone HTML study guide generator for Chrome Extension.
 *
 * Matches the Phase 0 publication-grade template with @media print rules,
 * page-break protection, and anti-clipping diagram scaling.
 */

import { ProcessedNotesPayload } from "./schemas";
import { formatTimestamp } from "./transcript";

function esc(text: unknown): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMarkdownInline(text: unknown): string {
  if (text === null || text === undefined) return "";
  let s = esc(text);
  // Code backticks `code`
  s = s.replace(/`([^`]+)`/g, '<code class="code-pill">$1</code>');
  // Bold **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic *italic*
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return s;
}

function formatWalkthrough(text: unknown): string {
  if (text === null || text === undefined) return "";
  const raw = String(text).trim();

  // Pattern to split numbered steps (e.g. "1. ", "2. ", "1. **Step**:")
  const parts = raw.split(/(?:^|\s+)(?=\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);

  if (parts.length > 1 && parts.some((p) => /^\d+\.\s+/.test(p))) {
    const items = parts
      .map((part) => {
        const match = part.match(/^(\d+)\.\s+([\s\S]*)$/);
        if (match) {
          const stepNum = match[1];
          const stepContent = formatMarkdownInline(match[2]);
          return `
            <li class="step-item">
              <span class="step-number">${stepNum}</span>
              <div class="step-content">${stepContent}</div>
            </li>`;
        }
        return `<li class="step-item"><div class="step-content">${formatMarkdownInline(part)}</div></li>`;
      })
      .join("");

    return `<ol class="step-list">${items}</ol>`;
  }

  if (raw.includes("\n")) {
    return raw
      .split(/\n+/)
      .map((l) => `<p style="margin: 6px 0;">${formatMarkdownInline(l.trim())}</p>`)
      .join("");
  }

  return `<p>${formatMarkdownInline(raw)}</p>`;
}

export function generateHtmlDocument(payload: ProcessedNotesPayload): string {
  const { video, guide, key_points, chunks, stats } = payload;
  const videoId = esc(video.id);
  const videoTitle = esc(guide?.title || video.title || "Study Notes");
  const videoUrl = `https://youtu.be/${videoId}`;
  const durationLabel = formatTimestamp(video.duration_sec);
  const oneLineSummary = esc(guide?.one_line_summary || "");

  const execParagraphs = guide?.executive_summary
    ? guide.executive_summary
        .split("\n\n")
        .map((p) => `<p>${esc(p.trim())}</p>`)
        .join("")
    : "";

  const prereqCards = (guide?.prerequisites || [])
    .map(
      (p) => `
      <div class="card">
        <div class="card-title">${esc(p.topic)}</div>
        <p>${esc(p.why_needed)}</p>
        <div class="card-meta"><em>${esc(p.brief)}</em></div>
      </div>`
    )
    .join("");

  const learningObjItems = (guide?.learning_objectives || [])
    .map((obj) => `<li>${esc(obj)}</li>`)
    .join("");

  const conceptCards = (guide?.core_concepts || [])
    .map((c) => {
      const diag = c.diagram?.trim()
        ? `<div class="diagram-container"><pre class="diagram">${esc(c.diagram.trim())}</pre></div>`
        : "";
      const ex = c.example ? `<br><strong>Example:</strong> ${esc(c.example)}` : "";
      return `
      <div class="card">
        <div class="card-title">${esc(c.term)}</div>
        <p>${esc(c.plain_explanation)}</p>
        <div class="card-meta">
          <strong>Why it matters:</strong> ${esc(c.why_it_matters)}
          ${ex}
        </div>
        ${diag}
      </div>`;
    })
    .join("");

  const workedExampleCards = (guide?.worked_examples || [])
    .map(
      (w) => `
      <div class="card">
        <div class="card-title">${esc(w.concept)}</div>
        <p><strong>Setup:</strong> ${formatMarkdownInline(w.setup)}</p>
        <div style="margin: 12px 0;">
          <strong style="color: #0f172a; font-size: 13.5px;">Walkthrough:</strong>
          ${formatWalkthrough(w.walkthrough)}
        </div>
        <div class="card-meta"><strong>Takeaway:</strong> ${formatMarkdownInline(w.takeaway)}</div>
      </div>`
    )
    .join("");

  const keyPointItems = key_points
    .map((kp) => {
      const analogy = kp.analogy
        ? `<div class="analogy-box"><span><strong>Analogy:</strong> ${esc(kp.analogy)}</span></div>`
        : "";
      const diag = kp.diagram?.trim()
        ? `<div class="diagram-container"><pre class="diagram">${esc(kp.diagram.trim())}</pre></div>`
        : "";
      const capturedSlide = kp.capturedSlideUrl
        ? `<div style="margin-top: 10px;">
             <div style="font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">📸 Lecture Slide Snapshot (${kp.timestamp_label})</div>
             <img src="${kp.capturedSlideUrl}" alt="Slide Snapshot" style="max-width: 100%; border-radius: 6px; border: 1px solid #cbd5e1; box-shadow: 0 1px 3px rgba(0,0,0,0.05);" />
           </div>`
        : "";
      const illustration = kp.illustrationUrl
        ? `<div style="margin-top: 10px;">
             <div style="font-size: 11px; font-weight: 700; color: #6d28d9; margin-bottom: 4px;">🎨 Concept Illustration</div>
             <img src="${kp.illustrationUrl}" alt="Analogy Illustration" style="max-width: 100%; border-radius: 6px; border: 1px solid #ddd6fe; box-shadow: 0 1px 3px rgba(0,0,0,0.05);" />
           </div>`
        : "";
      return `
      <div class="timeline-item">
        <div class="timeline-header">
          <a href="${videoUrl}?t=${kp.timestamp_sec}s" target="_blank" class="timestamp-pill">
            ${kp.timestamp_label}
          </a>
          <div class="point-title">${esc(kp.concept)}</div>
        </div>
        <div class="point-explanation">${esc(kp.explanation)}</div>
        <div class="point-why"><strong>Why it matters:</strong> ${esc(kp.why_it_matters)}</div>
        ${analogy}
        ${diag}
        ${capturedSlide}
        ${illustration}
      </div>`;
    })
    .join("");

  const takeawaysItems = (guide?.key_takeaways || []).map((t) => `<li>${esc(t)}</li>`).join("");

  const misconceptionsItems = (guide?.common_misconceptions || [])
    .map((m) => `<li>${esc(m)}</li>`)
    .join("");

  const selfTestCards = (guide?.self_test || [])
    .map((q, idx) => {
      const link =
        q.answer_at_sec > 0 && q.answer_at_label
          ? ` <a href="${videoUrl}?t=${q.answer_at_sec}s" target="_blank" class="timestamp-pill" style="font-size: 11px; padding: 1px 6px; margin-left: 6px;">${q.answer_at_label}</a>`
          : "";
      return `
      <div class="quiz-card">
        <div class="quiz-question">
          <span class="quiz-q-badge">Q${idx + 1}</span>
          <div>${esc(q.question)}</div>
        </div>
        <div class="quiz-answer" id="ans-${idx + 1}">
          <strong>Answer:</strong> ${esc(q.answer)}${link}
        </div>
      </div>`;
    })
    .join("");

  const nextTopicsCards = (guide?.next_topics || [])
    .map(
      (n) => `
      <div class="card">
        <div class="card-title">${esc(n.topic)}</div>
        <p>${esc(n.why_it_follows)}</p>
        <div class="card-meta"><strong>Where to look:</strong> <em>${esc(n.where_to_look)}</em></div>
      </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${videoTitle} — Study Guide</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      if (window.mermaid) {
        window.mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
      }
    });
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --color-bg: #f8fafc; --color-surface: #ffffff; --color-border: #e2e8f0;
      --color-text-main: #0f172a; --color-text-muted: #475569; --color-primary: #0284c7;
      --color-primary-hover: #0369a1; --color-diagram-bg: #0f172a; --color-diagram-text: #e2e8f0;
    }
    body { font-family: var(--font-sans); color: var(--color-text-main); background: var(--color-bg); line-height: 1.65; font-size: 15px; -webkit-font-smoothing: antialiased; }
    .toolbar { position: sticky; top: 0; z-index: 100; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px); border-bottom: 1px solid var(--color-border); padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .toolbar-title { font-size: 13px; font-weight: 600; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 450px; }
    .toolbar-actions { display: flex; align-items: center; gap: 10px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-main); }
    .btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
    .btn-primary:hover { background: var(--color-primary-hover); }
    .container { max-width: 860px; margin: 32px auto 80px auto; padding: 0 24px; }
    .document-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 48px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04); }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-grounded { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .badge-extension { background: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; }
    .notice-box { padding: 12px 16px; border-radius: 8px; font-size: 13px; margin: 16px 0 24px 0; background: #faf5ff; border: 1px solid #ddd6fe; color: #581c87; }
    header.doc-header { margin-bottom: 40px; border-bottom: 2px solid #f1f5f9; padding-bottom: 32px; }
    h1.doc-title { font-size: 28px; font-weight: 800; color: var(--color-text-main); line-height: 1.25; margin-bottom: 14px; }
    .one-line-summary { font-size: 16px; color: var(--color-text-muted); line-height: 1.5; border-left: 3px solid var(--color-primary); padding-left: 14px; margin-bottom: 20px; font-style: italic; }
    .meta-bar { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--color-text-muted); }
    .meta-link { color: var(--color-primary); text-decoration: none; font-weight: 600; }
    section.doc-section { margin: 40px 0; }
    .section-header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid var(--color-border); padding-bottom: 10px; margin-bottom: 20px; break-after: avoid; page-break-after: avoid; }
    h2.section-title { font-size: 20px; font-weight: 700; color: var(--color-text-main); }
    .section-body p { margin-bottom: 14px; color: #334155; }
    .diagram-container { margin: 18px 0; break-inside: avoid; page-break-inside: avoid; }
    pre.diagram { font-family: var(--font-mono); background: var(--color-diagram-bg); color: var(--color-diagram-text); padding: 18px 22px; border-radius: 8px; font-size: 13px; line-height: 1.35; overflow-x: auto; white-space: pre; border: 1px solid #1e293b; }
    .card-list, .timeline { display: flex; flex-direction: column; gap: 20px; }
    .card { background: #fff; border: 1px solid var(--color-border); border-radius: 8px; padding: 20px; break-inside: avoid; page-break-inside: avoid; }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
    .card-meta { font-size: 13px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--color-border); color: var(--color-text-muted); }
    .timeline-item { background: #fff; border: 1px solid var(--color-border); border-left: 4px solid var(--color-primary); border-radius: 8px; padding: 18px 22px; break-inside: avoid; page-break-inside: avoid; }
    .timeline-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .timestamp-pill { font-family: var(--font-mono); font-size: 12px; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; text-decoration: none; }
    .point-title { font-size: 16px; font-weight: 700; }
    .point-explanation { font-size: 14.5px; color: #334155; margin-bottom: 10px; }
    .point-why { font-size: 13.5px; color: var(--color-text-muted); margin-bottom: 8px; }
    .analogy-box { background: #fdf4ff; border: 1px solid #f5d0fe; border-radius: 6px; padding: 8px 14px; font-size: 13.5px; color: #86198f; margin-bottom: 8px; }
    .bullet-list { list-style-type: none; display: flex; flex-direction: column; gap: 10px; }
    .bullet-list li { position: relative; padding-left: 24px; font-size: 14.5px; color: #334155; }
    .bullet-list li::before { content: "•"; position: absolute; left: 6px; color: var(--color-primary); font-weight: bold; font-size: 18px; line-height: 1; }
    .misconceptions-list li::before { content: "!"; color: #eab308; font-weight: bold; font-size: 14px; }
    .quiz-card { background: #fff; border: 1px solid var(--color-border); border-radius: 8px; padding: 18px 20px; break-inside: avoid; page-break-inside: avoid; }
    .quiz-question { font-size: 15px; font-weight: 600; margin-bottom: 12px; display: flex; gap: 10px; }
    .quiz-q-badge { background: #f1f5f9; color: #475569; font-family: var(--font-mono); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 12px; height: fit-content; }
    .quiz-answer { background: #f8fafc; border-left: 3px solid #10b981; padding: 10px 14px; border-radius: 0 6px 6px 0; font-size: 14px; color: #1e293b; margin-top: 8px; }
    .quiz-answer.hidden-on-screen { display: none; }
    .step-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
    .step-item { display: flex; align-items: flex-start; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 12px; font-size: 13.5px; }
    .step-number { background: #0284c7; color: #fff; font-family: var(--font-mono); font-size: 11px; font-weight: 700; min-width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
    .step-content { flex: 1; color: #334155; line-height: 1.5; }
    code.code-pill { font-family: var(--font-mono); font-size: 12px; background: #f1f5f9; color: #0f172a; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1; word-break: break-word; font-weight: 500; }
    @media print {
      @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
      body { background: #fff !important; color: #000 !important; font-size: 9.5pt !important; line-height: 1.45 !important; }
      .no-print { display: none !important; }
      .container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
      .document-card { border: none !important; padding: 0 !important; box-shadow: none !important; }
      h1.doc-title { font-size: 18pt !important; margin-bottom: 6pt !important; }
      h2.section-title { font-size: 12pt !important; }
      section.doc-section { margin-top: 16pt !important; margin-bottom: 16pt !important; }
      .card, .timeline-item, .quiz-card, .diagram-container { break-inside: avoid !important; page-break-inside: avoid !important; margin-bottom: 10pt !important; }
      .section-header { break-after: avoid !important; page-break-after: avoid !important; }
      pre.diagram { background: #f8fafc !important; color: #0f172a !important; border: 1px solid #cbd5e1 !important; font-size: 7.2pt !important; line-height: 1.25 !important; padding: 8pt 10pt !important; }
      .quiz-answer { display: block !important; background: #f1f5f9 !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div class="toolbar-title">${videoTitle}</div>
    <div class="toolbar-actions">
      <button class="btn" id="btnToggleExt" onclick="toggleExtensions()"><span>Toggle AI Extensions</span></button>
      <button class="btn" id="btnToggleQuiz" onclick="toggleQuiz()"><span>Toggle Answers</span></button>
      <button class="btn btn-primary" onclick="window.print()"><span>Print to PDF</span></button>
    </div>
  </div>

  <div class="container">
    <div class="document-card">
      <header class="doc-header">
        <h1 class="doc-title">${videoTitle}</h1>
        ${oneLineSummary ? `<div class="one-line-summary">"${oneLineSummary}"</div>` : ""}
        <div class="meta-bar">
          <div>Video: <a href="${videoUrl}" target="_blank" class="meta-link">${videoId}</a></div>
          <div>Duration: <strong>${durationLabel}</strong></div>
          <div>Sections: <strong>${chunks.length || stats.sections}</strong></div>
          <div>Key points: <strong>${key_points.length || stats.key_points}</strong></div>
        </div>
      </header>

      ${
        execParagraphs
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">What this lecture covers</h2>
                <span class="badge badge-grounded">From Lecture</span>
              </div>
              <div class="section-body">${execParagraphs}</div>
            </section>`
          : ""
      }

      ${
        guide?.architecture_diagram_mermaid?.trim()
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">The Big Picture</h2>
                <span class="badge badge-grounded">Vector Architecture</span>
              </div>
              <div class="diagram-container">
                <div class="mermaid">${guide.architecture_diagram_mermaid.trim()}</div>
              </div>
            </section>`
          : guide?.architecture_diagram?.trim()
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">The Big Picture</h2>
                <span class="badge badge-grounded">Architecture</span>
              </div>
              <div class="diagram-container">
                <pre class="diagram">${esc(guide.architecture_diagram.trim())}</pre>
              </div>
            </section>`
          : ""
      }

      ${
        prereqCards
          ? `<section class="doc-section extension-section">
              <div class="section-header">
                <h2 class="section-title">Before You Start</h2>
                <span class="badge badge-extension">AI Extension</span>
              </div>
              <div class="notice-box">
                <strong>Self-Study Context:</strong> These prerequisites were assumed by the lecturer and supplied by AI.
              </div>
              <div class="card-list">${prereqCards}</div>
            </section>`
          : ""
      }

      ${
        learningObjItems
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">What you'll be able to do afterwards</h2>
                <span class="badge badge-grounded">Objectives</span>
              </div>
              <ul class="bullet-list">${learningObjItems}</ul>
            </section>`
          : ""
      }

      ${
        conceptCards
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">Core Concepts</h2>
                <span class="badge badge-grounded">Glossary</span>
              </div>
              <div class="card-list">${conceptCards}</div>
            </section>`
          : ""
      }

      ${
        workedExampleCards
          ? `<section class="doc-section extension-section">
              <div class="section-header">
                <h2 class="section-title">Worked Examples</h2>
                <span class="badge badge-extension">AI Extension</span>
              </div>
              <div class="notice-box">
                <strong>Reinforcement Examples:</strong> Concrete walkthroughs generated by AI to demonstrate practical application.
              </div>
              <div class="card-list">${workedExampleCards}</div>
            </section>`
          : ""
      }

      <section class="doc-section">
        <div class="section-header">
          <h2 class="section-title">Key Points, in order</h2>
          <span class="badge badge-grounded">Timeline</span>
        </div>
        <div class="timeline">${keyPointItems}</div>
      </section>

      ${
        takeawaysItems
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">Key Takeaways</h2>
                <span class="badge badge-grounded">Summary</span>
              </div>
              <ul class="bullet-list">${takeawaysItems}</ul>
            </section>`
          : ""
      }

      ${
        misconceptionsItems
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">Common Misconceptions</h2>
                <span class="badge badge-grounded">Pitfalls</span>
              </div>
              <ul class="bullet-list misconceptions-list">${misconceptionsItems}</ul>
            </section>`
          : ""
      }

      ${
        selfTestCards
          ? `<section class="doc-section">
              <div class="section-header">
                <h2 class="section-title">Self Test</h2>
                <span class="badge badge-grounded">Active Recall</span>
              </div>
              <div class="card-list">${selfTestCards}</div>
            </section>`
          : ""
      }

      ${
        nextTopicsCards
          ? `<section class="doc-section extension-section">
              <div class="section-header">
                <h2 class="section-title">Where to Go Next</h2>
                <span class="badge badge-extension">AI Extension</span>
              </div>
              <div class="card-list">${nextTopicsCards}</div>
            </section>`
          : ""
      }
    </div>
  </div>

  <script>
    let showExt = true;
    function toggleExtensions() {
      showExt = !showExt;
      document.querySelectorAll('.extension-section').forEach(el => el.style.display = showExt ? 'block' : 'none');
    }
    let showAns = true;
    function toggleQuiz() {
      showAns = !showAns;
      document.querySelectorAll('.quiz-answer').forEach(el => {
        if (showAns) el.classList.remove('hidden-on-screen');
        else el.classList.add('hidden-on-screen');
      });
    }
  </script>
</body>
</html>`;
}

export function generateMarkdown(payload: ProcessedNotesPayload): string {
  const { video, guide, key_points, chunks } = payload;
  const videoUrl = `https://youtu.be/${video.id}`;
  const lines: string[] = [
    `# ${guide?.title || video.title}`,
    "",
    guide?.one_line_summary ? `> ${guide.one_line_summary}\n` : "",
    `*Video: ${video.id} · ${formatTimestamp(video.duration_sec)} · ${chunks.length} sections · ${key_points.length} key points*`,
    "",
  ];

  if (guide) {
    lines.push("## What this lecture covers\n", guide.executive_summary, "");

    if (guide.architecture_diagram?.trim()) {
      lines.push("## The big picture\n", "```", guide.architecture_diagram.trim(), "```\n");
    }

    if (guide.prerequisites?.length) {
      lines.push("## Before you start\n", "> *Not covered in the video — added to help you understand it.*\n");
      for (const p of guide.prerequisites) {
        lines.push(`**${p.topic}**\n\n${p.why_needed}\n\n*${p.brief}*\n`);
      }
    }

    if (guide.learning_objectives?.length) {
      lines.push("## What you'll be able to do afterwards\n");
      for (const obj of guide.learning_objectives) {
        lines.push(`- ${obj}`);
      }
      lines.push("");
    }

    if (guide.core_concepts?.length) {
      lines.push("## Core concepts\n");
      for (const c of guide.core_concepts) {
        lines.push(`### ${c.term}\n\n${c.plain_explanation}\n\n*Why it matters:* ${c.why_it_matters}`);
        if (c.example) lines.push(`\n*Example:* ${c.example}`);
        if (c.diagram?.trim()) lines.push(`\n\`\`\`\n${c.diagram.trim()}\n\`\`\``);
        lines.push("");
      }
    }

    if (guide.worked_examples?.length) {
      lines.push("## Worked examples\n", "> *Not covered in the video — added to help you understand it.*\n");
      for (const w of guide.worked_examples) {
        let wt = w.walkthrough.trim();
        if (wt.includes(" 2. ") || wt.includes("\n2. ")) {
          wt = wt.replace(/\s+(?=\d+\.\s+)/g, "\n\n");
        }
        lines.push(`### ${w.concept}\n\n**Setup.** ${w.setup}\n\n**Walkthrough:**\n\n${wt}\n\n**Takeaway.** ${w.takeaway}\n`);
      }
    }
  }

  lines.push("## Key points, in order\n");
  for (const kp of key_points) {
    lines.push(`- **[${kp.timestamp_label}](${videoUrl}?t=${kp.timestamp_sec}s)** ${kp.concept}`);
    lines.push(`  - ${kp.explanation}`);
    lines.push(`  - *Why it matters:* ${kp.why_it_matters}`);
    if (kp.analogy) lines.push(`  - *Analogy:* ${kp.analogy}`);
    if (kp.diagram?.trim()) lines.push(`  - diagram:\n\`\`\`\n${kp.diagram.trim()}\n\`\`\``);
    lines.push("");
  }

  if (guide) {
    if (guide.key_takeaways?.length) {
      lines.push("## Key takeaways\n");
      for (const t of guide.key_takeaways) lines.push(`- ${t}`);
      lines.push("");
    }
    if (guide.common_misconceptions?.length) {
      lines.push("## Common misconceptions\n");
      for (const m of guide.common_misconceptions) lines.push(`- ${m}`);
      lines.push("");
    }
    if (guide.self_test?.length) {
      lines.push("## Self test\n");
      for (const q of guide.self_test) {
        lines.push(`**Q.** ${q.question}\n`);
        const link = q.answer_at_sec > 0 ? ` ([${q.answer_at_label}](${videoUrl}?t=${q.answer_at_sec}s))` : "";
        lines.push(`**A.** ${q.answer}${link}\n`);
      }
    }
    if (guide.next_topics?.length) {
      lines.push("## Where to go next\n", "> *Not covered in the video — added to help you understand it.*\n");
      for (const n of guide.next_topics) {
        lines.push(`**${n.topic}**\n\n${n.why_it_follows}\n\n*${n.where_to_look}*\n`);
      }
    }
  }

  return lines.join("\n");
}
