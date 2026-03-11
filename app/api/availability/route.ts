// app/api/availability/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(process.cwd(), keyFile),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const spreadsheetId = process.env.TEST_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error("Missing TEST_SHEET_ID");
    }

    const url = new URL(req.url);
    const week = (url.searchParams.get("week") || "cw").toLowerCase();

    const cwTab = process.env.CW_AVAIL_TAB_NAME || "CW Availability";
    const nwTab = process.env.NW_AVAIL_TAB_NAME || "NW Availability";
    const tabName = week === "nw" ? nwTab : cwTab;

    const sheets = await getSheetsClient();
    const range = `'${tabName}'!A1:L500`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    return NextResponse.json({
      ok: true,
      week,
      tabName,
      values: res.data.values ?? [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}