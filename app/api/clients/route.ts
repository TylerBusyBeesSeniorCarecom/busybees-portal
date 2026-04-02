// app/api/clients/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClientsPayload =
  | { ok: true; meta: any; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");
  }

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

function getClientsAppsScriptUrl() {
  const url = process.env.CLIENTS_APPS_SCRIPT_URL;
  if (!url) {
    throw new Error("Missing CLIENTS_APPS_SCRIPT_URL");
  }
  return url;
}

function normalizeHeaders(row: any[]) {
  return (row || []).map((h) => (h ?? "").toString().trim());
}

export async function GET(_req: Request) {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json<ClientsPayload>(
        { ok: false, error: "Missing env var: SCHEDULE_SPREADSHEET_ID" },
        { status: 500 }
      );
    }

    const tabName = process.env.CLIENTS_TAB_NAME || "Clients";
    const range = process.env.CLIENTS_RANGE || "A1:L2000";

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!${range}`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = (res.data.values || []) as any[][];
    if (values.length === 0) {
      return NextResponse.json<ClientsPayload>({
        ok: true,
        meta: {
          sheet: tabName,
          range: `${tabName}!${range}`,
          fetchedAt: new Date().toISOString(),
        },
        headers: [],
        rows: [],
      });
    }

    const headers = normalizeHeaders(values[0]);
    const rows = values.slice(1).map((r) => {
      const padded = (r || []).map((x) => (x ?? "").toString());
      while (padded.length < headers.length) padded.push("");
      return padded;
    });

    return NextResponse.json<ClientsPayload>({
      ok: true,
      meta: {
        sheet: tabName,
        range: `${tabName}!${range}`,
        fetchedAt: new Date().toISOString(),
      },
      headers,
      rows,
    });
  } catch (err: any) {
    return NextResponse.json<ClientsPayload>(
      { ok: false, error: err?.message || String(err) || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "").trim();

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "Missing action" },
        { status: 400 }
      );
    }

    if (action === "updateClientDescription") {
      const clientName = String(body?.clientName || "").trim();
      const description =
        body?.description == null ? "" : String(body.description);
      const updatedBy = String(body?.updatedBy || "").trim();
      const updatedByEmail = String(body?.updatedByEmail || "").trim();

      if (!clientName) {
        return NextResponse.json(
          { ok: false, error: "Missing clientName" },
          { status: 400 }
        );
      }

      const scriptUrl = getClientsAppsScriptUrl();

      const scriptRes = await fetch(scriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "updateClientDescription",
          clientName,
          description,
          updatedBy,
          updatedByEmail,
        }),
        cache: "no-store",
      });

      const text = await scriptRes.text();

      let data: any = null;
      try {
        data = text ? JSON.parse(text.trim()) : null;
      } catch {
        throw new Error(
          `Non-JSON Apps Script response (${scriptRes.status}): ${text.slice(0, 200)}`
        );
      }

      if (!scriptRes.ok) {
        throw new Error(data?.error || `Apps Script failed (${scriptRes.status})`);
      }

      if (!data?.ok) {
        throw new Error(data?.error || "Apps Script returned not ok");
      }

      return NextResponse.json({
        ok: true,
        result: data,
      });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) || "Unknown error" },
      { status: 500 }
    );
  }
}