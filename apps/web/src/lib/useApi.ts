import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from './api';

export interface Loadable<T> {
  data: T | undefined;
  error: ApiRequestError | Error | undefined;
  loading: boolean;
  reload: () => void;
}

export interface ResourceOptions {
  /** Keep the previous rows visible while a new path loads (a filter change, for example). */
  keepPrevious?: boolean;
}

/** Fetch a resource, with an explicit loading and error state for the UI. */
export function useResource<T>(path: string | null, deps: unknown[] = [], options: ResourceOptions = {}): Loadable<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiRequestError | Error | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [nonce, setNonce] = useState(0);
  const active = useRef(true);
  const keepPrevious = options.keepPrevious === true;
  const lastPath = useRef<string | null>(path);

  useEffect(() => {
    active.current = true;
    if (path === null) {
      setLoading(false);
      return () => {
        active.current = false;
      };
    }
    setLoading(true);
    // A different path means different rows: drop the old ones unless asked to
    // keep them under a loading bar. A plain reload keeps what is shown.
    if (!keepPrevious && lastPath.current !== path) setData(undefined);
    lastPath.current = path;
    api
      .get<T>(path)
      .then((result) => {
        if (!active.current) return;
        setData(result);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (active.current) setLoading(false);
      });
    return () => {
      active.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

/** Subscribe to the server's change feed so lists refresh after a background commit. */
export function useChangeFeed(onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const source = new EventSource('/api/events/stream');
    let timer: number | undefined;
    source.addEventListener('change', () => {
      // Coalesce bursts of events into a single refresh.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => handler.current(), 250);
    });
    source.onerror = () => {
      /* the browser retries on its own; polling the list still works */
    };
    return () => {
      window.clearTimeout(timer);
      source.close();
    };
  }, []);
}
