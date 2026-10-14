/* Version-aware update checks for standalone iOS Home Screen web apps.
   Only the application shell is reloaded; music/library storage is untouched. */
const currentAsset = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.src
  .split("/").pop() ?? "";

let updatePending = false;
let lastCheck = 0;

function audioBusy(): boolean {
  return [...document.querySelectorAll<HTMLAudioElement>("audio")].some(
    (audio) => !audio.paused && !audio.ended,
  );
}

function showUpdatePrompt() {
  if (document.getElementById("waxloom-update-banner")) return;
  const banner = document.createElement("div");
  banner.id = "waxloom-update-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = '<span>Waxloom update ready</span><button type="button">Update</button>';
  banner.querySelector("button")?.addEventListener("click", () => reloadCurrent());
  document.body.appendChild(banner);
}

function reloadCurrent() {
  if (sessionStorage.getItem("waxloom-reloaded-version") === currentAsset) return;
  sessionStorage.setItem("waxloom-reloaded-version", currentAsset);
  const url = new URL(location.href);
  url.searchParams.set("_waxloom", Date.now().toString());
  location.replace(url.href);
}

async function checkForUpdates(force = false) {
  if (!currentAsset || (!force && Date.now() - lastCheck < 60000)) return;
  lastCheck = Date.now();
  try {
    const response = await fetch("/index.html?version_check=" + Date.now(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return;
    const html = await response.text();
    const match = html.match(/\/assets\/(index-[\w-]+\.js)/);
    if (!match || match[1] === currentAsset) return;
    if (updatePending) return;
    updatePending = true;
    if (audioBusy()) showUpdatePrompt();
    else reloadCurrent();
  } catch {
    // Network unavailable while walking; retry on the next foreground event.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", () => void checkForUpdates(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkForUpdates(true);
  });
  window.addEventListener("focus", () => void checkForUpdates());
  window.setInterval(() => void checkForUpdates(), 120000);
  void checkForUpdates(true);
}
