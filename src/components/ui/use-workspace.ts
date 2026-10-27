"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceData } from "@/lib/types";
import { useHydrated } from "./use-hydrated";

export function useWorkspace(initialData: WorkspaceData) {
  const ready = useHydrated();
  const [data, setData] = useState(initialData);
  const [connectionError, setConnectionError] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const etag = useRef<string | null>(null);
  const load = useCallback(async (force: boolean) => {
    while (inFlight.current) { await inFlight.current; if (!force) return; }
    const task = (async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", headers: !force && etag.current ? { "If-None-Match": etag.current } : {} });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (response.status === 304) { setConnectionError(false); return; }
        if (!response.ok) throw new Error("Refresh failed");
        setData(await response.json()); etag.current = response.headers.get("etag"); setConnectionError(false);
      } catch { setConnectionError(true); }
    })();
    inFlight.current = task;
    try { await task; } finally { if (inFlight.current === task) inFlight.current = null; }
  }, []);
  const refresh = useCallback(() => load(true), [load]);
  useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden) void load(false); }, 5000);
    const onVisibility = () => { if (!document.hidden) void load(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [load]);
  return { data, refresh, connectionError, ready };
}
