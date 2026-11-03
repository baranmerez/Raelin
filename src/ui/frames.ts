/**
 * The next paint, or a short timeout when there is none: a hidden or minimized window
 * gets no animation frames, and an AI tool waiting on one would hang forever.
 */
export function nextFrame(fallbackMs = 50): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, fallbackMs);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** True while the window is on screen; animations only make sense then. */
export function isVisible(): boolean {
  return document.visibilityState === "visible";
}

/** Resolves with the promise's value, or with `fallback` after `ms`. */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
