/**
 * tabTranscript.ts
 *
 * Resilient multi-tier YouTube caption & video info extractor for Chrome Extension.
 *
 * Tier 1: Content Script messaging (`chrome.tabs.sendMessage`).
 * Tier 2: Direct Main-World Script Execution (`chrome.scripting.executeScript` in world: "MAIN").
 *
 * Eliminates "Could not reach YouTube player" errors caused by disconnected content scripts,
 * YouTube CSP blocking, or SPA navigation state desynchronization.
 */

import { Segment } from "./transcript";

export interface VideoInfo {
  videoId: string;
  title: string;
  durationSec: number;
  author?: string;
  hasCaptions?: boolean;
}

/**
 * Self-contained Main-World function that executes directly in YouTube's page context.
 * Cannot reference external closures or imports.
 */
async function mainWorldTranscriptExtractor(): Promise<{
  success: boolean;
  segments?: Array<{ start: number; duration: number; text: string }>;
  error?: string;
}> {
  try {
    const clean = (str: string) => {
      return (str || "")
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
    };

    const parseTime = (timeStr: string): number => {
      const parts = timeStr.trim().split(":").map(Number);
      if (parts.some(isNaN)) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };

    const extractDomSegments = (): Array<{ start: number; duration: number; text: string }> => {
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
        const start = parseTime(tsText);

        const textEl = el.querySelector(
          ".segment-text, [class*='segment-text'], [class*='content'], yt-formatted-string"
        );
        let content = textEl?.textContent?.trim() || "";
        if (!content) {
          content = (el.textContent || "").replace(tsText, "").trim();
        }
        const cleaned = clean(content);
        if (cleaned) {
          rawCues.push({ start, text: cleaned });
        }
      }

      if (rawCues.length === 0) return [];
      const segs: Array<{ start: number; duration: number; text: string }> = [];
      for (let i = 0; i < rawCues.length; i++) {
        const cur = rawCues[i];
        const next = rawCues[i + 1];
        const duration = next ? Math.max(0.5, next.start - cur.start) : 4;
        segs.push({ start: cur.start, duration, text: cur.text });
      }
      return segs;
    };

    // ---------------------------------------------------------
    // Tier 1: Check if DOM transcript elements are already open
    // ---------------------------------------------------------
    const existingDom = extractDomSegments();
    if (existingDom.length > 0) {
      return { success: true, segments: existingDom };
    }

    // ---------------------------------------------------------
    // Tier 2: Try direct Timedtext URLs if available
    // ---------------------------------------------------------
    const player = document.getElementById("movie_player") as any;
    let pr = null;
    if (player && typeof player.getPlayerResponse === "function") {
      try {
        pr = player.getPlayerResponse();
      } catch {}
    }
    if (!pr && (window as any).ytInitialPlayerResponse) {
      pr = (window as any).ytInitialPlayerResponse;
    }

    // If still null, search script tags with JSON brace counter
    if (!pr) {
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        const text = script.textContent || "";
        const idx = text.indexOf("ytInitialPlayerResponse");
        if (idx !== -1) {
          const start = text.indexOf("{", idx);
          if (start !== -1) {
            let brace = 0,
              inStr = false,
              esc = false;
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
                      pr = JSON.parse(text.substring(start, i + 1));
                    } catch {}
                    break;
                  }
                }
              }
            }
          }
        }
        if (pr) break;
      }
    }

    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks && Array.isArray(tracks) && tracks.length > 0) {
      const preferred = ["en", "en-US", "en-GB", "en-CA"];
      let chosen = tracks.find((t: any) => preferred.includes(t.languageCode));
      if (!chosen) {
        chosen = tracks.find((t: any) => t.languageCode?.startsWith("en")) || tracks[0];
      }

      if (chosen?.baseUrl) {
        const urls = [
          chosen.baseUrl + "&fmt=json3",
          chosen.baseUrl,
          chosen.baseUrl + "&fmt=srv3",
          chosen.baseUrl.replace(/&variant=[^&]+/g, "") + "&fmt=json3",
          chosen.baseUrl.replace(/&variant=[^&]+/g, ""),
        ];

        for (const u of urls) {
          try {
            const res = await fetch(u, { credentials: "same-origin" });
            if (!res.ok) continue;
            const text = await res.text();
            if (!text || text.trim().length === 0) continue;

            if (text.startsWith("{")) {
              const data = JSON.parse(text);
              const events = data.events || [];
              const segs: Array<{ start: number; duration: number; text: string }> = [];
              for (const ev of events) {
                if (!ev.segs || ev.segs.length === 0) continue;
                const start = (ev.tStartMs || 0) / 1000;
                const duration = (ev.dDurationMs || 0) / 1000;
                const t = clean(ev.segs.map((s: any) => s.utf8 || "").join(""));
                if (t.length > 0) {
                  segs.push({ start, duration, text: t });
                }
              }
              if (segs.length > 0) {
                return { success: true, segments: segs };
              }
            } else {
              const parser = new DOMParser();
              const doc = parser.parseFromString(text, "text/xml");
              const textNodes = Array.from(doc.querySelectorAll("text"));
              if (textNodes.length > 0) {
                const segs = textNodes
                  .map((n) => ({
                    start: parseFloat(n.getAttribute("start") || "0"),
                    duration: parseFloat(n.getAttribute("dur") || "0"),
                    text: clean(n.textContent || ""),
                  }))
                  .filter((s) => s.text.length > 0);
                if (segs.length > 0) {
                  return { success: true, segments: segs };
                }
              }

              const pNodes = Array.from(doc.querySelectorAll("p"));
              if (pNodes.length > 0) {
                const segs = pNodes
                  .map((p) => ({
                    start: parseFloat(p.getAttribute("t") || "0") / 1000,
                    duration: parseFloat(p.getAttribute("d") || "0") / 1000,
                    text: clean(p.textContent || ""),
                  }))
                  .filter((s) => s.text.length > 0);
                if (segs.length > 0) {
                  return { success: true, segments: segs };
                }
              }
            }
          } catch {}
        }
      }
    }

    // ---------------------------------------------------------
    // Tier 3: In-Page Innertube /youtubei/v1/get_transcript API
    // ---------------------------------------------------------
    try {
      const ytcfg = (window as any).ytcfg;
      const apiKey = ytcfg?.get?.("INNERTUBE_API_KEY") || ytcfg?.data_?.INNERTUBE_API_KEY;
      const context = ytcfg?.get?.("INNERTUBE_CONTEXT") || ytcfg?.data_?.INNERTUBE_CONTEXT;
      const clientVersion =
        ytcfg?.get?.("INNERTUBE_CLIENT_VERSION") ||
        ytcfg?.data_?.INNERTUBE_CLIENT_VERSION ||
        "2.20240313.01.00";

      let params: string | null = null;
      const initialData = (window as any).ytInitialData;
      const panels = initialData?.engagementPanels || [];
      for (const p of panels) {
        const ep = p?.engagementPanelSectionListRenderer;
        if (ep?.targetId === "engagement-panel-searchable-transcript") {
          params =
            ep?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;
          if (params) break;
        }
      }

      if (apiKey && context && params) {
        const itRes = await fetch(`/youtubei/v1/get_transcript?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Youtube-Client-Name": "1",
            "X-Youtube-Client-Version": clientVersion,
          },
          credentials: "same-origin",
          body: JSON.stringify({ context, params }),
        });

        if (itRes.ok) {
          const itData = await itRes.json();
          const actions = itData?.actions || [];
          let initialSegments: any[] = [];
          for (const a of actions) {
            const p = a?.updateEngagementPanelAction?.content?.transcriptRenderer;
            const bodyRen =
              p?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer;
            if (bodyRen?.initialSegments) {
              initialSegments = bodyRen.initialSegments;
              break;
            }
          }

          if (initialSegments.length > 0) {
            const segs: Array<{ start: number; duration: number; text: string }> = [];
            for (const item of initialSegments) {
              const seg = item?.transcriptSegmentRenderer;
              if (!seg) continue;
              const startMs = parseInt(seg.startMs || "0", 10);
              const endMs = parseInt(seg.endMs || "0", 10);
              const txt = clean(seg.snippet?.runs?.map((r: any) => r.text || "").join("") || "");
              if (txt) {
                segs.push({
                  start: startMs / 1000,
                  duration: Math.max(0.5, (endMs - startMs) / 1000),
                  text: txt,
                });
              }
            }
            if (segs.length > 0) {
              return { success: true, segments: segs };
            }
          }
        }
      }
    } catch (itErr) {
      console.debug("[NotesGen] Innertube API attempt error:", itErr);
    }

    // ---------------------------------------------------------
    // Tier 4: Native DOM Simulation (Click 'Show transcript', scrape cues, close)
    // ---------------------------------------------------------
    try {
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
        const segs = extractDomSegments();
        if (segs.length > 0) {
          if (openedByScript) {
            const closeBtn = document.querySelector<HTMLElement>(
              "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] #visibility-button button, " +
              "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript'] button[aria-label*='Close' i]"
            );
            if (closeBtn) closeBtn.click();
          }
          return { success: true, segments: segs };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (domErr) {
      console.debug("[NotesGen] DOM simulation error:", domErr);
    }

    return {
      success: false,
      error:
        "Could not load captions for this video. If captions are available, click 'Show transcript' under the video description on YouTube and try generating again.",
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Self-contained Main-World function to extract video metadata.
 */
function mainWorldVideoInfoExtractor(): {
  success: boolean;
  info?: VideoInfo;
  error?: string;
} {
  try {
    const player = document.getElementById("movie_player") as any;
    let details: any = null;
    if (player && typeof player.getVideoData === "function") {
      try {
        const vd = player.getVideoData();
        if (vd) {
          details = {
            videoId: vd.video_id,
            title: vd.title,
            author: vd.author,
          };
        }
      } catch {}
    }

    const videoEl = document.querySelector("video") as HTMLVideoElement | null;
    const durationSec = videoEl && !isNaN(videoEl.duration) ? videoEl.duration : 0;

    const urlParams = new URLSearchParams(window.location.search);
    let videoId = details?.videoId || urlParams.get("v") || "";
    if (!videoId) {
      const match = window.location.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (match) videoId = match[1];
    }

    let title = details?.title;
    if (!title) {
      const titleEl = document.querySelector(
        "h1.ytd-watch-metadata, #container > h1 > yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string"
      );
      title = titleEl?.textContent?.trim() || document.title.replace(/- YouTube$/, "").trim();
    }

    let author = details?.author;
    if (!author) {
      const authorEl = document.querySelector(
        "#channel-name a, ytd-channel-name a, #owner-sub-count, #upload-info a, ytd-video-owner-renderer a"
      );
      author = authorEl?.textContent?.trim() || "YouTube Creator";
    }

    return {
      success: true,
      info: {
        videoId,
        title,
        durationSec,
        author,
        hasCaptions: true,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Ensure content script is running; inject if needed.
 */
export async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) return false;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, async (res) => {
      if (!chrome.runtime.lastError && res?.pong) {
        resolve(true);
        return;
      }

      // Not responding: inject standalone IIFE content.js
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        setTimeout(() => resolve(true), 200);
      } catch (err) {
        console.warn("[NotesGen] Could not inject content script:", err);
        resolve(false);
      }
    });
  });
}

/**
 * Retrieve video metadata with dual-path fallback.
 */
export async function getVideoInfoWithFallback(tabId: number): Promise<VideoInfo | null> {
  // Try Content Script first
  const injected = await ensureContentScriptInjected(tabId);
  if (injected) {
    const res = await new Promise<{ success: boolean; info?: VideoInfo }>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "GET_VIDEO_INFO" }, (response) => {
        if (!chrome.runtime.lastError && response?.success && response.info) {
          resolve(response);
        } else {
          resolve({ success: false });
        }
      });
    });
    if (res.success && res.info) {
      return res.info;
    }
  }

  // Fallback to Main World execution
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: mainWorldVideoInfoExtractor,
    });
    const mainResult = results?.[0]?.result;
    if (mainResult?.success && mainResult.info) {
      return mainResult.info;
    }
  } catch (err) {
    console.debug("[NotesGen] Main world video info fallback error:", err);
  }

  return null;
}

/**
 * Retrieve captions/transcript with dual-path fallback.
 */
export async function getTranscriptWithFallback(tabId: number): Promise<Segment[]> {
  // Step 1: Try Content Script messaging
  const injected = await ensureContentScriptInjected(tabId);
  if (injected) {
    const msgRes = await new Promise<{ success: boolean; segments?: Segment[]; error?: string }>(
      (resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "FETCH_TRANSCRIPT" }, (res) => {
          if (!chrome.runtime.lastError && res) {
            resolve(res);
          } else {
            resolve({
              success: false,
              error: chrome.runtime.lastError?.message || "Content script disconnected",
            });
          }
        });
      }
    );

    if (msgRes.success && msgRes.segments && msgRes.segments.length > 0) {
      return msgRes.segments;
    }
  }

  // Step 2: Direct fallback to Main World execution (no CSP, direct access to movie_player)
  try {
    const scriptResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: mainWorldTranscriptExtractor,
    });

    const mainRes = scriptResults?.[0]?.result;
    if (mainRes?.success && mainRes.segments && mainRes.segments.length > 0) {
      return mainRes.segments;
    }

    if (mainRes?.error) {
      throw new Error(mainRes.error);
    }
  } catch (err: any) {
    if (err?.message && !err.message.includes("Could not establish connection")) {
      throw err;
    }
  }

  throw new Error("No captions found for this video. Captions may be disabled by the creator.");
}
