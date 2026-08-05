import React from "react";
import ReactDOM from "react-dom/client";

import { OptionsApp } from "@/options/OptionsApp";
import "@/options/options.css";

const root = document.querySelector("#root");

if (!(root instanceof HTMLElement)) {
  throw new Error("Options page root element is missing.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
