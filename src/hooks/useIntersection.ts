import { useEffect, useRef } from "react";

/**
 * Observe a sentinel element and run `onIntersect` when it enters the viewport.
 * Attach the returned ref to an (invisible) element at the bottom of a list to
 * trigger loading the next page. `rootMargin` fires 200px early so the next
 * page is fetched before the user reaches the bottom.
 */
export function useIntersection<T extends HTMLElement = HTMLDivElement>(
  onIntersect: () => void,
  enabled: boolean,
) {
  const ref = useRef<T | null>(null);

  // Keep the latest callback without re-subscribing the observer every render.
  const callbackRef = useRef(onIntersect);
  useEffect(() => {
    callbackRef.current = onIntersect;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) callbackRef.current();
      },
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}
