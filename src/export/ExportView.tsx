import React, { useEffect, useState } from "react";
import { Download, Eye, FileText, Printer, Check, Copy, HelpCircle } from "lucide-react";
import { ProcessedNotesPayload } from "../core/schemas";
import { formatTimestamp } from "../core/transcript";
import { generateHtmlDocument, generateMarkdown } from "../core/htmlExport";
import { MermaidViewer } from "../components/MermaidViewer";
import "./export.css";

function formatWalkthrough(text: unknown): React.ReactNode {
  if (!text) return null;
  const raw = String(text).trim();
  const parts = raw.split(/(?:^|\s+)(?=\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);

  if (parts.length > 1 && parts.some((p) => /^\d+\.\s+/.test(p))) {
    return (
      <ol className="step-list">
        {parts.map((part, idx) => {
          const match = part.match(/^(\d+)\.\s+([\s\S]*)$/);
          if (match) {
            return (
              <li key={idx} className="step-item">
                <span className="step-number">{match[1]}</span>
                <div className="step-content">{match[2]}</div>
              </li>
            );
          }
          return (
            <li key={idx} className="step-item">
              <div className="step-content">{part}</div>
            </li>
          );
        })}
      </ol>
    );
  }

  return <p>{raw}</p>;
}

export function ExportView() {
  const [notes, setNotes] = useState<ProcessedNotesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExtensions, setShowExtensions] = useState(true);
  const [showQuizAnswers, setShowQuizAnswers] = useState(true);
  const [copiedMd, setCopiedMd] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get("videoId");
    const autoPrint = urlParams.get("autoPrint") === "true";

    const loadNotes = async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const keys = ["pending_export_notes"];
          if (videoId) keys.push(`cached_notes_${videoId}`);

          chrome.storage.local.get(keys, (res) => {
            const data = (res.pending_export_notes || (videoId ? res[`cached_notes_${videoId}`] : null)) as ProcessedNotesPayload | null;
            if (data) {
              setNotes(data);
              if (autoPrint) {
                // Wait for Mermaid vector diagrams to render before opening print dialog
                setTimeout(() => {
                  window.print();
                }, 750);
              }
            }
            setLoading(false);
          });
        } else {
          // Dev preview fallback
          const raw = localStorage.getItem("notes_gen_pending_export");
          if (raw) setNotes(JSON.parse(raw) as ProcessedNotesPayload);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load export notes:", err);
        setLoading(false);
      }
    };

    loadNotes();
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadHtml = () => {
    if (!notes) return;
    const htmlString = generateHtmlDocument(notes);
    const blob = new Blob([htmlString], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (notes.guide?.title || notes.video.title || "study-guide")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 50);
    a.download = `${safeTitle}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdown = () => {
    if (!notes) return;
    const md = generateMarkdown(notes);
    navigator.clipboard.writeText(md).then(() => {
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2500);
    });
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#64748b" }}>
        <p style={{ fontSize: "15px", fontWeight: 500 }}>Loading study guide for printing...</p>
      </div>
    );
  }

  if (!notes) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
        <h2>No study guide found to print</h2>
        <p style={{ marginTop: "10px" }}>
          Please generate notes in the NotesGenerator sidepanel first, then click Print to PDF.
        </p>
      </div>
    );
  }

  const { video, guide, key_points, chunks, stats } = notes;
  const videoId = video.id;
  const videoTitle = guide?.title || video.title || "Study Guide";
  const videoUrl = `https://youtu.be/${videoId}`;
  const durationLabel = formatTimestamp(video.duration_sec);
  const oneLineSummary = guide?.one_line_summary || "";

  return (
    <div>
      {/* Top Sticky Toolbar (Hidden on Print) */}
      <nav className="toolbar no-print">
        <div className="toolbar-brand">
          <img
            src="/icons/icon32.png"
            alt="NotesGenerator"
            style={{ width: 24, height: 24, objectFit: "contain" }}
          />
          <span className="toolbar-brand-title">NotesGenerator</span>
          <span className="badge badge-author">by youssef</span>
        </div>

        <div className="toolbar-title" title={videoTitle}>
          {videoTitle}
        </div>

        <div className="toolbar-actions">
          <button
            className="btn"
            onClick={() => setShowExtensions(!showExtensions)}
            title="Toggle AI prerequisite and worked example sections"
          >
            <Eye size={14} />
            <span>{showExtensions ? "Hide AI Extensions" : "Show AI Extensions"}</span>
          </button>

          <button
            className="btn"
            onClick={() => setShowQuizAnswers(!showQuizAnswers)}
            title="Toggle active recall self-test answers"
          >
            <HelpCircle size={14} />
            <span>{showQuizAnswers ? "Hide Quiz Answers" : "Show Quiz Answers"}</span>
          </button>

          <button
            className="btn"
            onClick={handleCopyMarkdown}
            title="Copy full study guide as formatted Markdown"
          >
            {copiedMd ? <Check size={14} color="#059669" /> : <Copy size={14} />}
            <span>{copiedMd ? "Copied!" : "Copy Markdown"}</span>
          </button>

          <button
            className="btn"
            onClick={handleDownloadHtml}
            title="Download standalone HTML file for offline study"
          >
            <Download size={14} />
            <span>Download HTML</span>
          </button>

          <button
            className="btn btn-primary"
            onClick={handlePrint}
            title="Print to PDF or physical printer (Ctrl+P)"
          >
            <Printer size={14} />
            <span>Print to PDF</span>
          </button>
        </div>
      </nav>

      {/* Main Document Content */}
      <main className="container">
        <article className="document-card">
          <header className="doc-header">
            <h1 className="doc-title">{videoTitle}</h1>
            {oneLineSummary && <div className="one-line-summary">"{oneLineSummary}"</div>}
            <div className="meta-bar">
              <div>
                Video:{" "}
                <a href={videoUrl} target="_blank" rel="noreferrer" className="meta-link">
                  {videoId}
                </a>
              </div>
              <div>Duration: <strong>{durationLabel}</strong></div>
              <div>Sections: <strong>{chunks?.length || stats?.sections || 0}</strong></div>
              <div>Key points: <strong>{key_points?.length || stats?.key_points || 0}</strong></div>
            </div>
          </header>

          {/* Section: Executive Summary */}
          {guide?.executive_summary && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">What this lecture covers</h2>
                <span className="badge badge-grounded">From Lecture</span>
              </div>
              <div className="section-body">
                {guide.executive_summary.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}

          {/* Section: Architecture Diagram */}
          {guide?.architecture_diagram_mermaid && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">The Big Picture</h2>
                <span className="badge badge-grounded">Vector Architecture</span>
              </div>
              <div className="diagram-container">
                <MermaidViewer mermaidCode={guide.architecture_diagram_mermaid} />
              </div>
            </section>
          )}

          {/* Section: Learning Objectives */}
          {guide?.learning_objectives && guide.learning_objectives.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">What you'll be able to do afterwards</h2>
                <span className="badge badge-grounded">Objectives</span>
              </div>
              <ul className="bullet-list">
                {guide.learning_objectives.map((obj, i) => (
                  <li key={i}>{obj}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Section: Core Concepts */}
          {guide?.core_concepts && guide.core_concepts.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">Core Concepts</h2>
                <span className="badge badge-grounded">Glossary</span>
              </div>
              <div className="card-list">
                {guide.core_concepts.map((c, i) => (
                  <div key={i} className="card">
                    <div className="card-title">{c.term}</div>
                    <p>{c.plain_explanation}</p>
                    <div className="card-meta">
                      <strong>Why it matters:</strong> {c.why_it_matters}
                      {c.example && (
                        <>
                          <br />
                          <strong>Example:</strong> {c.example}
                        </>
                      )}
                    </div>
                    {c.diagram?.trim() && (
                      <div className="diagram-container">
                        <pre className="diagram">{c.diagram.trim()}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section: Worked Examples (Extension) */}
          {showExtensions && guide?.worked_examples && guide.worked_examples.length > 0 && (
            <section className="doc-section extension-section">
              <div className="section-header">
                <h2 className="section-title">Worked Examples</h2>
                <span className="badge badge-extension">AI Extension</span>
              </div>
              <div className="notice-box">
                <strong>Reinforcement Examples:</strong> Concrete walkthroughs generated by AI to demonstrate practical application.
              </div>
              <div className="card-list">
                {guide.worked_examples.map((w, i) => (
                  <div key={i} className="card">
                    <div className="card-title">{w.concept}</div>
                    <p style={{ marginBottom: "10px" }}>
                      <strong>Setup:</strong> {w.setup}
                    </p>
                    <div style={{ margin: "12px 0" }}>
                      <strong style={{ color: "#0f172a", fontSize: "13.5px" }}>Walkthrough:</strong>
                      {formatWalkthrough(w.walkthrough)}
                    </div>
                    <div className="card-meta">
                      <strong>Takeaway:</strong> {w.takeaway}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section: Key Points in order (Timeline) */}
          {key_points && key_points.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">Key Points, in order</h2>
                <span className="badge badge-grounded">Timeline</span>
              </div>
              <div className="timeline">
                {key_points.map((kp, i) => (
                  <div key={i} className="timeline-item">
                    <div className="timeline-header">
                      <a
                        href={`${videoUrl}&t=${kp.timestamp_sec}s`}
                        target="_blank"
                        rel="noreferrer"
                        className="timestamp-pill"
                      >
                        {kp.timestamp_label}
                      </a>
                      <span className="point-title">{kp.concept}</span>
                    </div>
                    <div className="point-explanation">{kp.explanation}</div>
                    <div className="point-why">
                      <strong>Why it matters:</strong> {kp.why_it_matters}
                    </div>
                    {kp.analogy && (
                      <div className="analogy-box">
                        <strong>Analogy:</strong> {kp.analogy}
                      </div>
                    )}
                    {kp.diagram?.trim() && (
                      <div className="diagram-container">
                        <pre className="diagram">{kp.diagram.trim()}</pre>
                      </div>
                    )}
                    {kp.capturedSlideUrl && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                          📸 Lecture Slide Snapshot ({kp.timestamp_label})
                        </div>
                        <img
                          src={kp.capturedSlideUrl}
                          alt="Slide Snapshot"
                          style={{
                            maxWidth: "100%",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                          }}
                        />
                      </div>
                    )}
                    {kp.illustrationUrl && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#6d28d9", marginBottom: "4px" }}>
                          🎨 Concept Illustration
                        </div>
                        <img
                          src={kp.illustrationUrl}
                          alt="Concept Illustration"
                          style={{
                            maxWidth: "100%",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section: Takeaways */}
          {guide?.key_takeaways && guide.key_takeaways.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">Key Takeaways</h2>
                <span className="badge badge-grounded">Summary</span>
              </div>
              <ul className="bullet-list">
                {guide.key_takeaways.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Section: Common Misconceptions */}
          {guide?.common_misconceptions && guide.common_misconceptions.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">Common Misconceptions</h2>
                <span className="badge badge-grounded">Corrections</span>
              </div>
              <ul className="bullet-list misconceptions-list">
                {guide.common_misconceptions.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Section: Self Test (Active Recall) */}
          {guide?.self_test && guide.self_test.length > 0 && (
            <section className="doc-section">
              <div className="section-header">
                <h2 className="section-title">Self Test</h2>
                <span className="badge badge-grounded">Active Recall</span>
              </div>
              <div className="card-list">
                {guide.self_test.map((q, i) => (
                  <div key={i} className="quiz-card">
                    <div className="quiz-question">
                      <span className="quiz-q-badge">Q{i + 1}</span>
                      <span>{q.question}</span>
                    </div>
                    <div className={`quiz-answer ${showQuizAnswers ? "" : "hidden-on-screen"}`}>
                      <strong>Answer:</strong> {q.answer}
                      {q.answer_at_sec > 0 && (
                        <span style={{ marginLeft: "6px" }}>
                          (<a href={`${videoUrl}&t=${q.answer_at_sec}s`} target="_blank" rel="noreferrer" className="meta-link">
                            {q.answer_at_label}
                          </a>)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section: Where to Go Next (Extension) */}
          {showExtensions && guide?.next_topics && guide.next_topics.length > 0 && (
            <section className="doc-section extension-section">
              <div className="section-header">
                <h2 className="section-title">Where to Go Next</h2>
                <span className="badge badge-extension">AI Extension</span>
              </div>
              <div className="card-list">
                {guide.next_topics.map((n, i) => (
                  <div key={i} className="card">
                    <div className="card-title">{n.topic}</div>
                    <p>{n.why_it_follows}</p>
                    <div className="card-meta">
                      <strong>Where to look:</strong> <em>{n.where_to_look}</em>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
    </div>
  );
}
