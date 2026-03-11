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

export async function GET() {
  try {
    const spreadsheetId = process.env.TEST_SHEET_ID;
    const tabName = process.env.TEST_TAB_NAME;

    if (!spreadsheetId) throw new Error("Missing TEST_SHEET_ID");
    if (!tabName) throw new Error("Missing TEST_TAB_NAME");

    const sheets = await getSheetsClient();

    const range = `'${tabName}'!A1:I500`;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    return NextResponse.json({
      ok: true,
      values: res.data.values ?? [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}