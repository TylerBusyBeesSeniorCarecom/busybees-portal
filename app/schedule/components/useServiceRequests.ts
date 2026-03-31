"use client";

import { useEffect, useMemo, useState } from "react";

export type ServiceRequest = {
  clientName: string;
  rawDate: string;
  dateKey: string; // M/D/YYYY (NY)
  start: string;
  end: string;
  preferredCaregiver: string;
  notes: string;
  status: string; // "Pending"
  timestamp: string;
};

type ApiResponse = {
  ok: boolean;
  meta?: any;
  requests?: ServiceRequest[];
};

export function useServiceRequests() {
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/service-requests", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;

        if (!json?.ok) throw new Error(json?.meta?.error || "Failed to load service requests");

        const rows = Array.isArray(json.requests) ? json.requests : [];
        if (!cancelled) setRequests(rows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build a fast lookup: "clientName||dateKey" -> ServiceRequest[]
  const byClientDate = useMemo(() => {
    const map = new Map<string, ServiceRequest[]>();
    for (const r of requests) {
      const key = `${(r.clientName || "").trim()}||${(r.dateKey || "").trim()}`;
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [requests]);

  return { loading, error, requests, byClientDate };
}