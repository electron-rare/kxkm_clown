import { useCallback, useEffect, useState } from "react";

export interface HashRoute {
  page: string;
  id: string;
}

function parseHash(hash: string, defaultPage = "chat"): HashRoute {
  const normalized = hash.replace(/^#\/?/, "");
  if (!normalized) return { page: defaultPage, id: "" };
  const parts = normalized.split("/");
  const page = parts[0] || defaultPage;
  const id = parts.slice(1).join("/");
  return { page, id };
}

export function useHashRoute(defaultPage = "chat") {
  const [route, setRoute] = useState<HashRoute>(() =>
    typeof window !== "undefined" ? parseHash(window.location.hash, defaultPage) : { page: defaultPage, id: "" },
  );

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash, defaultPage));
    }

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [defaultPage]);

  const navigate = useCallback((page: string, id?: string) => {
    const next = id ? `${page}/${id}` : page;
    setRoute(parseHash(`#${next}`, defaultPage));
    window.location.hash = next;
  }, [defaultPage]);

  return { route, navigate };
}
