import { useEffect } from "react";

export function useKeyboardShortcuts(
  onNavigate: (page: string) => void,
  onToggleShortcuts?: () => void,
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // "?" or F10 → toggle shortcuts overlay
      if (e.key === "?" || e.key === "F10") {
        e.preventDefault();
        onToggleShortcuts?.();
        return;
      }

      const map: Record<string, string> = {
        F1: "chat",
        F2: "voice",
        F3: "personas",
        F4: "compose-mode",
        F5: "imagine-mode",
        F6: "media",
        F7: "admin",
        F8: "daw-ai",
        F9: "instruments",
      };

      const page = map[e.key];
      if (!page) return;
      e.preventDefault();
      onNavigate(page);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNavigate, onToggleShortcuts]);
}
