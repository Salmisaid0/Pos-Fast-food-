import { createRoot } from "react-dom/client";

import { App } from "./App";
import { PosErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element for POS desktop app");
}

createRoot(rootElement).render(
  <PosErrorBoundary>
    <App />
  </PosErrorBoundary>
);
