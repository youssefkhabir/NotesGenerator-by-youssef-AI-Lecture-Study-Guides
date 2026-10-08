import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  List,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Video,
  Zap,
} from "lucide-react";

import { ProcessedNotesPayload, VideoMetadata } from "../core/schemas";
import { formatTimestamp, Segment } from "../core/transcript";
import { GeminiClient } from "../core/gemini";
import { OpenRouterClient } from "../core/openrouter";
import { PipelineProgress, runPipeline } from "../core/pipeline";
import {
  CachedNoteSummary,
  deleteCachedNote,
  ExtensionSettings,
  getCachedNotes,
  getSettings,
  listCachedNotes,
  LLMProvider,
  saveCachedNotes,
  saveSettings,
} from "../core/storage";
import { generateHtmlDocument, generateMarkdown } from "../core/htmlExport";
import { MermaidViewer } from "../components/MermaidViewer";
import { generateAnalogyIllustration } from "../core/imagen";
import {
  ensureContentScriptInjected,
  getTranscriptWithFallback,
  getVideoInfoWithFallback,
} from "../core/tabTranscript";

export function App() {
  const [settings, setSettings] = useState<ExtensionSettings>({
    apiKey: "",
    model: "gemini-2.5-flash",
    windowSeconds: 300,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<CachedNoteSummary[]>([]);

  const [providerInput, setProviderInput] = useState<LLMProvider>("gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [openRouterKeyInput, setOpenRouterKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("gemini-2.5-flash");
  const [openRouterModelInput, setOpenRouterModelInput] = useState("google/gemma-4-26b-a4b-it:free");
  const [autoCaptureInput, setAutoCaptureInput] = useState(true);

  const [videoInfo, setVideoInfo] = useState<{
    videoId: string;
    title: string;
    durationSec: number;
    author?: string;
    hasCaptions?: boolean;
  } | null>(null);

  const [notes, setNotes] = useState<ProcessedNotesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stitch Design States
  const [selectedFormat, setSelectedFormat] = useState<
    "study_guide" | "summary" | "flashcards" | "quiz" | "custom"
  >("study_guide");
  const [notesSubTab, setNotesSubTab] = useState<"preview" | "diagrams" | "timeline">("preview");

  const [customPromptOpen, setCustomPromptOpen] = useState(false);
  const [customPromptInput, setCustomPromptInput] = useState("");

  const PROMPT_PRESETS = [
    { label: "💻 Code & Dev", text: "Focus heavily on implementation details, code syntax, and real CLI/API commands." },
    { label: "🧒 Simple ELI5", text: "Explain all technical concepts in simple, everyday language using intuitive analogies." },
    { label: "📐 Math Rigor", text: "Include formal mathematical derivations, definitions, formulas, and proofs." },
    { label: "📝 Cornell Notes", text: "Format notes with high-yield cue questions and concise revision summary bullets." },
    { label: "🇫🇷 French", text: "Write all notes, summaries, and self-test questions entirely in French." },
    { label: "🇪🇸 Spanish", text: "Write all notes, summaries, and self-test questions entirely in Spanish." },
    { label: "🇸🇦 Arabic", text: "Write all notes, summaries, and self-test questions entirely in Arabic." },
  ];

  const [revealedQuiz, setRevealedQuiz] = useState<Set<number>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [capturingSlideIndex, setCapturingSlideIndex] = useState<number | null>(null);
  const [illustratingIndex, setIllustratingIndex] = useState<number | null>(null);

  const isQuotaError = Boolean(
    error &&
      (error.includes("429") ||
        error.toLowerCase().includes("quota") ||
        error.toLowerCase().includes("resource_exhausted") ||
        error.toLowerCase().includes("rate limit") ||
        error.toLowerCase().includes("limit exceeded"))
  );

  // Initialize Settings
  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setProviderInput(s.provider || "gemini");
      setApiKeyInput(s.apiKey);
      setOpenRouterKeyInput(s.openRouterApiKey || "");
      setModelInput(s.model);
      setOpenRouterModelInput(s.openRouterModel || "google/gemma-4-26b-a4b-it:free");
      setCustomPromptInput(s.customPrompt || "");
      setAutoCaptureInput(s.autoCaptureSlides !== false);
    });
  }, []);

  // Parse YouTube video ID from URL string
  const parseYouTubeUrl = (urlStr?: string): { videoId: string; isWatch: boolean } | null => {
    if (!urlStr) return null;
    try {
      const url = new URL(urlStr);
      if (url.hostname.includes("youtube.com")) {
        const v = url.searchParams.get("v");
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
          return { videoId: v, isWatch: true };
        }
        const match = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
        if (match) return { videoId: match[1], isWatch: true };
      } else if (url.hostname === "youtu.be") {
        const id = url.pathname.slice(1).split("?")[0];
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
          return { videoId: id, isWatch: true };
        }
      }
    } catch {
      // invalid URL
    }
    return null;
  };

  // Find active YouTube tab across windows
  const getActiveYouTubeTab = async (): Promise<chrome.tabs.Tab | null> => {
    if (typeof chrome === "undefined" || !chrome.tabs) return null;

    try {
      // 1. Try active tab in current window
      const curTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (curTabs.length > 0 && curTabs[0].url && parseYouTubeUrl(curTabs[0].url)) {
        return curTabs[0];
      }

      // 2. Try last focused window (especially when Side Panel is focused)
      const lastTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (lastTabs.length > 0 && lastTabs[0].url && parseYouTubeUrl(lastTabs[0].url)) {
        return lastTabs[0];
      }

      // 3. Any active tab on YouTube
      const allActive = await chrome.tabs.query({ active: true });
      const ytActive = allActive.find((t) => t.url && parseYouTubeUrl(t.url));
      if (ytActive) return ytActive;

      // 4. Any tab on YouTube in the current window
      const winTabs = await chrome.tabs.query({ currentWindow: true });
      const winYt = winTabs.find((t) => t.url && parseYouTubeUrl(t.url));
      if (winYt) return winYt;

      return curTabs[0] || lastTabs[0] || null;
    } catch (err) {
      console.error("Error querying tabs:", err);
      return null;
    }
  };

  // Poll or detect active YouTube tab video info
  const checkActiveTab = async () => {
    if (typeof chrome === "undefined" || !chrome.tabs) return;

    try {
      const tab = await getActiveYouTubeTab();
      if (!tab?.id || !tab.url) {
        return;
      }

      const parsed = parseYouTubeUrl(tab.url);
      if (!parsed) {
        return;
      }

      const initialTitle = (tab.title || "YouTube Video").replace(/- YouTube$/, "").trim();

      // Immediately activate video info in state so UI recognizes video instantly
      setVideoInfo((prev) => {
        if (!prev || prev.videoId !== parsed.videoId) {
          return {
            videoId: parsed.videoId,
            title: initialTitle,
            durationSec: 0,
            author: "YouTube Lecture",
            hasCaptions: true,
          };
        }
        return prev;
      });

      // Check local cache for this video
      const cached = await getCachedNotes(parsed.videoId);
      if (cached) {
        setNotes((prevNotes) => {
          if (!prevNotes || prevNotes.video.id !== parsed.videoId) {
            return cached;
          }
          return prevNotes;
        });
      } else {
        // Clear notes if switching to an uncached video
        setNotes((prevNotes) => {
          if (prevNotes && prevNotes.video.id !== parsed.videoId) {
            return null;
          }
          return prevNotes;
        });
      }

      // Retrieve enriched metadata (duration, clean title, author, captions) via dual-path
      const richInfo = await getVideoInfoWithFallback(tab.id);
      if (richInfo && richInfo.videoId === parsed.videoId) {
        setVideoInfo(richInfo);
      }
    } catch (err) {
      console.error("Error inspecting active tab:", err);
    }
  };

  useEffect(() => {
    checkActiveTab();
    const interval = setInterval(checkActiveTab, 2000);

    const onActivated = () => {
      checkActiveTab();
    };
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; title?: string; status?: string }
    ) => {
      if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
        checkActiveTab();
      }
    };

    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(onActivated);
      chrome.tabs.onUpdated?.addListener(onUpdated);
    }

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+J or Ctrl+J -> Generate
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        handleGenerate();
      }
      // Alt+S -> Quick Capture Slide
      if (e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleQuickCaptureCurrentFrame();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", handleKeyDown);
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(onActivated);
        chrome.tabs.onUpdated?.removeListener(onUpdated);
      }
    };
  }, []);

  // Seek YouTube Player
  const handleSeek = async (seconds: number) => {
    const tab = await getActiveYouTubeTab();
    if (tab?.id) {
      await ensureContentScriptInjected(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: "SEEK_TO", seconds });
    }
  };

  // Quick Capture Current Video Frame
  const handleQuickCaptureCurrentFrame = async () => {
    const tab = await getActiveYouTubeTab();
    if (!tab?.id) return;
    await ensureContentScriptInjected(tab.id);
    chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_FRAME" }, (res) => {
      if (!chrome.runtime.lastError && res?.success && res.dataUrl) {
        setFeedback("Quick slide captured from player!");
        setTimeout(() => setFeedback(null), 2500);
      }
    });
  };

  // Run Generation Pipeline
  const handleGenerate = async () => {
    const isGemini = (settings.provider || "gemini") === "gemini";
    if (isGemini && !settings.apiKey) {
      setSettingsOpen(true);
      setError("Please save your Google Gemini API key in Settings to proceed.");
      return;
    }
    if (!isGemini && !settings.openRouterApiKey) {
      setSettingsOpen(true);
      setError("Please save your OpenRouter API key in Settings to proceed.");
      return;
    }

    if (!videoInfo) {
      setError("No active YouTube video detected. Please navigate to a YouTube video.");
      return;
    }

    setError(null);
    setLoading(true);
    setProgress({ stage: "chunks", message: "Fetching transcript captions from video..." });

    try {
      const tab = await getActiveYouTubeTab();
      if (!tab?.id) throw new Error("No active YouTube tab found.");

      const segments = await getTranscriptWithFallback(tab.id);
      if (!segments || segments.length === 0) {
        throw new Error(
          "No captions found for this video. Captions may be disabled by the creator or unavailable."
        );
      }

      const client = isGemini
        ? new GeminiClient({
            apiKey: settings.apiKey,
            model: settings.model,
          })
        : new OpenRouterClient({
            apiKey: settings.openRouterApiKey!,
            model: settings.openRouterModel || "google/gemma-4-26b-a4b-it:free",
          });

      const videoMeta: VideoMetadata = {
        video_id: videoInfo.videoId,
        title: videoInfo.title,
        duration_sec: videoInfo.durationSec,
        duration_label: formatTimestamp(videoInfo.durationSec),
      };

      const result = await runPipeline({
        video: videoMeta,
        segments,
        gemini: client,
        windowSeconds: settings.windowSeconds,
        customPrompt: settings.customPrompt,
        onProgress: setProgress,
      });

      // Auto-capture lecture slides if enabled (Option 3)
      if (settings.autoCaptureSlides !== false && result.key_points && result.key_points.length > 0) {
        setProgress({ stage: "synthesis", message: "Auto-capturing lecture slides from video..." });
        try {
          // Select key points with valid timestamps (up to 6 major slides)
          const itemsToCapture = result.key_points
            .map((kp, index) => ({ index, seconds: kp.timestamp_sec }))
            .filter((item) => item.seconds >= 0 && item.seconds <= (videoInfo.durationSec || 99999))
            .slice(0, 6);

          if (itemsToCapture.length > 0) {
            await ensureContentScriptInjected(tab.id);
            const batchRes = await new Promise<{
              success: boolean;
              captures?: Record<number, string>;
            }>((resolve) => {
              chrome.tabs.sendMessage(
                tab.id!,
                { type: "BATCH_CAPTURE_FRAMES", items: itemsToCapture },
                (res) => {
                  if (!chrome.runtime.lastError && res?.success) {
                    resolve(res);
                  } else {
                    resolve({ success: false });
                  }
                }
              );
            });

            if (batchRes.success && batchRes.captures) {
              for (const [idxStr, dataUrl] of Object.entries(batchRes.captures)) {
                const idx = parseInt(idxStr, 10);
                if (result.key_points[idx]) {
                  result.key_points[idx].capturedSlideUrl = dataUrl;
                }
              }
            }
          }
        } catch (captureErr) {
          console.debug("[NotesGen] Auto slide capture error:", captureErr);
        }
      }

      setNotes(result);
      await saveCachedNotes(result);
      setFeedback("Lecture study guide & slides generated!");
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: unknown) {
      setError((err as Error).message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleSaveCustomPrompt = async (text: string) => {
    const updated = await saveSettings({ customPrompt: text.trim() });
    setSettings(updated);
    setCustomPromptInput(text.trim());
    setCustomPromptOpen(false);
    setFeedback(text.trim() ? "Custom prompt preferences saved!" : "Custom prompt cleared.");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleApplyPreset = (presetText: string) => {
    setCustomPromptInput((prev) => {
      if (!prev.trim()) return presetText;
      if (prev.includes(presetText)) return prev;
      return `${prev.trim()}\n${presetText}`;
    });
  };

  const handleSaveSettings = async () => {
    const updated = await saveSettings({
      provider: providerInput,
      apiKey: apiKeyInput.trim(),
      openRouterApiKey: openRouterKeyInput.trim(),
      model: modelInput,
      openRouterModel: openRouterModelInput,
      autoCaptureSlides: autoCaptureInput,
    });
    setSettings(updated);
    setSettingsOpen(false);
    setError(null);
    setFeedback("Settings saved.");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleOpenHistory = async () => {
    const list = await listCachedNotes();
    setHistoryList(list);
    setHistoryOpen(true);
  };

  const handleSelectHistoryItem = async (videoId: string) => {
    const cached = await getCachedNotes(videoId);
    if (cached) {
      setNotes(cached);
      setHistoryOpen(false);
      setFeedback(`Loaded cached notes for: ${cached.video.title}`);
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  const handleDeleteHistoryItem = async (e: React.MouseEvent, videoId: string) => {
    e.stopPropagation();
    await deleteCachedNote(videoId);
    const updated = await listCachedNotes();
    setHistoryList(updated);
    if (notes?.video.id === videoId) {
      setNotes(null);
    }
  };

  // Slide Frame Snapshot
  const handleSnapSlide = async (index: number, timestampSec: number) => {
    if (!notes) return;
    setCapturingSlideIndex(index);
    try {
      const tab = await getActiveYouTubeTab();
      if (!tab?.id) throw new Error("No active YouTube tab found.");

      await ensureContentScriptInjected(tab.id);

      chrome.tabs.sendMessage(
        tab.id,
        { type: "SEEK_AND_CAPTURE", seconds: timestampSec },
        async (res) => {
          setCapturingSlideIndex(null);
          if (chrome.runtime.lastError || !res?.success) {
            setError(res?.error || "Could not capture slide from video player.");
            return;
          }
          const updated = { ...notes };
          updated.key_points[index].capturedSlideUrl = res.dataUrl;
          setNotes(updated);
          await saveCachedNotes(updated);
          setFeedback("Slide snapshot captured!");
          setTimeout(() => setFeedback(null), 2500);
        }
      );
    } catch (err) {
      setCapturingSlideIndex(null);
      setError((err as Error).message);
    }
  };

  // Generate Analogy Illustration (Imagen 3)
  const handleIllustrate = async (index: number, concept: string, analogy: string) => {
    if (!settings.apiKey) {
      setSettingsOpen(true);
      setError("Please save your Google Gemini API key to generate illustrations.");
      return;
    }
    if (!notes) return;

    setIllustratingIndex(index);
    setError(null);
    try {
      const res = await generateAnalogyIllustration({
        apiKey: settings.apiKey,
        concept,
        analogy,
      });

      const updated = { ...notes };
      updated.key_points[index].illustrationUrl = res.dataUrl;
      setNotes(updated);
      await saveCachedNotes(updated);
      setFeedback("AI illustration generated!");
      setTimeout(() => setFeedback(null), 2500);
    } catch (err) {
      setError((err as Error).message || "Could not generate illustration.");
    } finally {
      setIllustratingIndex(null);
    }
  };

  // Export handlers
  const handlePrintPdf = async () => {
    if (!notes) return;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.tabs?.create) {
        await chrome.storage.local.set({ pending_export_notes: notes });
        const exportUrl = chrome.runtime.getURL(
          `export.html?videoId=${encodeURIComponent(notes.video.id)}&autoPrint=true`
        );
        chrome.tabs.create({ url: exportUrl });
      } else {
        localStorage.setItem("notes_gen_pending_export", JSON.stringify(notes));
        window.open("/export.html?autoPrint=true", "_blank");
      }
    } catch (err) {
      console.error("Print export failed, downloading HTML fallback:", err);
      handleDownloadHtml();
    }
  };

  const handleDownloadHtml = () => {
    if (!notes) return;
    const htmlString = generateHtmlDocument(notes);
    const blob = new Blob([htmlString], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const title = (notes.guide?.title || notes.video.title || "study-guide")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 50);
    a.download = `${title}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback("HTML study guide downloaded!");
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleCopyMarkdown = () => {
    if (!notes) return;
    const md = generateMarkdown(notes);
    navigator.clipboard.writeText(md).then(() => {
      setFeedback("Markdown copied to clipboard!");
      setTimeout(() => setFeedback(null), 2500);
    });
  };

  const toggleQuizAnswer = (index: number) => {
    setRevealedQuiz((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Real Topic Tags from generated notes
  const topicTags = notes?.guide?.core_concepts
    ? notes.guide.core_concepts.slice(0, 4).map((c) => `#${c.term.replace(/[^A-Za-z0-9]/g, "")}`)
    : [];

  return (
    <div className="app-container">
      {/* --------------------------------------------------------------------
          Stitch Header
          -------------------------------------------------------------------- */}
      <header className="app-header">
        <div className="header-top">
          <div className="brand-wrapper">
            <div className="brand-icon-stitch">
              <img
                src="/icons/icon48.png"
                alt="NotesGenerator by Joseph"
                style={{ width: 34, height: 34, objectFit: "contain", filter: "drop-shadow(0 2px 6px rgba(37,99,235,0.22))" }}
              />
            </div>
            <div className="brand-meta">
              <div className="brand-title-row">
                <span className="brand-title">NotesGenerator</span>
                <span className="badge-author">by Youssef</span>
              </div>
              <div className="brand-status-row">
                <span className="status-dot-active" />
                <span>v2.5 • Active on YouTube</span>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <button
              className="icon-btn-stitch"
              title="Lecture History / Cached Notes"
              onClick={handleOpenHistory}
            >
              <Clock size={15} />
            </button>
            <button
              className="icon-btn-stitch"
              title="Refresh Detection"
              onClick={checkActiveTab}
            >
              <RefreshCw size={15} />
            </button>
            {notes && (
              <button
                className="icon-btn-stitch"
                title="Print to PDF"
                onClick={handlePrintPdf}
              >
                <Printer size={15} />
              </button>
            )}
            <button
              className="icon-btn-stitch"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------------
          Active YouTube Video Card
          -------------------------------------------------------------------- */}
      <div className="video-card-stitch">
        <div className="video-thumb-stitch">
          {videoInfo?.videoId ? (
            <img
              src={`https://i.ytimg.com/vi/${videoInfo.videoId}/mqdefault.jpg`}
              alt="Video Thumbnail"
            />
          ) : (
            <Video size={24} color="#64748b" />
          )}
          <div className="video-duration-badge">
            {videoInfo && videoInfo.durationSec > 0
              ? formatTimestamp(videoInfo.durationSec)
              : "--:--"}
          </div>
        </div>

        <div className="video-info-stitch">
          <div className="pill-transcript-ready">
            <Check size={11} />
            <span>
              {videoInfo?.hasCaptions !== false
                ? "Transcript Ready (CC)"
                : "No Captions Detected"}
            </span>
          </div>
          <div
            className="video-title-stitch"
            title={videoInfo ? videoInfo.title : "No video selected"}
          >
            {videoInfo
              ? videoInfo.title
              : "Open any YouTube lecture to generate notes"}
          </div>
          <div className="video-author-stitch">
            {videoInfo?.author || "YouTube Lecture • Ready to Analyze"}
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------------------
          Format Style Selector (Grid + Custom Prompt)
          -------------------------------------------------------------------- */}
      <div className="format-section-stitch">
        <div className="format-section-header">
          <span className="format-label">FORMAT STYLE</span>
          <span
            className="format-customize-link"
            onClick={() => setCustomPromptOpen(!customPromptOpen)}
          >
            {settings.customPrompt?.trim() ? "✨ Custom Prompt (Active)" : "Customize Prompt"}
          </span>
        </div>

        <div className="format-grid-stitch">
          <button
            type="button"
            className={`format-card-stitch ${
              selectedFormat === "study_guide" ? "active" : ""
            }`}
            onClick={() => {
              setSelectedFormat("study_guide");
              setNotesSubTab("preview");
            }}
          >
            <FileText size={15} />
            <span>Detailed Study Guide</span>
          </button>

          <button
            type="button"
            className={`format-card-stitch ${
              selectedFormat === "summary" ? "active" : ""
            }`}
            onClick={() => {
              setSelectedFormat("summary");
              setNotesSubTab("preview");
            }}
          >
            <Zap size={15} />
            <span>Executive Summary</span>
          </button>

          <button
            type="button"
            className={`format-card-stitch ${
              selectedFormat === "flashcards" ? "active" : ""
            }`}
            onClick={() => {
              setSelectedFormat("flashcards");
              setNotesSubTab("preview");
            }}
          >
            <Layers size={15} />
            <span>Key Flashcards ({notes?.guide?.core_concepts?.length || 0})</span>
          </button>

          <button
            type="button"
            className={`format-card-stitch ${
              selectedFormat === "quiz" ? "active" : ""
            }`}
            onClick={() => {
              setSelectedFormat("quiz");
              setNotesSubTab("preview");
            }}
          >
            <HelpCircle size={15} />
            <span>Exam Practice Quiz ({notes?.guide?.self_test?.length || 0})</span>
          </button>

          <button
            type="button"
            className={`format-card-stitch full-width ${
              selectedFormat === "custom" || Boolean(settings.customPrompt?.trim()) ? "active" : ""
            }`}
            onClick={() => {
              setSelectedFormat("custom");
              setCustomPromptOpen(true);
            }}
          >
            <Sparkles size={15} />
            <span>
              {settings.customPrompt?.trim()
                ? `Custom Prompt Active: "${settings.customPrompt.slice(0, 28)}..."`
                : "✍️ Custom Note Style & Syntax Rules"}
            </span>
          </button>
        </div>

        {/* Custom Prompt Drawer Panel */}
        {customPromptOpen && (
          <div className="custom-prompt-panel">
            <div className="custom-prompt-header">
              <div className="custom-prompt-title">
                <Sparkles size={14} color="#2563eb" />
                <span>Custom Note Syntax & Style Prompt</span>
              </div>
              <button
                type="button"
                className="custom-prompt-close-btn"
                onClick={() => setCustomPromptOpen(false)}
              >
                ✕
              </button>
            </div>

            <p className="custom-prompt-desc">
              Tailor how Gemini writes your notes (language, technical depth, code focus, syntax, or tone):
            </p>

            {/* Quick 1-Click Preset Chips */}
            <div className="prompt-preset-chips">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="prompt-preset-chip"
                  onClick={() => handleApplyPreset(preset.text)}
                  title={preset.text}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              className="custom-prompt-textarea"
              rows={3}
              placeholder="e.g., Focus heavily on Python code syntax, explain complex terms like I'm 5, or write all notes in French..."
              value={customPromptInput}
              onChange={(e) => setCustomPromptInput(e.target.value)}
            />

            <div className="custom-prompt-actions">
              <button
                type="button"
                className="btn-prompt-clear"
                onClick={() => {
                  setCustomPromptInput("");
                  handleSaveCustomPrompt("");
                }}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn-prompt-save"
                onClick={() => handleSaveCustomPrompt(customPromptInput)}
              >
                Save & Apply Prompt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------------
          Big Gradient CTA Button
          -------------------------------------------------------------------- */}
      <div className="cta-container-stitch">
        <button
          className="btn-stitch-primary"
          onClick={handleGenerate}
          disabled={loading || !videoInfo}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>{progress?.message || "Analyzing Lecture..."}</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>{notes ? "Re-Generate Lecture Notes" : "Generate Lecture Notes"}</span>
              <span className="kbd-badge-stitch">⌘J</span>
            </>
          )}
        </button>
      </div>

      {/* Error & Feedback alerts */}
      {feedback && <div className="toast-feedback">{feedback}</div>}

      {/* Rate Limit / Quota Exceeded Alert */}
      {isQuotaError ? (
        <div className="quota-exceeded-card">
          <div className="quota-card-header">
            <AlertTriangle size={18} color="#ef4444" />
            <span className="quota-card-title">Gemini API Limit / Quota Exceeded</span>
          </div>
          <p className="quota-card-desc">
            Your Google Gemini API free-tier quota (HTTP 429) was reached. You can switch to
            <strong> Gemini 2.5 Flash</strong> for higher rate limits, wait 1 minute, or update your API key.
          </p>
          <div className="quota-card-actions">
            <button
              className="btn-quota-switch"
              onClick={() => {
                setModelInput("gemini-2.5-flash");
                setSettingsOpen(true);
              }}
            >
              Switch Model / Key ⚙️
            </button>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="quota-link"
            >
              AI Studio Quota ↗
            </a>
          </div>
        </div>
      ) : error ? (
        <div className="error-card-stitch">
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      {/* --------------------------------------------------------------------
          Notes Preview Card (Stitch Component)
          -------------------------------------------------------------------- */}
      <div className="notes-container-stitch">
        {notes ? (
          <>
            {/* Internal Tabs */}
            <div className="notes-tabs-stitch">
              <div className="tabs-group-stitch">
                <button
                  className={`tab-link-stitch ${notesSubTab === "preview" ? "active" : ""}`}
                  onClick={() => setNotesSubTab("preview")}
                >
                  Notes Preview
                </button>
                <button
                  className={`tab-link-stitch ${notesSubTab === "diagrams" ? "active" : ""}`}
                  onClick={() => setNotesSubTab("diagrams")}
                >
                  Key Formulas & Architecture
                </button>
                <button
                  className={`tab-link-stitch ${notesSubTab === "timeline" ? "active" : ""}`}
                  onClick={() => setNotesSubTab("timeline")}
                >
                  Timeline ({notes.key_points.length})
                </button>
              </div>

              <div className="tab-actions-stitch">
                <button
                  className="icon-btn-stitch"
                  title="Copy Markdown"
                  onClick={handleCopyMarkdown}
                >
                  <Copy size={14} />
                </button>
                <button
                  className="icon-btn-stitch"
                  title="Download Standalone HTML"
                  onClick={handleDownloadHtml}
                >
                  <Download size={14} />
                </button>
                <button
                  className="icon-btn-stitch"
                  title="Print to PDF"
                  onClick={handlePrintPdf}
                >
                  <Printer size={14} />
                </button>
              </div>
            </div>

            {/* Dynamic Topic Tags from real concepts */}
            {topicTags.length > 0 && (
              <div className="tags-row-stitch">
                {topicTags.map((tag, i) => {
                  const colorClass =
                    i % 3 === 0 ? "tag-amber" : i % 3 === 1 ? "tag-blue" : "tag-emerald";
                  return (
                    <span key={i} className={`tag-pill ${colorClass}`}>
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Content depending on subTab & selectedFormat */}
            {notesSubTab === "diagrams" && (
              <div style={{ marginTop: "12px" }}>
                <MermaidViewer
                  mermaidCode={notes.guide?.architecture_diagram_mermaid}
                  asciiDiagram={notes.guide?.architecture_diagram}
                />
              </div>
            )}

            {notesSubTab === "timeline" && (
              <div style={{ marginTop: "12px" }}>
                {notes.key_points.map((kp, idx) => (
                  <div key={idx} className="section-item-stitch">
                    <div className="section-heading-row">
                      <span className="section-title-stitch">
                        <span className="section-title-bullet">●</span>
                        {idx + 1}. {kp.concept}
                      </span>
                      <button
                        className="timestamp-pill-stitch"
                        onClick={() => handleSeek(kp.timestamp_sec)}
                        title="Seek YouTube Player"
                      >
                        [{kp.timestamp_label}]
                      </button>
                    </div>

                    <p className="section-body-text">{kp.explanation}</p>

                    {/* Captured Slide frame */}
                    {kp.capturedSlideUrl && (
                      <div style={{ margin: "8px 0", borderRadius: "8px", overflow: "hidden" }}>
                        <img
                          src={kp.capturedSlideUrl}
                          alt="Captured Slide"
                          style={{ width: "100%", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                        />
                      </div>
                    )}

                    {/* AI Illustration */}
                    {kp.illustrationUrl && (
                      <div style={{ margin: "8px 0", borderRadius: "8px", overflow: "hidden" }}>
                        <img
                          src={kp.illustrationUrl}
                          alt="AI Illustration"
                          style={{ width: "100%", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                        />
                      </div>
                    )}

                    <div className="media-actions-row">
                      <button
                        className="btn-media-stitch"
                        onClick={() => handleSnapSlide(idx, kp.timestamp_sec)}
                        disabled={capturingSlideIndex === idx}
                      >
                        <Camera size={13} />
                        <span>{capturingSlideIndex === idx ? "Snapping..." : "Snap Slide"}</span>
                      </button>
                      {kp.analogy && (
                        <button
                          className="btn-media-stitch"
                          onClick={() => handleIllustrate(idx, kp.concept, kp.analogy!)}
                          disabled={illustratingIndex === idx}
                        >
                          <ImageIcon size={13} />
                          <span>{illustratingIndex === idx ? "Drawing..." : "Illustrate"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {notesSubTab === "preview" && (
              <div>
                {/* Format: Quiz */}
                {selectedFormat === "quiz" && (
                  <div style={{ marginTop: "12px" }}>
                    {notes.guide?.self_test && notes.guide.self_test.length > 0 ? (
                      notes.guide.self_test.map((item, idx) => (
                        <div key={idx} className="section-item-stitch">
                          <div className="section-heading-row">
                            <span className="section-title-stitch">
                              <span className="section-title-bullet">❓</span>
                              Question {idx + 1}
                            </span>
                            {item.answer_at_sec !== undefined && (
                              <button
                                className="timestamp-pill-stitch"
                                onClick={() => handleSeek(item.answer_at_sec)}
                              >
                                [{formatTimestamp(item.answer_at_sec)}]
                              </button>
                            )}
                          </div>
                          <p className="section-body-text" style={{ fontWeight: 600 }}>
                            {item.question}
                          </p>
                          <button
                            className="btn-media-stitch"
                            onClick={() => toggleQuizAnswer(idx)}
                            style={{ marginTop: "4px" }}
                          >
                            {revealedQuiz.has(idx) ? <EyeOff size={13} /> : <Eye size={13} />}
                            <span>{revealedQuiz.has(idx) ? "Hide Answer" : "Reveal Answer"}</span>
                          </button>
                          {revealedQuiz.has(idx) && (
                            <div className="callout-box-stitch" style={{ marginTop: "8px" }}>
                              <div className="callout-title">
                                <Check size={13} />
                                Answer & Explanation
                              </div>
                              <div>{item.answer}</div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p style={{ color: "#64748b", fontSize: "12.5px" }}>
                        No quiz questions generated for this lecture.
                      </p>
                    )}
                  </div>
                )}

                {/* Format: Flashcards */}
                {selectedFormat === "flashcards" && (
                  <div style={{ marginTop: "12px" }}>
                    {notes.guide?.core_concepts && notes.guide.core_concepts.length > 0 ? (
                      notes.guide.core_concepts.map((concept, idx) => (
                        <div key={idx} className="flashcard-stitch">
                          <div className="flashcard-term">
                            {idx + 1}. {concept.term}
                          </div>
                          <div className="flashcard-definition">{concept.plain_explanation}</div>
                          {concept.why_it_matters && (
                            <div
                              style={{
                                marginTop: "6px",
                                fontSize: "12px",
                                color: "#0369a1",
                                background: "#f0f9ff",
                                padding: "6px 8px",
                                borderRadius: "6px",
                              }}
                            >
                              <strong>Why it matters:</strong> {concept.why_it_matters}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p style={{ color: "#64748b", fontSize: "12.5px" }}>
                        No core concepts found for flashcards.
                      </p>
                    )}
                  </div>
                )}

                {/* Format: Executive Summary */}
                {selectedFormat === "summary" && (
                  <div style={{ marginTop: "12px" }}>
                    {notes.guide?.executive_summary ? (
                      <div>
                        <div className="callout-box-stitch" style={{ marginBottom: "12px" }}>
                          <div className="callout-title">
                            <Lightbulb size={14} />
                            One-Line Essence
                          </div>
                          <div style={{ fontStyle: "italic" }}>
                            "{notes.guide.one_line_summary}"
                          </div>
                        </div>
                        <p className="section-body-text" style={{ fontSize: "13px" }}>
                          {notes.guide.executive_summary}
                        </p>
                        {notes.guide.key_takeaways && (
                          <div style={{ marginTop: "14px" }}>
                            <strong style={{ fontSize: "13px", color: "#0f172a" }}>
                              Key Takeaways:
                            </strong>
                            <ul style={{ paddingLeft: "18px", marginTop: "6px", fontSize: "12.5px" }}>
                              {notes.guide.key_takeaways.map((t, i) => (
                                <li key={i} style={{ marginBottom: "5px" }}>
                                  {t}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ color: "#64748b", fontSize: "12.5px" }}>
                        Executive summary not available.
                      </p>
                    )}
                  </div>
                )}

                {/* Format: Detailed Study Guide / Custom Prompt */}
                {(selectedFormat === "study_guide" || selectedFormat === "custom") && (
                  <div style={{ marginTop: "12px" }}>
                    {selectedFormat === "custom" && (
                      <div
                        style={{
                          marginBottom: "12px",
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: "10px",
                          padding: "10px 12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <div style={{ fontSize: "12px", color: "#1e40af", flex: 1 }}>
                          <strong>Custom Style:</strong>{" "}
                          {settings.customPrompt?.trim()
                            ? `"${settings.customPrompt}"`
                            : "Default style. Click 'Edit Rules' to customize."}
                        </div>
                        <button
                          type="button"
                          className="btn-prompt-clear"
                          style={{ padding: "4px 8px", fontSize: "11px", whiteSpace: "nowrap" }}
                          onClick={() => setCustomPromptOpen(true)}
                        >
                          Edit Rules ✍️
                        </button>
                      </div>
                    )}
                    {notes.key_points.map((kp, idx) => (
                      <div key={idx} className="section-item-stitch">
                        <div className="section-heading-row">
                          <span className="section-title-stitch">
                            <span className="section-title-bullet">●</span>
                            {idx + 1}. {kp.concept}
                          </span>
                          <button
                            className="timestamp-pill-stitch"
                            onClick={() => handleSeek(kp.timestamp_sec)}
                            title="Seek YouTube Player"
                          >
                            [{kp.timestamp_label}]
                          </button>
                        </div>

                        <p className="section-body-text">{kp.explanation}</p>

                        {/* Callout box for rule of thumb / analogy */}
                        {kp.analogy && (
                          <div className="callout-box-stitch">
                            <div className="callout-title">
                              <Lightbulb size={13} />
                              Key Intuition / Rule of Thumb
                            </div>
                            <div>{kp.analogy}</div>
                          </div>
                        )}

                        {/* Slide Frame Snapshot if captured */}
                        {kp.capturedSlideUrl && (
                          <div style={{ margin: "8px 0", borderRadius: "8px", overflow: "hidden" }}>
                            <img
                              src={kp.capturedSlideUrl}
                              alt="Captured Slide"
                              style={{ width: "100%", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                            />
                          </div>
                        )}

                        {/* AI Analogy Illustration if generated */}
                        {kp.illustrationUrl && (
                          <div style={{ margin: "8px 0", borderRadius: "8px", overflow: "hidden" }}>
                            <img
                              src={kp.illustrationUrl}
                              alt="AI Illustration"
                              style={{ width: "100%", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                            />
                          </div>
                        )}

                        <div className="media-actions-row">
                          <button
                            className="btn-media-stitch"
                            onClick={() => handleSnapSlide(idx, kp.timestamp_sec)}
                            disabled={capturingSlideIndex === idx}
                          >
                            <Camera size={13} />
                            <span>{capturingSlideIndex === idx ? "Snapping..." : "Snap Slide"}</span>
                          </button>
                          {kp.analogy && (
                            <button
                              className="btn-media-stitch"
                              onClick={() => handleIllustrate(idx, kp.concept, kp.analogy!)}
                              disabled={illustratingIndex === idx}
                            >
                              <ImageIcon size={13} />
                              <span>{illustratingIndex === idx ? "Drawing..." : "Illustrate"}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Empty state when notes haven't been generated yet (NO FAKE NOTES) */
          <div style={{ textAlign: "center", padding: "36px 16px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "#eff6ff",
                color: "#2563eb",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
              }}
            >
              <BookOpen size={24} />
            </div>
            <h4 style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
              Ready to Generate Study Notes
            </h4>
            <p
              style={{
                fontSize: "12.5px",
                color: "#64748b",
                maxWidth: "320px",
                margin: "0 auto 16px auto",
                lineHeight: 1.5,
              }}
            >
              Click <strong>✦ Generate Lecture Notes</strong> above to extract grounded key points,
              architecture diagrams, flashcards, and quizzes from this video.
            </p>

            {!(
              (settings.provider === "openrouter" && settings.openRouterApiKey) ||
              (settings.provider !== "openrouter" && settings.apiKey)
            ) && (
              <div
                style={{
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  display: "inline-block",
                  fontSize: "12px",
                  color: "#92400e",
                  textAlign: "left",
                  maxWidth: "340px",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>⚠️ API Key Needed</div>
                Please enter your API key in{" "}
                <span
                  style={{ fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
                  onClick={() => setSettingsOpen(true)}
                >
                  Settings ⚙️
                </span>{" "}
                to start generating ({settings.provider === "openrouter" ? "OpenRouter" : "Google Gemini"}).
              </div>
            )}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------------
          Floating Bottom Dock Bar (Dark Sleek Quota Control)
          -------------------------------------------------------------------- */}
      <footer className="bottom-dock-stitch">
        <div className="dock-top-row">
          {isQuotaError ? (
            <div
              className="dock-status-quota-exceeded"
              onClick={() => setSettingsOpen(true)}
              title="Click to change model or API key"
            >
              <AlertTriangle size={13} />
              <span>Quota Exceeded (HTTP 429)</span>
            </div>
          ) : (
            <div className="dock-status-connected">
              <Zap size={13} />
              <span>
                {settings.provider === "openrouter"
                  ? settings.openRouterApiKey
                    ? "Connected (Gemma 4 • OpenRouter)"
                    : "No OpenRouter Key Configured"
                  : settings.apiKey
                  ? `Connected (${settings.model})`
                  : "No Gemini Key Configured"}
              </span>
            </div>
          )}
          <div>{notes ? `${notes.key_points.length} Points Ready` : "Ready to Analyze"}</div>
        </div>

        <div className="dock-bottom-row" style={{ marginTop: "6px" }}>
          <div className="dock-kbd-tip">
            <kbd className="dock-kbd">Alt</kbd>
            <span>+</span>
            <kbd className="dock-kbd">S</kbd>
            <span>slide</span>
            <span style={{ margin: "0 4px", color: "#334155" }}>•</span>
            <kbd className="dock-kbd">Ctrl</kbd>
            <span>+</span>
            <kbd className="dock-kbd">J</kbd>
            <span>generate</span>
          </div>
          <span
            className="dock-link-action"
            onClick={() => setSettingsOpen(true)}
          >
            {(settings.provider === "openrouter" ? settings.openRouterApiKey : settings.apiKey)
              ? "Settings ⚙️"
              : "Enter API Key →"}
          </span>
        </div>
      </footer>

      {/* --------------------------------------------------------------------
          History / Cached Notes Modal
          -------------------------------------------------------------------- */}
      {historyOpen && (
        <div className="modal-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                Cached Lecture Notes
              </h3>
              <button
                className="icon-btn-stitch"
                onClick={() => setHistoryOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: "350px", overflowY: "auto" }}>
              {historyList.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
                  No saved lecture notes yet. Generate your first video to see it here!
                </p>
              ) : (
                historyList.map((item) => (
                  <div
                    key={item.videoId}
                    onClick={() => handleSelectHistoryItem(item.videoId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      marginBottom: "8px",
                      cursor: "pointer",
                      background: notes?.video.id === item.videoId ? "#eff6ff" : "#ffffff",
                      borderColor: notes?.video.id === item.videoId ? "#3b82f6" : "#e2e8f0",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, marginRight: "10px" }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "13px",
                          color: "#0f172a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.title}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                        ⏱ {formatTimestamp(item.durationSec)} • {item.sectionsCount} key points
                      </div>
                    </div>
                    <button
                      className="icon-btn-stitch"
                      title="Delete Cached Note"
                      onClick={(e) => handleDeleteHistoryItem(e, item.videoId)}
                    >
                      <Trash2 size={13} color="#ef4444" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn-media-stitch"
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          Settings Modal
          -------------------------------------------------------------------- */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                Settings & AI Providers
              </h3>
              <button
                className="icon-btn-stitch"
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">AI Provider</label>
                <select
                  className="form-input"
                  value={providerInput}
                  onChange={(e) => setProviderInput(e.target.value as LLMProvider)}
                >
                  <option value="gemini">Google Gemini (Default & Recommended)</option>
                  <option value="openrouter">OpenRouter (Gemma 4 & Community)</option>
                </select>
                <p className="form-help">
                  {providerInput === "gemini"
                    ? "Direct Google AI Studio connection (1,500 free generations/day, high-speed synthesis)."
                    : "Connect via OpenRouter using Gemma 4 26B A4B free model."}
                </p>
              </div>

              {providerInput === "gemini" ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Google Gemini API Key</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="AIzaSy..."
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <p className="form-help">
                      Direct browser connection ($0 server cost). Get your free key at{" "}
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                      >
                        Google AI Studio
                      </a>
                      .
                    </p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Gemini Model</label>
                    <select
                      className="form-input"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                    >
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast & Recommended)</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Reasoning)</option>
                    </select>
                    <p className="form-help">
                      Gemini 2.5 Flash produces full textbook notes with zero rate-limit issues.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">OpenRouter API Key</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="sk-or-v1-..."
                      value={openRouterKeyInput}
                      onChange={(e) => setOpenRouterKeyInput(e.target.value)}
                    />
                    <p className="form-help">
                      Connect your OpenRouter account. Get your key at{" "}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                      >
                        openrouter.ai/keys
                      </a>
                      .
                    </p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">OpenRouter Model</label>
                    <select
                      className="form-input"
                      value={openRouterModelInput}
                      onChange={(e) => setOpenRouterModelInput(e.target.value)}
                    >
                      <option value="google/gemma-4-26b-a4b-it:free">
                        google/gemma-4-26b-a4b-it:free (Gemma 4 26B A4B MoE)
                      </option>
                    </select>
                    <p className="form-help">
                      Multimodal MoE model from Google DeepMind hosted on OpenRouter free tier.
                    </p>
                  </div>
                </>
              )}

              <div className="form-group" style={{ marginTop: "14px" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#1e293b",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoCaptureInput}
                    onChange={(e) => setAutoCaptureInput(e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: "#0284c7" }}
                  />
                  <span>📸 Auto-capture lecture slides from video</span>
                </label>
                <p className="form-help" style={{ marginTop: "4px" }}>
                  Automatically snapshots presentation slides from the YouTube player at key timestamps.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-media-stitch"
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-stitch-primary"
                style={{ width: "auto", padding: "8px 18px", height: "36px" }}
                onClick={handleSaveSettings}
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
