import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { Check, Code2, Copy, Eye } from "lucide-react";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "inherit",
});

interface MermaidViewerProps {
  mermaidCode?: string;
  asciiDiagram?: string;
}

export const MermaidViewer: React.FC<MermaidViewerProps> = ({
  mermaidCode,
  asciiDiagram,
}) => {
  const [viewMode, setViewMode] = useState<"visual" | "ascii">(
    mermaidCode && mermaidCode.trim() ? "visual" : "ascii"
  );
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert simple bracket ASCII like "[Teacher] --> [Student]" to valid Mermaid if mermaidCode isn't provided
  const effectiveMermaid = React.useMemo(() => {
    if (mermaidCode && mermaidCode.trim()) {
      return mermaidCode.trim();
    }
    if (!asciiDiagram || !asciiDiagram.includes("-->")) {
      return null;
    }
    // Simple heuristic parser for bracket diagrams
    try {
      const lines = asciiDiagram.split("\n");
      const mermaidLines = ["graph TD"];
      let count = 0;
      for (const line of lines) {
        const matches = line.match(/\[([^\]]+)\]\s*(?:-->|->)\s*\[([^\]]+)\]/);
        if (matches) {
          count++;
          const from = matches[1].trim().replace(/[^a-zA-Z0-9]/g, "_");
          const to = matches[2].trim().replace(/[^a-zA-Z0-9]/g, "_");
          mermaidLines.push(`  ${from}["${matches[1].trim()}"] --> ${to}["${matches[2].trim()}"]`);
        }
      }
      return count > 0 ? mermaidLines.join("\n") : null;
    } catch {
      return null;
    }
  }, [mermaidCode, asciiDiagram]);

  useEffect(() => {
    if (!effectiveMermaid) {
      setViewMode("ascii");
      return;
    }

    let isMounted = true;
    const renderDiagram = async () => {
      try {
        const id = `mermaid_${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(id, effectiveMermaid);
        if (isMounted) {
          setSvgHtml(svg);
          setRenderError(false);
        }
      } catch (err) {
        console.warn("Mermaid rendering failed, falling back to ASCII:", err);
        if (isMounted) {
          setRenderError(true);
          setViewMode("ascii");
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [effectiveMermaid]);

  const handleCopy = () => {
    const text = viewMode === "visual" && effectiveMermaid ? effectiveMermaid : asciiDiagram || "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const hasBoth = Boolean(effectiveMermaid && !renderError && asciiDiagram?.trim());

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        overflow: "hidden",
        background: viewMode === "visual" ? "#ffffff" : "#0f172a",
        marginTop: "10px",
      }}
    >
      {/* Viewer Header Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: viewMode === "visual" ? "#f8fafc" : "#1e293b",
          borderBottom: "1px solid",
          borderColor: viewMode === "visual" ? "#e2e8f0" : "#334155",
          fontSize: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "6px" }}>
          {hasBoth && (
            <>
              <button
                onClick={() => setViewMode("visual")}
                style={{
                  background: viewMode === "visual" ? "#0284c7" : "transparent",
                  color: viewMode === "visual" ? "#ffffff" : "#64748b",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Eye size={12} />
                <span>Vector Flowchart</span>
              </button>
              <button
                onClick={() => setViewMode("ascii")}
                style={{
                  background: viewMode === "ascii" ? "#0284c7" : "transparent",
                  color: viewMode === "ascii" ? "#ffffff" : "#64748b",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Code2 size={12} />
                <span>ASCII Art</span>
              </button>
            </>
          )}
          {!hasBoth && (
            <span style={{ color: viewMode === "visual" ? "#64748b" : "#94a3b8", fontWeight: 600 }}>
              {viewMode === "visual" ? "Architecture Diagram" : "ASCII Diagram"}
            </span>
          )}
        </div>

        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: viewMode === "visual" ? "#64748b" : "#94a3b8",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
          }}
          title="Copy Diagram"
        >
          {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {/* Content Display */}
      {viewMode === "visual" && svgHtml ? (
        <div
          ref={containerRef}
          style={{
            padding: "16px",
            overflowX: "auto",
            display: "flex",
            justifyContent: "center",
          }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      ) : (
        <pre
          style={{
            fontFamily:
              '"JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            padding: "12px 16px",
            fontSize: "11.5px",
            lineHeight: 1.35,
            color: "#e2e8f0",
            overflowX: "auto",
            whiteSpace: "pre",
            margin: 0,
          }}
        >
          {asciiDiagram?.trim() || "No diagram available."}
        </pre>
      )}
    </div>
  );
};
