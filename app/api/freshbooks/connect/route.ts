// app/api/freshbooks/connect/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const clientId = process.env.FRESHBOOKS_CLIENT_ID!;
  const redirectUri = process.env.FRESHBOOKS_REDIRECT_URI!;
  const scopes = process.env.FRESHBOOKS_SCOPES || "user:profile:read user:invoices:read";

  // FreshBooks authorization URL format is documented here :contentReference[oaicite:3]{index=3}
  const authUrl = new URL("https://auth.freshbooks.com/oauth/authorize/");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);

  // Optional but recommended: state param to prevent CSRF
  authUrl.searchParams.set("state", crypto.randomUUID());

  return NextResponse.redirect(authUrl.toString());
}