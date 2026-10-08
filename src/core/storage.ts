/**
 * Local storage & caching management for NotesGenerator Chrome Extension.
 *
 * Uses chrome.storage.local when in extension context, falling back to
 * localStorage in browser dev preview.
 */

import { ProcessedNotesPayload } from "./schemas";

export type LLMProvider = "gemini" | "openrouter";

export interface ExtensionSettings {
  provider?: LLMProvider;
  apiKey: string;
  openRouterApiKey?: string;
  model: string;
  openRouterModel?: string;
  windowSeconds: number;
  customPrompt?: string;
  autoCaptureSlides?: boolean;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: "gemini",
  apiKey: "",
  openRouterApiKey: "",
  model: "gemini-2.5-flash",
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  windowSeconds: 300,
  customPrompt: "",
  autoCaptureSlides: true,
};

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function getSettings(): Promise<ExtensionSettings> {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["settings"], (result) => {
        resolve({
          ...DEFAULT_SETTINGS,
          ...(result.settings || {}),
        });
      });
    });
  }

  // Fallback for dev mode
  try {
    const raw = localStorage.getItem("notes_gen_settings");
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const updated: ExtensionSettings = { ...current, ...settings };

  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ settings: updated }, () => resolve());
    });
  } else {
    localStorage.setItem("notes_gen_settings", JSON.stringify(updated));
  }

  return updated;
}

export async function getCachedNotes(videoId: string): Promise<ProcessedNotesPayload | null> {
  if (!videoId) return null;
  const key = `notes_${videoId}`;

  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result: Record<string, unknown>) => {
        resolve((result[key] as ProcessedNotesPayload) || null);
      });
    });
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveCachedNotes(payload: ProcessedNotesPayload): Promise<void> {
  const videoId = payload.video.id;
  if (!videoId) return;
  const key = `notes_${videoId}`;

  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [key]: payload }, () => resolve());
    });
  } else {
    localStorage.setItem(key, JSON.stringify(payload));
  }
}

export interface CachedNoteSummary {
  videoId: string;
  title: string;
  durationSec: number;
  sectionsCount: number;
}

export async function listCachedNotes(): Promise<CachedNoteSummary[]> {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const summaries: CachedNoteSummary[] = [];
        for (const [k, v] of Object.entries(items)) {
          if (k.startsWith("notes_") && v && (v as ProcessedNotesPayload).video) {
            const payload = v as ProcessedNotesPayload;
            summaries.push({
              videoId: payload.video.id,
              title: payload.video.title,
              durationSec: payload.video.duration_sec,
              sectionsCount: payload.key_points?.length || 0,
            });
          }
        }
        resolve(summaries);
      });
    });
  }
  return [];
}

export async function deleteCachedNote(videoId: string): Promise<void> {
  const key = `notes_${videoId}`;
  if (hasChromeStorage()) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove([key], () => resolve());
    });
  } else {
    localStorage.removeItem(key);
  }
}
