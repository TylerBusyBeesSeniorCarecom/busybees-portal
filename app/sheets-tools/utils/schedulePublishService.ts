"use client";

export type PublishAction = "publishCurrentWeek" | "publishNextWeek" | "ping";

export interface PublishResponse {
  status: "success" | "error";
  action?: string;
  message?: string;
  step?: string;
  elapsedMs?: number;
  timestamp?: string;
}

export type PublishResult =
  | { ok: true; response: PublishResponse }
  | { ok: false; error: string; step?: string };

const TIMEOUT_MS = 180_000;

function buildPublishError(prefix: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return prefix;
  return `${prefix}: ${trimmed.slice(0, 200)}`;
}

function formatUnknownError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err instanceof Event) return `Unexpected ${err.type || "event"} event`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function publish(action: PublishAction): Promise<PublishResult> {
  const url = process.env.NEXT_PUBLIC_PUBLISH_WEBHOOK_URL;
  const token = process.env.NEXT_PUBLIC_PUBLISH_API_TOKEN;

  if (!url || !token) {
    return { ok: false, error: "Publish webhook not configured" };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, action }),
      signal: controller.signal,
    });

    window.clearTimeout(timeoutId);
    const rawBody = await res.text();

    let parsed: PublishResponse;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return {
        ok: false,
        error: buildPublishError("Couldn't parse response", rawBody),
      };
    }

    if (parsed.status === "success") {
      return { ok: true, response: parsed };
    }

    if ((parsed.message || "").toLowerCase() === "unauthorized") {
      return { ok: false, error: "Unauthorized. Token mismatch — check env vars." };
    }

    return {
      ok: false,
      error: parsed.message || "Unknown server error",
      step: parsed.step,
    };
  } catch (err) {
    window.clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error:
          "Timed out after 3 minutes. The publish may still be running — check the sheet's Last Published cell in a minute.",
      };
    }
    return {
      ok: false,
      error: formatUnknownError(err),
    };
  }
}

export async function ping(): Promise<PublishResult> {
  return publish("ping");
}
