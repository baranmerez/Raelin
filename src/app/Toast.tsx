import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useBoardStore } from "../state/boardStore";

export function Toast() {
  const toast = useBoardStore((s) => s.toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), toast.tone === "error" ? 6000 : 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-host" aria-live="polite">
      <AnimatePresence>
        {visible && toast && (
          <motion.div
            key={toast.id}
            className={`toast is-${toast.tone}`}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
