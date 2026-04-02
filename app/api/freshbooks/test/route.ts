// app/api/freshbooks/test/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FreshBooksMembership = {
  account_id?: number | string;
  accountId?: number | string;
  business?: {
    id?: number | string;
    account_id?: number | string;
    accountId?: number | string;
  };
};

function getAccessToken(req: NextRequest) {
  return req.cookies.get("fb_access_token")?.value || "";
}

function getRefreshToken(req: NextRequest) {
  return req.cookies.get("fb_refresh_token")?.value || "";
}

async function fetchFreshBooksJson(url: string, accessToken: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { res, json };
}

function pickPrimaryMembership(meJson: any): FreshBooksMembership | null {
  const memberships =
    meJson?.response?.business_memberships ||
    meJson?.business_memberships ||
    [];

  if (!Array.isArray(memberships) || memberships.length === 0) {
    return null;
  }

  return memberships[0] ?? null;
}

function extractAccountId(
  membership: FreshBooksMembership | null,
  meJson?: any
): string | null {
  const candidates = [
    membership?.account_id,
    membership?.accountId,
    membership?.business?.account_id,
    membership?.business?.accountId,
    meJson?.response?.account_id,
    meJson?.response?.accountId,
    meJson?.response?.roles?.[0]?.accountid,
    meJson?.response?.roles?.[0]?.accountId,
  ];

  for (const value of candidates) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }

  return null;
}

function extractBusinessId(membership: FreshBooksMembership | null): string | null {
  const businessId = membership?.business?.id;
  if (businessId === null || businessId === undefined) {
    return null;
  }
  return String(businessId);
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = getAccessToken(req);
    const refreshToken = getRefreshToken(req);

    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          error: "Missing fb_access_token cookie",
          hint: "Reconnect FreshBooks from /api/freshbooks/connect",
          hasRefreshToken: Boolean(refreshToken),
        },
        { status: 401 }
      );
    }

    const meResult = await fetchFreshBooksJson(
      "https://api.freshbooks.com/auth/api/v1/users/me",
      accessToken
    );

    if (!meResult.res.ok) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          step: "identity",
          status: meResult.res.status,
          error:
            meResult.json?.error_description ||
            meResult.json?.error ||
            "FreshBooks identity call failed",
          details: meResult.json,
          hasAccessToken: true,
          hasRefreshToken: Boolean(refreshToken),
        },
        { status: meResult.res.status }
      );
    }

    const membership = pickPrimaryMembership(meResult.json);
    const accountId = extractAccountId(membership, meResult.json);
    const businessId = extractBusinessId(membership);

    if (!membership || !accountId) {
      return NextResponse.json(
        {
          ok: false,
          connected: true,
          step: "identity",
          error: "Could not determine FreshBooks accountId from /me response",
          me: meResult.json,
          businessId,
          accountId,
        },
        { status: 500 }
      );
    }

    const clientsUrl = `https://api.freshbooks.com/accounting/account/${accountId}/users/clients`;

    const clientsResult = await fetchFreshBooksJson(clientsUrl, accessToken);

    if (!clientsResult.res.ok) {
      return NextResponse.json(
        {
          ok: false,
          connected: true,
          step: "clients",
          status: clientsResult.res.status,
          error:
            clientsResult.json?.error_description ||
            clientsResult.json?.error ||
            "FreshBooks clients call failed",
          accountId,
          businessId,
          details: clientsResult.json,
        },
        { status: clientsResult.res.status }
      );
    }

    const clients =
      clientsResult.json?.response?.result?.clients ||
      clientsResult.json?.response?.clients ||
      [];

    return NextResponse.json({
      ok: true,
      connected: true,
      message: "FreshBooks test connection succeeded",
      hasAccessToken: true,
      hasRefreshToken: Boolean(refreshToken),
      businessId,
      accountId,
      clientCount: Array.isArray(clients) ? clients.length : 0,
      clientsPreview: Array.isArray(clients) ? clients.slice(0, 10) : [],
      mePreview: {
        business_memberships:
          meResult.json?.response?.business_memberships ||
          meResult.json?.business_memberships ||
          [],
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error: error?.message || "Unexpected FreshBooks test error",
      },
      { status: 500 }
    );
  }
}