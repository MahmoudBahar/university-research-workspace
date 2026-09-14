import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'ok' | 'warn' | 'danger';

export interface ToastInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  duration?: number;
}

export interface ToastRecord extends Required<Pick<ToastInput, 'kind' | 'message' | 'duration'>> {
  id: string;
  title?: string;
  leaving: boolean;
}

interface ToastContextValue {
  toasts: ToastRecord[];
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_VISIBLE = 4;
const LEAVE_MS = 220;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, { handle: number; remaining: number; startedAt: number }>());
  const counter = useRef(0);

  const remove = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer.handle);
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setToasts((previous) => previous.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
      const timer = timers.current.get(id);
      if (timer) window.clearTimeout(timer.handle);
      timers.current.set(id, { handle: window.setTimeout(() => remove(id), LEAVE_MS), remaining: 0, startedAt: Date.now() });
    },
    [remove],
  );

  const schedule = useCallback(
    (id: string, ms: number) => {
      const handle = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, { handle, remaining: ms, startedAt: Date.now() });
    },
    [dismiss],
  );

  const toast = useCallback(
    (input: ToastInput) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      const record: ToastRecord = {
        id,
        kind: input.kind ?? 'info',
        message: input.message,
        duration: input.duration ?? (input.kind === 'danger' ? 8000 : 5000),
        leaving: false,
        ...(input.title ? { title: input.title } : {}),
      };
      setToasts((previous) => {
        const next = [...previous, record];
        const overflow = next.length - MAX_VISIBLE;
        if (overflow > 0) {
          for (const old of next.slice(0, overflow)) {
            const timer = timers.current.get(old.id);
            if (timer) window.clearTimeout(timer.handle);
            timers.current.delete(old.id);
          }
          return next.slice(overflow);
        }
        return next;
      });
      schedule(id, record.duration);
    },
    [schedule],
  );

  const pause = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer.handle);
    timers.current.set(id, { ...timer, remaining: Math.max(800, timer.remaining - (Date.now() - timer.startedAt)) });
  }, []);

  const resume = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (!timer) return;
      schedule(id, timer.remaining);
    },
    [schedule],
  );

  const value = useMemo<ToastContextValue>(() => ({ toasts, toast, dismiss, pause, resume }), [toasts, toast, dismiss, pause, resume]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): Pick<ToastContextValue, 'toast' | 'dismiss'> {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return { toast: value.toast, dismiss: value.dismiss };
}

export function useToastQueue(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToastQueue must be used inside ToastProvider');
  return value;
}
