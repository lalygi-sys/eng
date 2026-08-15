import React from "react";
import { createRoot } from "react-dom/client";

import Page from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Missing app root");

createRoot(root).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
