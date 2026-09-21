import { useEffect, useRef } from "react";

import {
  PARALLAX_VERTICAL_DAMPING,
  approach,
  pointerOffset,
  scrollProgress,
  settled,
} from "@/lib/parallax";

/**
 * Drive a parallax scene from the pointer and the scroll position, without
 * React ever hearing about it.
 *
 * REACT IS NOT IN THE LOOP, AND THAT IS THE WHOLE DESIGN. A `setState` per
 * `pointermove` re-renders the hero sixty times a second to move five pictures
 * by eight pixels — the greeting, the icon and the streak get reconciled for a
 * decoration. Instead the hook writes three custom properties on one element
 * and lets the compositor do the rest: `--parallax-x`, `--parallax-y` and
 * `--parallax-drift`, all unitless, all read by `.today-hero-layer`'s single
 * `translate3d`. Nothing above this node ever re-renders, and nothing below it
 * changes layout.
 *
 * THE LOOP IS NOT ALWAYS RUNNING. It starts when something moves and stops the
 * moment every value is within a fortieth of a pixel of where it is going
 * (`settled`), so a hero nobody is pointing at costs nothing. It also stops
 * outright when the hero scrolls out of the viewport (§15) and never starts at
 * all under `prefers-reduced-motion: reduce` (§14) — reduced motion turns the
 * effect OFF rather than down, and the matching CSS pins `transform: none` so
 * the two cannot disagree.
 *
 * TOUCH IS NOT TRACKED. The handler bails on any pointer that is not a mouse,
 * every listener is passive and nothing ever calls `preventDefault`, so a
 * finger on a phone scrolls the page exactly as it would with no hero at all
 * (§13). A phone still gets the scroll drift, which costs it no interaction.
 *
 * Everything browser-shaped happens in the effect, after mount: no `matchMedia`
 * during render, no `scrollY` read on the server, so the first client paint is
 * identical to the server's and the layers start at dead centre (§30, §31).
 */
export function useParallaxMotion<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

    let frame = 0;
    let visible = false;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let drift = 0;

    const write = () => {
      node.style.setProperty("--parallax-x", currentX.toFixed(4));
      node.style.setProperty("--parallax-y", currentY.toFixed(4));
      node.style.setProperty("--parallax-drift", drift.toFixed(4));
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const tick = () => {
      frame = 0;

      // Read once per frame rather than caching on scroll and resize: we only
      // ever animate `transform`, so layout is never dirty when this runs and
      // the read comes out of the cache.
      const box = node.getBoundingClientRect();
      const nextDrift = scrollProgress(box.top, box.height);

      const done =
        settled(currentX, targetX) && settled(currentY, targetY) && drift === nextDrift;

      if (done) {
        // Land exactly on the target instead of leaving the last sub-pixel of
        // an approach that never arrives — §11's "returns to centre" should be
        // literally true once the pointer has left.
        currentX = targetX;
        currentY = targetY;
      } else {
        currentX = approach(currentX, targetX);
        currentY = approach(currentY, targetY);
      }

      drift = nextDrift;
      write();

      if (!done) frame = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (frame || !visible || calm.matches) return;
      frame = requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      // A finger and a stylus are for scrolling and tapping, not for steering a
      // decoration. A mouse on a touchscreen laptop still gets the effect,
      // which a `(pointer: fine)` media query would have been vaguer about.
      if (event.pointerType !== "mouse" || calm.matches) return;

      const box = node.getBoundingClientRect();
      targetX = pointerOffset(event.clientX, box.left, box.width);
      targetY = pointerOffset(event.clientY, box.top, box.height) * PARALLAX_VERTICAL_DAMPING;
      wake();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      wake();
    };

    const onCalmChange = () => {
      if (!calm.matches) {
        wake();
        return;
      }
      stop();
      targetX = targetY = currentX = currentY = drift = 0;
      write();
    };

    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) wake();
      else stop();
    });

    observer.observe(node);
    node.addEventListener("pointermove", onPointerMove, { passive: true });
    node.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake, { passive: true });
    calm.addEventListener("change", onCalmChange);

    return () => {
      stop();
      observer.disconnect();
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      calm.removeEventListener("change", onCalmChange);
    };
  }, []);

  return ref;
}
