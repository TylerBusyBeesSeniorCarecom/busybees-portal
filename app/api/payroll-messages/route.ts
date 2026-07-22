import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PAYROLL_MESSAGES_TIMEOUT_MS = 25000;

function getBaseUrl() {
  const url = process.env.PAYROLL_MESSAGES_API_URL;
  if (!url) throw new Error("Missing PAYROLL_MESSAGES_API_URL");
  return url;
}

export async function GET(req: Request) {
  try {
    const base = getBaseUrl();
    const { searchParams } = new URL(req.url);

    const url = new URL(base);

    // always enforce the correct action
    url.searchParams.set("action", "getPayrollMessages");

    // forward filters
    searchParams.forEach((v, k) => {
      url.searchParams.set(k, v);
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PAYROLL_MESSAGES_TIMEOUT_MS);

    const r = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await r.text();

    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return NextResponse.json(
        { ok: false, error: "Payroll messages request timed out" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
