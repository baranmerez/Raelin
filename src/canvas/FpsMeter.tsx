import { Panel } from "@xyflow/react";
import { useEffect, useState } from "react";

interface Stats {
  fps: number;
  p95: number;
  worst: number;
  longTasks: number;
  blocked: number;
}

/**
 * Frame-time readout for the `?stress=` budget check (target: p95 <= 32 ms).
 * fps alone hides stutter: a steady 120 fps with a few 200 ms frames still feels
 * janky, so the worst frame and main-thread long tasks are shown per second too.
 */
export function FpsMeter({ itemCount }: { itemCount: number }) {
  const [stats, setStats] = useState<Stats>({ fps: 0, p95: 0, worst: 0, longTasks: 0, blocked: 0 });

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let samples: number[] = [];
    let lastReport = last;
    let longTasks = 0;
    let blocked = 0;

    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks++;
          blocked += entry.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      // Long Task API is Chromium-only; WebView2 supports it.
    }

    const round = (n: number) => Math.round(n * 10) / 10;
    const tick = (now: number) => {
      samples.push(now - last);
      last = now;
      if (now - lastReport > 1000) {
        const sorted = [...samples].sort((a, b) => a - b);
        setStats({
          fps: Math.round((samples.length * 1000) / (now - lastReport)),
          p95: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          worst: round(sorted.at(-1) ?? 0),
          longTasks,
          blocked: Math.round(blocked),
        });
        samples = [];
        longTasks = 0;
        blocked = 0;
        lastReport = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  const over = stats.p95 > 32 || stats.worst > 100;
  return (
    <Panel position="top-right" className={`fps-meter${over ? " is-over" : ""}`}>
      <div>
        {itemCount} öğe · {stats.fps} fps
      </div>
      <div>
        p95 {stats.p95} ms · en kötü {stats.worst} ms
      </div>
      <div>
        uzun görev {stats.longTasks} · bloke {stats.blocked} ms/sn
      </div>
    </Panel>
  );
}
