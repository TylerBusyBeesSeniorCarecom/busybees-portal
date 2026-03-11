// app/api/clients/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ✅ important when using googleapis

type ClientsPayload =
  | { ok: true; meta: any; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
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
