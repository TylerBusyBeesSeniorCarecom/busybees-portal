// app/api/drive-time/route.ts
import type { NextRequest } from "next/server";

import { buildApiJsonResponse, requireAdminSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { expiresAt: number; data: any };

// ---- simple global cache (persists while server process stays alive) ----
const g = globalThis as any;
if (!g.__driveTimeCache) g.__driveTimeCache = new Map<string, CacheEntry>();
const cache: Map<string, CacheEntry> = g.__driveTimeCache;

function norm(s: string) {
  return (s ?? "").toString().trim();
}

function cacheKey(origin: string, destination: string, mode: string) {
  return `${origin.toLowerCase()}__${destination.toLowerCase()}__${mode.toLowerCase()}`;
}

export async function GET(request: NextRequest) {
  try {
    const { response } = await requireAdminSession(request);
    if (response) return response;

    const url = new URL(request.url);
    const origin = norm(url.searchParams.get("origin") || "");
    const destination = norm(url.searchParams.get("destination") || "");
    const mode = norm(url.searchParams.get("mode") || "driving") || "driving";
    const ttlMin = Number(url.searchParams.get("ttlMin") || "180"); // default 3 hours

    if (!origin || !destination) {
      return buildApiJsonResponse(
        request,
        { ok: false, error: "Missing origin or destination" },
        400
      );
    }

    const key = cacheKey(origin, destination, mode);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return buildApiJsonResponse(request, { ok: true, cached: true, ...hit.data }, 200);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return buildApiJsonResponse(
        request,
        { ok: false, error: "Missing GOOGLE_MAPS_API_KEY" },
        500
      );
    }

    const dm = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    dm.searchParams.set("origins", origin);
    dm.searchParams.set("destinations", destination);
    dm.searchParams.set("mode", mode);
    dm.searchParams.set("units", "imperial");
    dm.searchParams.set("key", apiKey);

    const r = await fetch(dm.toString(), { cache: "no-store" });
    const j = await r.json();

    if (!r.ok) {
      return buildApiJsonResponse(
        request,
        { ok: false, error: `Google Distance Matrix HTTP ${r.status}`, raw: j },
        502
      );
    }

    const row = j?.rows?.[0];
    const el = row?.elements?.[0];

    if (!el || el.status !== "OK") {
      return buildApiJsonResponse(
        request,
        { ok: false, error: `No route: ${el?.status || "UNKNOWN"}`, raw: j },
        200
      );
    }

    const seconds = Number(el.duration?.value ?? 0);
    const meters = Number(el.distance?.value ?? 0);
    const minutes = Math.round(seconds / 60);

    const data = {
      minutes,
      durationText: el.duration?.text ?? "",
      distanceText: el.distance?.text ?? "",
      mode,
      origin,
      destination,
    };

    cache.set(key, { expiresAt: now + ttlMin * 60_000, data });

    return buildApiJsonResponse(request, { ok: true, cached: false, ...data }, 200);
  } catch (e: any) {
    return buildApiJsonResponse(
      request,
      { ok: false, error: e?.message ?? "Unknown drive-time error" },
      500
    );
  }
}
