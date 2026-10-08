/**
 * Content Script for NotesGenerator.
 *
 * Runs inside YouTube pages to:
 * 1. Extract video metadata and transcript captions directly in-browser.
 * 2. Bridge timestamp clicks from the Side Panel to seek the HTML5 <video> element.
 * 3. Provide canvas snapshot captures for video slides.
 */

import { cleanText, Segment } from "../core/transcript";

interface VideoInfo {
  videoId: string;
  title: string;
  durationSec: number;
  author?: string;
  hasCaptions?: boolean;
}

function getVideoIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
    return v;
  }
  const match = window.location.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Robust JSON extraction using a brace-counter instead of fragile non-greedy regex.
 */
function extractJsonFromScript(text: string, marker: string): any {
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = text.indexOf("{", markerIdx);
  if (start === -1) return null;

  let brace = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === "{") brace++;
      else if (c === "}") {
        brace--;
        if (brace === 0) {
          try {
            return JSON.parse(text.substring(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

async function getVideoInfoAsync(): Promise<VideoInfo | null> {
  const videoId = getVideoIdFromUrl();
  if (!videoId) return null;

  const videoEl = document.querySelector<HTMLVideoElement>("video");
  const durationSec = videoEl && !isNaN(videoEl.duration) ? videoEl.duration : 0;

  // Title extraction
  let title = "";
  const titleEl = document.querySelector<HTMLElement>(
    "h1.ytd-watch-metadata, #container > h1 > yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string"
  );
  if (titleEl && titleEl.textContent) {
    title = titleEl.textContent.trim();
  } else {
    title = document.title.replace(/- YouTube$/, "").trim();
  }

  // Author / Channel name
  let author = "YouTube Creator";
  const authorEl = document.querySelector<HTMLElement>(
    "#channel-name a, ytd-channel-name a, #owner-sub-count, #upload-info a, ytd-video-owner-renderer a"
  );
  if (authorEl && authorEl.textContent) {
    author = authorEl.textContent.trim();
  }

  // Captions presence check
  let hasCaptions = true;
  try {
    const tracks = await getCaptionTracks();
    hasCaptions = tracks.length > 0;
  } catch {
    hasCaptions = false;
  }

  return { videoId, title, durationSec, author, hasCaptions };
}

/**
 * Extract caption track URLs from DOM script tags or watch page HTML.
 */
async function getCaptionTracks(): Promise<Array<{ baseUrl: string; languageCode: string; name?: any }>> {
  // Method 1: Scan DOM script tags using brace counter
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const script of scripts) {
    const text = script.textContent || "";
    if (text.includes("ytInitialPlayerResponse")) {
      const data = extractJsonFromScript(text, "ytInitialPlayerResponse");
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        return tracks;
      }
    }
  }

  // Method 2: Fetch current watch page HTML directly with browser session
  try {
    const res = await fetch(window.location.href, { credentials: "same-origin" });
    if (res.ok) {
      const html = await res.text();
      const data = extractJsonFromScript(html, "ytInitialPlayerResponse");
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        return tracks;
      }
    }
  } catch (err) {
    console.debug("[NotesGen] Failed to fetch page HTML for captions:", err);
  }

  return [];
}

function parseJson3Segments(data: any): Segment[] {
  const events = data?.events || [];
  const segments: Segment[] = [];
  for (const ev of events) {
    if (!ev.segs || ev.segs.length === 0) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const duration = (ev.dDurationMs || 0) / 1000;
    const rawText = ev.segs.map((s: any) => s.utf8 || "").join("");
    const cleaned = cleanText(rawText);
    if (cleaned.length > 0) {
      segments.push({ start, duration, text: cleaned });
    }
  }
  return segments;
}

function parseXmlSegments(xmlText: string): Segment[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const textNodes = Array.from(doc.querySelectorAll("text"));
  if (textNodes.length > 0) {
    return textNodes
      .map((node) => {
        const start = parseFloat(node.getAttribute("start") || "0");
        const duration = parseFloat(node.getAttribute("dur") || "0");
        const rawContent = node.textContent || "";
        return {
          start,
          duration,
          text: cleanText(rawContent),
        };
      })
      .filter((s) => s.text.length > 0);
  }

  const pNodes = Array.from(doc.querySelectorAll("p"));
  return pNodes
    .map((p) => {
      const start = parseFloat(p.getAttribute("t") || "0") / 1000;
      const duration = parseFloat(p.getAttribute("d") || "0") / 1000;
      const rawContent = p.textContent || "";
      return {
        start,
        duration,
        text: cleanText(rawContent),
      };
    })
    .filter((s) => s.text.length > 0);
}

function parseTimestampToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function extractDomSegments(): Segment[] {
  const cueEls = Array.from(
    document.querySelectorAll("ytd-transcript-segment-renderer, transcript-segment-view-model")
  );
  if (cueEls.length === 0) return [];

  const rawCues: Array<{ start: number; text: string }> = [];
  for (const el of cueEls) {
    const tsEl = el.querySelector(".segment-timestamp, [class*='timestamp'], [class*='time']");
    let tsText = tsEl?.textContent?.trim() || "";
    if (!tsText) {
      const match = el.textContent?.match(/\b(\d{1,2}:)?\d{1,2}:\d{2}\b/);
      if (match) tsText = match[0];
    }
    const start = parseTimestampToSeconds(tsText);

    const textEl = el.querySelector(
      ".segment-text, [class*='segment-text'], [class*='content'], yt-formatted-string"
    );
    let content = textEl?.textContent?.trim() || "";
    if (!content) {
      content = (el.textContent || "").replace(tsText, "").trim();
    }
    const cleaned = cleanText(content);
    if (cleaned) {
      rawCues.push({ start, text: cleaned });
    }
  }

  if (rawCues.length === 0) return [];
  const segs: Segment[] = [];
  for (let i = 0; i < rawCues.length; i++) {
    const cur = rawCues[i];
    const next = rawCues[i + 1];
    const duration = next ? Math.max(0.5, next.start - cur.start) : 4;
    segs.push({ start: cur.start, duration, text: cur.text });
  }
  return segs;
}

async function triggerTranscriptInDom(): Promise<Segment[]> {
  // Check if cues are already present in DOM
  let segs = extractDomSegments();
  if (segs.length > 0) return segs;

  let openedByScript = false;
  let transcriptBtn = document.querySelector<HTMLElement>(
    "ytd-video-description-transcript-section-renderer button, " +
    "ytd-video-description-transcript-section-renderer ytd-button-shape button, " +
    "button[aria-label*='transcript' i], " +
    "button[aria-label*='Transcript' i]"
  );

  if (!transcriptBtn) {
    // Expand description if collapsed
    const expandBtn = document.querySelector<HTMLElement>(
      "#expand, #description #expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand, #description-inline-expander #expand"
    );
    if (expandBtn) {
      expandBtn.click();
      await new Promise((r) => setTimeout(r, 350));
    }
    transcriptBtn = document.querySelector<HTMLElement>(
      "ytd-video-description-transcript-section-renderer button, " +
      "ytd-video-description-transcript-section-renderer ytd-button-shape button, " +
      "button[aria-label*='transcript' i], " +
      "button[aria-label*='Transcript' i]"
    );
  }

  if (!transcriptBtn) {
    // Check 3-dots more actions menu
    const moreBtn = document.querySelector<HTMLElement>(
      "#actions ytd-menu-renderer yt-button-shape button, #actions ytd-menu-renderer button"
    );
    if (moreBtn) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const menuItems = Array.from(
        document.querySelectorAll<HTMLElement>("tp-yt-paper-item, ytd-menu-service-item-renderer")
      );
      const transcriptItem = menuItems.find((item) =>
        item.textContent?.toLowerCase().includes("transcript")
      );
      if (transcriptItem) {
        transcriptItem.click();
        openedByScript = true;
      }
    }
  } else {
    transcriptBtn.click();
    openedByScript = true;
  }

  // Poll up to 4500ms for segments to render
  const startWait = Date.now();
  while (Date.now() - startWait < 4500) {
    segs = extractDomSegments();
    if (segs.length > 0) {
      if (openedByScript) {
        const closeBtn = document.querySelector<HTMLElement>(
          "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] #visibility-button button, " +
          "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] button[aria-label*='Close' i]"
        );
        if (closeBtn) closeBtn.click();
      }
      return segs;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return [];
}

/**
 * Fetch and parse captions into cleaned Segment objects with multi-tier fallback.
 */
async function fetchTranscriptSegments(): Promise<Segment[]> {
  // Tier 1: Check if DOM transcript elements already present
  const existingDom = extractDomSegments();
  if (existingDom.length > 0) {
    return existingDom;
  }

  // Tier 2: Try direct timedtext URLs
  try {
    const tracks = await getCaptionTracks();
    if (tracks.length > 0) {
      const preferredLangCodes = ["en", "en-US", "en-GB", "en-CA"];
      let chosenTrack = tracks.find((t) => preferredLangCodes.includes(t.languageCode));
      if (!chosenTrack) {
        chosenTrack = tracks.find((t) => t.languageCode?.startsWith("en")) || tracks[0];
      }

      if (chosenTrack?.baseUrl) {
        const baseUrlsToTry = [
          chosenTrack.baseUrl + "&fmt=json3",
          chosenTrack.baseUrl,
          chosenTrack.baseUrl + "&fmt=srv3",
          chosenTrack.baseUrl.replace(/&variant=[^&]+/g, "") + "&fmt=json3",
          chosenTrack.baseUrl.replace(/&variant=[^&]+/g, ""),
        ];

        for (const url of baseUrlsToTry) {
          try {
            const res = await fetch(url, { credentials: "same-origin" });
            if (!res.ok) continue;
            const text = await res.text();
            if (!text || text.trim().length === 0) continue;

            if (text.startsWith("{")) {
              const json = JSON.parse(text);
              const segs = parseJson3Segments(json);
              if (segs.length > 0) return segs;
            } else {
              const segs = parseXmlSegments(text);
              if (segs.length > 0) return segs;
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.debug("[NotesGen] Direct timedtext fetch attempt error:", err);
  }

  // Tier 3: DOM simulation (click Show transcript, poll cues, close panel)
  try {
    const domSegs = await triggerTranscriptInDom();
    if (domSegs.length > 0) {
      return domSegs;
    }
  } catch (err) {
    console.debug("[NotesGen] DOM transcript trigger attempt error:", err);
  }

  throw new Error(
    "Could not load captions for this video. If captions are available, please click 'Show transcript' under the video description on YouTube and try generating again."
  );
}

// ---------------------------------------------------------------------------
// Message Listener for Side Panel
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({ pong: true });
    return false;
  }

  if (request.type === "GET_VIDEO_INFO") {
    getVideoInfoAsync().then((info) => {
      sendResponse({ success: Boolean(info), info });
    });
    return true;
  }

  if (request.type === "FETCH_TRANSCRIPT") {
    fetchTranscriptSegments()
      .then((segments) => sendResponse({ success: true, segments }))
      .catch((err) => sendResponse({ success: false, error: (err as Error).message }));
    return true; // Keep channel open for async response
  }

  if (request.type === "SEEK_TO") {
    const seconds = request.seconds;
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video && typeof seconds === "number") {
      video.currentTime = seconds;
      video.play().catch(() => {});
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "Video element not found." });
    }
    return false;
  }

  if (request.type === "CAPTURE_FRAME") {
    try {
      const video = document.querySelector<HTMLVideoElement>("video");
      if (!video) throw new Error("Video element not found.");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize canvas context.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      sendResponse({ success: true, dataUrl });
    } catch (err) {
      sendResponse({ success: false, error: (err as Error).message });
    }
    return false;
  }

  if (request.type === "SEEK_AND_CAPTURE") {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) {
      sendResponse({ success: false, error: "Video element not found." });
      return true;
    }

    video.currentTime = request.seconds;
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      setTimeout(() => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not initialize canvas context.");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          sendResponse({ success: true, dataUrl });
        } catch (err) {
          sendResponse({ success: false, error: (err as Error).message });
        }
      }, 200);
    };

    video.addEventListener("seeked", onSeeked);
    return true;
  }

  if (request.type === "BATCH_CAPTURE_FRAMES") {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) {
      sendResponse({ success: false, error: "Video element not found." });
      return true;
    }

    const items: Array<{ index: number; seconds: number }> = request.items || [];
    if (items.length === 0) {
      sendResponse({ success: true, captures: {} });
      return true;
    }

    const originalTime = video.currentTime;
    const wasPaused = video.paused;

    // Temporarily pause video so audio does not stutter during seeking
    if (!wasPaused) {
      try {
        video.pause();
      } catch {}
    }

    const captureSingleFrame = (seconds: number): Promise<string | null> => {
      return new Promise((resolve) => {
        let timeoutId: any = null;

        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          if (timeoutId) clearTimeout(timeoutId);
          setTimeout(() => {
            try {
              const canvas = document.createElement("canvas");
              const targetWidth = Math.min(960, video.videoWidth || 1280);
              const scale = targetWidth / (video.videoWidth || 1280);
              canvas.width = targetWidth;
              canvas.height = Math.round((video.videoHeight || 720) * scale);
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                resolve(null);
                return;
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              // Clean JPEG 0.75 for crisp slides and minimal storage payload
              const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
              resolve(dataUrl);
            } catch {
              resolve(null);
            }
          }, 100);
        };

        timeoutId = setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolve(null);
        }, 1200);

        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = seconds;
      });
    };

    (async () => {
      const captures: Record<number, string> = {};
      for (const item of items) {
        const url = await captureSingleFrame(item.seconds);
        if (url) {
          captures[item.index] = url;
        }
      }

      // Restore original playback position and play/pause state
      video.currentTime = originalTime;
      if (!wasPaused) {
        try {
          video.play().catch(() => {});
        } catch {}
      }

      sendResponse({ success: true, captures });
    })();

    return true; // Keep message channel open for async response
  }

  return false;
});
