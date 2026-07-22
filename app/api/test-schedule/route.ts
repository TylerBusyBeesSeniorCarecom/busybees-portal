import { NextResponse } from "next/server";
import { google } from "googleapis";
import path from "path";

const EMPTY_SCHEDULE_REASON = "The schedule for this week has not been created yet.";

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

function isEmptyScheduleRangeError(err: any) {
  const code = Number(err?.code || err?.status || 0);
  const message = String(err?.message ?? "").toLowerCase();
  return (
    code === 400 &&
    (message.includes("the number of rows in the range must be at least 1") ||
      message.includes("unable to parse range"))
  );
}

async function getSheetRowCount(sheets: any, spreadsheetId: string, tabName: string) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,gridProperties(rowCount)))",
  });
  const match = meta.data.sheets?.find(
    (sheet: any) => String(sheet.properties?.title ?? "").trim() === tabName
  );
  return match?.properties?.gridProperties?.rowCount ?? null;
}

export async function GET() {
  try {
    const spreadsheetId = process.env.TEST_SHEET_ID;
    const tabName = process.env.TEST_TAB_NAME;

    if (!spreadsheetId) throw new Error("Missing TEST_SHEET_ID");
    if (!tabName) throw new Error("Missing TEST_TAB_NAME");

    const sheets = await getSheetsClient();

    const range = `'${tabName}'!A1:I500`;
    const rowCount = await getSheetRowCount(sheets, spreadsheetId, tabName);
    if (rowCount != null && rowCount < 2) {
      return NextResponse.json({
        ok: true,
        values: [],
        rowCount: 0,
        empty: true,
        emptyReason: EMPTY_SCHEDULE_REASON,
      });
    }

    let res;
    try {
      res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: "FORMATTED_VALUE",
      });
    } catch (err: any) {
      if (isEmptyScheduleRangeError(err)) {
        return NextResponse.json({
          ok: true,
          values: [],
          rowCount: 0,
          empty: true,
          emptyReason: EMPTY_SCHEDULE_REASON,
        });
      }
      throw err;
    }

    return NextResponse.json({
      ok: true,
      values: res.data.values ?? [],
      rowCount: (res.data.values ?? []).length > 1 ? (res.data.values ?? []).length - 1 : 0,
      empty: (res.data.values ?? []).length === 0,
      emptyReason: (res.data.values ?? []).length === 0 ? EMPTY_SCHEDULE_REASON : undefined,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
