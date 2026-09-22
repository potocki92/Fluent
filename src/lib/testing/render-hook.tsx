import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Mount a hook, read what it returns, and unmount it — in about forty lines.
 *
 * WHY NOT A TESTING LIBRARY. Almost everything in this codebase that is worth
 * asserting on is a pure function, and those need no DOM at all. What is left
 * is small and specific: that an effect cancels its timer on unmount, that a
 * reply landing after unmount dispatches nothing, that a retry re-runs the
 * thing that failed. Those need a real React render and nothing else — no
 * queries, no user-event, no matchers. One dev dependency (`jsdom`) and this
 * file cover them, which is a smaller surface to keep working than a testing
 * stack brought in for four tests.
 *
 * `act` comes from React itself in 19, so the render is flushed the way React
 * expects and effects run before the assertions read anything.
 */
// React only enables `act` when the environment says it is a test one. Setting
// it here, rather than in a setup file, keeps the whole harness in one place.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface HookHarness<T> {
  /** What the hook returned on its most recent render. */
  readonly current: T;
  /** Re-render with new props. */
  rerender: (props?: unknown) => void;
  unmount: () => void;
  /** How many times the hook's component has rendered. */
  readonly renders: number;
}

export function renderHook<T>(useHook: (props?: never) => T): HookHarness<T> {
  const container = document.createElement("div");
  document.body.append(container);

  let root: Root;
  let latest: T;
  let renders = 0;

  function Probe(): ReactNode {
    latest = useHook();
    renders += 1;
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });

  return {
    get current() {
      return latest;
    },
    get renders() {
      return renders;
    },
    rerender() {
      act(() => {
        root.render(createElement(Probe));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * Let everything React and the microtask queue have pending settle.
 *
 * `await act(async () => {})` is the supported way to say "flush whatever the
 * effects kicked off"; wrapping it keeps that incantation in one place.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
