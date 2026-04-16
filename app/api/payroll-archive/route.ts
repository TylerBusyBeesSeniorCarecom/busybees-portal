// app/api/payroll-archive/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYROLL_ARCHIVE_API_URL = process.env.PAYROLL_ARCHIVE_API_URL;

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      sp.set(key, String(value));
    }
  });
  return sp.toString();
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: `Non-JSON response from Payroll Archive API (${res.status})`,
      raw: text,
    };
  }
}

export async function GET(req: Request) {
  try {
    if (!PAYROLL_ARCHIVE_API_URL) {
      return NextResponse.json(
        { ok: false, error: "Missing PAYROLL_ARCHIVE_API_URL" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const action = (url.searchParams.get("action") || "getPayrollArchive").trim();

    const query = qs({
      action,
      weekStartDate: url.searchParams.get("weekStartDate"),
      shiftId: url.searchParams.get("shiftId"),
    });

    const targetUrl = `${PAYROLL_ARCHIVE_API_URL}?${query}`;

    const res = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
    });

    const data = await parseJsonSafe(res);

    if (!res.ok || !data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || `Payroll Archive API request failed (${res.status})`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!PAYROLL_ARCHIVE_API_URL) {
      return NextResponse.json(
        { ok: false, error: "Missing PAYROLL_ARCHIVE_API_URL" },
        { status: 500 }
      );
    }

    const body = await req.json();

    const res = await fetch(PAYROLL_ARCHIVE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await parseJsonSafe(res);

    if (!res.ok || !data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || `Payroll Archive API POST failed (${res.status})`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}