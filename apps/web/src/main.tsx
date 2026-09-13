import React from "react";
import ReactDOM from "react-dom/client";

import "./browser-cache-v8";
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
import "./mobile-hotfix.css";
import "./discovery-icons-hotfix.css";
import "./layout-polish-v4.css";
import "./icon-centering-v5.css";
import "./discovery-shelf-stability-v6.css";
import "./player-clearance-v7.css";
import "./sidebar-fixed-v8.css";
import "./discovery-bad-source-v9.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerProvider>
      <App />
    </PlayerProvider>
  </React.StrictMode>,
);
