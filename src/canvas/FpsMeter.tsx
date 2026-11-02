import { Panel } from "@xyflow/react";
import { useEffect, useState } from "react";

/** Frame-time readout for the `?stress=` budget check (target: p95 <= 32 ms). */
export function FpsMeter({ itemCount }: { itemCount: number }) {
  const [stats, setStats] = useState({ fps: 0, p95: 0 });

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let samples: number[] = [];
    let lastReport = last;
    const tick = (now: number) => {
      samples.push(now - last);
      last = now;
      if (now - lastReport > 1000) {
        const sorted = [...samples].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        setStats({
          fps: Math.round((samples.length * 1000) / (now - lastReport)),
          p95: Math.round(p95 * 10) / 10,
        });
        samples = [];
        lastReport = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Panel position="top-right" className={`fps-meter${stats.p95 > 32 ? " is-over" : ""}`}>
      {itemCount} öğe · {stats.fps} fps · p95 {stats.p95} ms
    </Panel>
  );
}
