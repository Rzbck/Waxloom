import React from "react";
import ReactDOM from "react-dom/client";

import "./browser-cache-v8";
import "./versionUpdate";

import "./preview-request-budget-v10";
import App from "./App";
import { PlayerProvider } from "./Player";
import "./style-foundation.css";
import "./style-library-controls.css";
import "./style-responsive.css";
import "./style-discovery.css";
import "./style-mobile-player.css";
import "./style-vinyl-library.css";
import "./style-artwork.css";
import "./style-console.css";
import "./faviconAnimation";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerProvider>
      <App />
    </PlayerProvider>
  </React.StrictMode>,
);
