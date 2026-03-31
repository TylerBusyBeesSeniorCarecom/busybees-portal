import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

    const r = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
    });

    const text = await r.text();

    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}