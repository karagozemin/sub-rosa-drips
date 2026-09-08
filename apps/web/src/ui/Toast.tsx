// Copyright (c) 2026 Sub Rosa contributors
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTime } from "../lib/time";

export type ToastTone = "info" | "working" | "success" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, title: string, detail?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: "i",
  working: <span className="toast-spinner" aria-hidden="true" />,
  success: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <motion.path
        d="M4 12.5l5 5L20 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </svg>
  ),
  error: "!",
};

const TONE_DURATION: Record<ToastTone, number> = {
  info: 5000,
  working: 0,
  success: 5000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { scheduler } = useTime();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = `toast-${++seq.current}`;
      setItems((prev) => [{ id, tone, title, detail }, ...prev].slice(0, 4));
      const ttl = TONE_DURATION[tone];
      if (ttl > 0) scheduler.setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss, scheduler],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`toast toast-${item.tone}`}
            >
              <span className="toast-icon" aria-hidden="true">
                {TONE_ICON[item.tone]}
              </span>
              <div className="toast-body">
                <strong>{item.title}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <button
                type="button"
                className="toast-close"
                aria-label={`Dismiss: ${item.title}`}
                onClick={() => dismiss(item.id)}
              >
                ×
              </button>
              {TONE_DURATION[item.tone] > 0 ? (
                <motion.i
                  key={`${item.id}-bar`}
                  className="toast-bar"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: TONE_DURATION[item.tone] / 1000, ease: "linear" }}
                />
              ) : (
                <i className="toast-bar toast-bar-indeterminate" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
