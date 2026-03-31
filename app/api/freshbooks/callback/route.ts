// app/api/freshbooks/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

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
    const url = new URL(req.url);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      return NextResponse.redirect(
        new URL(
          `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
            errorDescription || error
          )}`,
          req.url
        )
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL(
          `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
            "Missing authorization code"
          )}`,
          req.url
        )
      );
    }

    const cookieState = req.cookies.get("fb_oauth_state")?.value;

    if (!state || !cookieState || state !== cookieState) {
      return NextResponse.redirect(
        new URL(
          `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
            "Invalid OAuth state"
          )}`,
          req.url
        )
      );
    }

    const clientId = mustEnv("FRESHBOOKS_CLIENT_ID");
    const clientSecret = mustEnv("FRESHBOOKS_CLIENT_SECRET");
    const redirectUri = mustEnv("FRESHBOOKS_REDIRECT_URI");

    const tokenRes = await fetch("https://api.freshbooks.com/auth/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenJson = await tokenRes.json().catch(() => null);

    if (!tokenRes.ok) {
      return NextResponse.redirect(
        new URL(
          `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
            tokenJson?.error_description ||
              tokenJson?.error ||
              "Token exchange failed"
          )}`,
          req.url
        )
      );
    }

    const accessToken = tokenJson?.access_token;
    const refreshToken = tokenJson?.refresh_token;
    const expiresIn = Number(tokenJson?.expires_in || 0);

    if (!accessToken || !refreshToken) {
      return NextResponse.redirect(
        new URL(
          `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
            "FreshBooks did not return tokens"
          )}`,
          req.url
        )
      );
    }

    const response = NextResponse.redirect(
      new URL("/billing-payroll?freshbooks=connected", req.url)
    );

    response.cookies.set("fb_access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn || 60 * 60 * 12,
    });

    response.cookies.set("fb_refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.set("fb_connected", "true", {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.delete("fb_oauth_state");

    return response;
  } catch (error: any) {
    return NextResponse.redirect(
      new URL(
        `/billing-payroll?freshbooks=error&reason=${encodeURIComponent(
          error?.message || "Unexpected callback error"
        )}`,
        req.url
      )
    );
  }
}