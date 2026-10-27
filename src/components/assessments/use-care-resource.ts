"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Bounded, visibility-aware read. A response for a previous patient is never rendered. */
export function useCareResource<T>(url: string, enabled = true, initial?: { url: string; data: T }) {
  const [state, setState] = useState<{ url: string; data?: T; error: string; loading: boolean }>({ url: initial?.url ?? url, data: initial?.data, error: "", loading: !initial });
  const cached = useRef<{ url: string; data: T; etag: string | null } | null>(initial ? { ...initial, etag: null } : null);
  const current = useRef<AbortController | null>(null);
  const load = useCallback(async (force = true) => {
    if (!enabled || (!force && current.current)) return;
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setState(old => ({ url, data: old.url === url ? old.data : undefined, error: "", loading: true }));
    try {
      const version = !force && cached.current?.url === url ? cached.current : null;
      const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers: version?.etag ? { "If-None-Match": version.etag } : {} });
      if (response.status === 304 && version) { if (!controller.signal.aborted) setState({ url, data: version.data, error: "", loading: false }); return; }
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null); const message = body?.error ?? "Не удалось обновить данные. Попробуйте ещё раз.";
        if (response.status === 403 || response.status === 404) { cached.current = null; if (!controller.signal.aborted) setState({ url, error: message, loading: false }); return; }
        throw new Error(message);
      }
      const data: T = await response.json();
      if (!controller.signal.aborted) { cached.current = { url, data, etag: response.headers.get("etag") }; setState({ url, data, error: "", loading: false }); }
    } catch (error) {
      if (!controller.signal.aborted) setState(old => ({ url, data: old.url === url ? old.data : undefined, error: error instanceof TypeError ? "Нет связи с сервером. Показаны последние загруженные данные." : (error as Error).message, loading: false }));
    } finally { if (current.current === controller) current.current = null; }
  }, [url, enabled]);
  useEffect(() => {
    if (!enabled) return;
    void load(false);
    const update = () => { if (!document.hidden) void load(false); };
    const timer = setInterval(update, 5000); document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); current.current?.abort(); current.current = null; };
  }, [load, enabled]);
  const refresh = useCallback(() => load(), [load]);
  return { data: state.url === url ? state.data : undefined, error: state.url === url ? state.error : "", loading: state.url !== url || state.loading, refresh };
}
