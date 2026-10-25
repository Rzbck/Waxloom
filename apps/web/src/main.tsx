import React from "react";
import ReactDOM from "react-dom/client";

import "./browser-cache-v8";
import "./versionUpdate";
import "./home-compact.css";

import "./preview-request-budget-v10";
import App from "./App";
import { PlayerProvider } from "./Player";
import "./styles.css";
import "./performance.css";
import "./discovery-auto.css";
import "./discovery-v2.css";
import "./discovery-v3.css";
import "./polish.css";
import "./icons.css";
import "./mobile.css";
import "./navigation-history.css";
import "./mobile-hotfix.css";
import "./ui-control-polish.css";
import "./layout-stability.css";
import "./discovery-bad-source-v9.css";
import "./discovery-fit.css";
import "./mobile-shell.css";
import "./mobile-home.css";
import "./mobile-vinyl-system.css";
import "./vinyl-unified.css";
import "./vinyl-focus.css";
import "./music-metadata.css";
import "./home-radio.css";
import "./vinyl-center-motion.css";
import "./library-grids.css";
import "./instant-artwork.css";
import "./cover-editorial.css";
import "./pixel-covers.css";
import "./youtube-art.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerProvider>
      <App />
    </PlayerProvider>
  </React.StrictMode>,
);
