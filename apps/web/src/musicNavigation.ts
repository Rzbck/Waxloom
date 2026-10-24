import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { View } from "./types";

/** Browser-native navigation; hash routes work behind the existing Nginx
 * proxy and on Safari/iPhone PWA without a new server-side route handler.
 * The media player is NOT coupled to history and keeps playing.
 */
export type ImportLocation =
  | { kind: "search" }
  | { kind: "channel"; channelId: string }
  | { kind: "album"; albumId: string; channelId?: string };

export type MusicRoute = {
  view: View;
  detail?: { kind: "album" | "artist" | "playlist"; id: string };
  query?: string;
  importLocation?: ImportLocation;
};

export const BASE_ROUTE: MusicRoute = { view: "home" };
const VIEWS = new Set<View>([
  "home", "albums", "artists", "playlists", "favorites",
  "discovery", "imports", "search",
]);
const LIMIT = 320;

function encode(value: string) {
  return encodeURIComponent(value.trim().slice(0, LIMIT));
}
function decode(value: string): string | null {
  try {
    const parsed = decodeURIComponent(value);
    return parsed && parsed.length <= LIMIT && !/[\u0000-\u001f]/.test(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
export function routeHash(route: MusicRoute): string {
  if (route.view === "search") return `#/search/${encode(route.query || "")}`;
  if (route.view === "imports") {
    const sub = route.importLocation;
    if (sub?.kind === "channel") return `#/imports/channel/${encode(sub.channelId)}`;
    if (sub?.kind === "album") {
      return sub.channelId
        ? `#/imports/channel/${encode(sub.channelId)}/album/${encode(sub.albumId)}`
        : `#/imports/album/${encode(sub.albumId)}`;
    }
  }
  const detail = route.detail;
  if (detail) return `#/${route.view}/${encode(detail.id)}`;
  return `#/${route.view}`;
}
export function parseRouteHash(hash: string): MusicRoute {
  if (!hash.startsWith("#/")) return BASE_ROUTE;
  const [rawView, ...rest] = hash.slice(2).split("/");
  if (!VIEWS.has(rawView as View)) return BASE_ROUTE;
  const view = rawView as View;
  if (view === "search") return { view, query: decode(rest[0] || "") ?? "" };
  if (view === "imports") {
    if (rest[0] === "channel" && rest[1]) {
      const channelId = decode(rest[1]);
      if (channelId && rest[2] === "album" && rest[3]) {
        const albumId = decode(rest[3]);
        if (albumId) return { view, importLocation: { kind: "album", albumId, channelId } };
      }
      if (channelId) return { view, importLocation: { kind: "channel", channelId } };
    }
    if (rest[0] === "album" && rest[1]) {
      const albumId = decode(rest[1]);
      if (albumId) return { view, importLocation: { kind: "album", albumId } };
    }
    return { view, importLocation: { kind: "search" } };
  }
  const detailKind = ({ albums: "album", artists: "artist", playlists: "playlist" } as const)[view as "albums" | "artists" | "playlists"];
  if (detailKind && rest[0]) {
    const id = decode(rest[0]);
    if (id) return { view, detail: { kind: detailKind, id } };
  }
  return { view };
}
interface HistoryEntry {
  waxloomNavigation: 1;
  index: number;
  route: MusicRoute;
  scrollY: number;
}
function isEntry(input: unknown): input is HistoryEntry {
  if (!input || typeof input !== "object") return false;
  const value = input as Partial<HistoryEntry>;
  return value.waxloomNavigation === 1 && Number.isSafeInteger(value.index)
    && value.index! >= 0 && typeof value.scrollY === "number"
    && value.route != null && typeof value.route.view === "string"
    && VIEWS.has(value.route.view);
}
function createInitialEntry(): HistoryEntry {
  const parsed = parseRouteHash(window.location.hash);
  const saved = window.history.state as unknown;
  const initial: HistoryEntry = isEntry(saved) && routeHash(saved.route) === routeHash(parsed)
    ? saved : { waxloomNavigation: 1, index: 0, route: parsed, scrollY: 0 };
  window.history.replaceState(initial, "", routeHash(initial.route));
  return initial;
}

export function useMusicNavigation() {
  const [entry, setEntry] = useState<HistoryEntry>(createInitialEntry);
  const entryRef = useRef(entry);
  const maxIndexRef = useRef(entry.index);
  const restoreScrollRef = useRef(false);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [available, setAvailable] = useState({ back: entry.index > 0, forward: false });

  const push = useCallback((route: MusicRoute) => {
    const current = entryRef.current;
    if (routeHash(route) === routeHash(current.route)) return;
    const scrollY = Math.max(0, window.scrollY);
    const previous = { ...current, scrollY };
    window.history.replaceState(previous, "", routeHash(current.route));
    const next: HistoryEntry = {
      waxloomNavigation: 1, index: current.index + 1, route, scrollY: 0,
    };
    // pushState (not location.assign) preserves audio and avoids reloading.
    window.history.pushState(next, "", routeHash(route));
    entryRef.current = next;
    maxIndexRef.current = next.index; // Drop stale forward stack after navigation.
    restoreScrollRef.current = true;
    setEntry(next);
    setAvailable({ back: true, forward: false });
    setScrollNonce((value) => value + 1);
  }, []);

  const back = useCallback(() => {
    if (entryRef.current.index > 0) window.history.back();
    else if (entryRef.current.route.detail)
      push({ view: entryRef.current.route.view });
    else if (entryRef.current.route.importLocation?.kind !== "search"
      && entryRef.current.route.view === "imports")
      push({ view: "imports", importLocation: { kind: "search" } });
  }, [push]);

  const forward = useCallback(() => {
    if (entryRef.current.index < maxIndexRef.current) window.history.forward();
  }, []);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const onPop = (event: PopStateEvent) => {
      const restored: HistoryEntry = isEntry(event.state)
        ? event.state : {
          waxloomNavigation: 1,
          index: 0,
          route: parseRouteHash(window.location.hash),
          scrollY: 0,
        };
      entryRef.current = restored;
      maxIndexRef.current = Math.max(maxIndexRef.current, restored.index);
      restoreScrollRef.current = true;
      setEntry(restored);
      setAvailable({
        back: restored.index > 0,
        forward: restored.index < maxIndexRef.current,
      });
      setScrollNonce((value) => value + 1);
    };
    window.addEventListener("popstate", onPop);
    // Native Safari edge-swipe, mouse Back/Forward and toolbar buttons can
    // all leave without going through push(). Save the current screen's
    // position as the user scrolls so Forward restores it too.
    let scrollFrame: number | null = null;
    const onScroll = () => {
      if (scrollFrame !== null) return;
      const expected = entryRef.current.index;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (entryRef.current.index !== expected) return;
        const next = { ...entryRef.current, scrollY: Math.max(0, window.scrollY) };
        entryRef.current = next;
        window.history.replaceState(next, "", routeHash(next.route));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const onPageHide = () => {
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
      const next = { ...entryRef.current, scrollY: Math.max(0, window.scrollY) };
      window.history.replaceState(next, "", routeHash(next.route));
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    if (!restoreScrollRef.current) return;
    restoreScrollRef.current = false;
    const target = entry.scrollY;
    // Restore after React paints; retry after detail/skeleton/layout settles.
    const raf = window.requestAnimationFrame(() => window.scrollTo({ top: target }));
    const later = window.setTimeout(() => {
      if (entryRef.current.index === entry.index) window.scrollTo({ top: target });
    }, 180);
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(later); };
  }, [entry.index, scrollNonce]);

  return {
    route: entry.route,
    push, back, forward,
    canBack: available.back,
    canForward: available.forward,
  };
}
