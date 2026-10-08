import React from "react";
import ReactDOM from "react-dom/client";
import { ExportView } from "./ExportView";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ExportView />
    </React.StrictMode>
  );
}
