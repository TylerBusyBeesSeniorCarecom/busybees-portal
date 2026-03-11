import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET() {
  const clientId = mustEnv("FRESHBOOKS_CLIENT_ID");
  const redirectUri = mustEnv("FRESHBOOKS_REDIRECT_URI");
  const scope = mustEnv("FRESHBOOKS_SCOPES");

  // CSRF protection: random string we verify in callback
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL("https://my.freshbooks.com/service/auth/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);

  // For now, store state in a short-lived cookie (simple dev approach)
  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("fb_oauth_state", state, {
    httpOnly: true,
    secure: true, // because you’re coming back via https (ngrok)
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10 minutes
  });

  return res;
}
