// app/api/freshbooks/connect/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const clientId = mustEnv("FRESHBOOKS_CLIENT_ID");
    const redirectUri = mustEnv("FRESHBOOKS_REDIRECT_URI");
    const scopes =
      process.env.FRESHBOOKS_SCOPES ||
      "user:profile:read user:invoices:read user:clients:read";

    const state = crypto.randomBytes(24).toString("hex");

    const authUrl = new URL("https://auth.freshbooks.com/oauth/authorize/");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authUrl.toString());

    response.cookies.set("fb_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10, // 10 minutes
    });

    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to start FreshBooks OAuth",
      },
      { status: 500 }
    );
  }
}