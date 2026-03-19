import React from "react";
import ReactDOM from "react-dom/client";
import { publishUiCssVariables } from "@kxkm/ui";
import App from "./App";
import "./styles.css";

if (typeof document !== "undefined") {
  publishUiCssVariables(document.documentElement.style);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
