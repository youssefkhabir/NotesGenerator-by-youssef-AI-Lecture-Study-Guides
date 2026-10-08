import { defineConfig, build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import fs from "fs";

function chromeExtensionPlugin() {
  return {
    name: "chrome-extension-builder",
    async closeBundle() {
      // 1. Copy manifest.json
      const manifestSrc = resolve(__dirname, "manifest.json");
      const manifestDest = resolve(__dirname, "dist", "manifest.json");
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, manifestDest);
        console.log("Copied manifest.json to dist/");
      }

      // 2. Build content script as pure standalone IIFE (no ES module imports)
      console.log("Building standalone IIFE content.js...");
      await build({
        configFile: false,
        build: {
          outDir: "dist",
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, "src/content/index.ts"),
            formats: ["iife"],
            name: "NotesGeneratorContent",
            fileName: () => "content.js",
          },
        },
      });
      console.log("Built standalone IIFE dist/content.js successfully!");
    },
  };
}

export default defineConfig({
  plugins: [react(), chromeExtensionPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        background: resolve(__dirname, "src/background/index.ts"),
        export: resolve(__dirname, "export.html"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
