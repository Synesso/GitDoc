"use client";

import { useState, useEffect } from "react";

/**
 * Returns whether the given CSS media query currently matches.
 *
 * On the server (SSR), returns `false` to avoid hydration mismatches —
 * use CSS-only hiding (`hidden md:block` / `md:hidden`) for the initial
 * render to prevent layout flash.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
