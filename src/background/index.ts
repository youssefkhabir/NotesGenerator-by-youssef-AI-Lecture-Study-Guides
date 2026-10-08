/**
 * Background Service Worker for NotesGenerator Chrome Extension.
 *
 * Configures Side Panel behavior so clicking the extension action
 * opens the side panel directly alongside YouTube.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("NotesGenerator installed.");
});

// Configure Side Panel to open automatically on action click
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("Failed to set side panel behavior:", err));
}
