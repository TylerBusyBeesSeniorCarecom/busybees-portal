// app/api/freshbooks/callback/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type TokenResp = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  created_at: number;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing ?code=" }, { status: 400 });
  }

  const clientId = process.env.FRESHBOOKS_CLIENT_ID!;
  const clientSecret = process.env.FRESHBOOKS_CLIENT_SECRET!;
  const redirectUri = process.env.FRESHBOOKS_REDIRECT_URI!;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Missing FreshBooks env vars" },
      { status: 500 }
    );
  }

  // Exchange auth code -> tokens
  // FreshBooks token endpoint: https://api.freshbooks.com/auth/oauth/token :contentReference[oaicite:1]{index=1}
  const form = new FormData();
  form.set("grant_type", "authorization_code");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("code", code);
  form.set("redirect_uri", redirectUri);

  const tokenRes = await fetch("https://api.freshbooks.com/auth/oauth/token", {
    method: "POST",
    body: form,
  });

  const text = await tokenRes.text();
  if (!tokenRes.ok) {
    return NextResponse.json(
      { ok: false, error: "Token exchange failed", details: text },
      { status: 502 }
    );
  }

  const tokenData = JSON.parse(text) as TokenResp;

  // ✅ NEXT: store these securely (DB/secret manager). For dev, we can set httpOnly cookies.
  // WARNING: Don't put tokens in client-side localStorage.

  const resp = NextResponse.redirect(new URL("/billing-payroll?freshbooks=connected", url.origin));
  resp.cookies.set("fb_access_token", tokenData.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokenData.expires_in, // seconds
  });
  resp.cookies.set("fb_refresh_token", tokenData.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    // refresh token doesn't expire quickly; choose a long maxAge for dev
    maxAge: 60 * 60 * 24 * 30,
  });

  return resp;
}