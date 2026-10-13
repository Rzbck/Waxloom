import { useEffect, useRef } from "react";

export type NavigationSection<T extends string = string> = { id: T; label: string };

export function MobileNavigation<T extends string>({
  open,
  current,
  items,
  onClose,
  onNavigate,
}: {
  open: boolean;
  current: T;
  items: NavigationSection<T>[];
  onClose: () => void;
  onNavigate: (id: T) => void;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusables = [...containerRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (focusables.length < 2) return;
      if (event.shiftKey && document.activeElement === focusables[0]) {
        event.preventDefault();
        focusables[focusables.length - 1]?.focus();
      } else if (!event.shiftKey && document.activeElement === focusables[focusables.length - 1]) {
        event.preventDefault();
        focusables[0]?.focus();
      }
    };
    // A rotated phone / resized browser must never leave an invisible modal
    // locking the desktop scroll.
    const onResize = () => { if (window.innerWidth > 820) onClose(); };
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section ref={containerRef} className="waxloom-mobile-navigation"
      role="dialog" aria-modal="true" aria-label="Waxloom navigation">
      <header>
        <strong>Waxloom</strong>
        <button ref={closeRef} type="button" aria-label="Close navigation" onClick={onClose}>Close <span aria-hidden="true">✕</span></button>
      </header>
      <nav aria-label="Mobile music sections">
        {items.map((item) => (
          <button type="button" key={item.id}
            aria-current={current === item.id ? "page" : undefined}
            className={current === item.id ? "is-current" : ""}
            onClick={() => onNavigate(item.id)}>
            <span>{item.label}</span>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </nav>
    </section>
  );
}
