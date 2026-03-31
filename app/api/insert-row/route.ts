import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function getSheetsClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath) {
    throw new Error("Missing GOOGLE_APPLICATION_CREDENTIALS");
  }

  const resolvedCredentialsPath = path.resolve(process.cwd(), credentialsPath);

  console.log("[insert-row] Using credentials file:", resolvedCredentialsPath);

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedCredentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getSheetIdByName(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string
) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  const match = meta.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );

  const sheetId = match?.properties?.sheetId;

  if (sheetId == null) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  return sheetId;
}

export async function POST(req: NextRequest) {
  try {
    const { sheetName, insertAtRow, clientName } = await req.json();
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;

    console.log("[insert-row] Incoming request:", {
      sheetName,
      insertAtRow,
      clientName,
      hasSpreadsheetId: !!spreadsheetId,
    });

    if (!spreadsheetId || !sheetName || !insertAtRow) {
      return NextResponse.json(
        { error: "Missing spreadsheetId, sheetName, or insertAtRow" },
        { status: 400 }
      );
    }

    const numericInsertAtRow = Number(insertAtRow);

    if (!Number.isFinite(numericInsertAtRow) || numericInsertAtRow < 1) {
      return NextResponse.json(
        { error: "insertAtRow must be a valid row number greater than 0" },
        { status: 400 }
      );
    }

    const sheets = getSheetsClient();
    const sheetId = await getSheetIdByName(sheets, spreadsheetId, sheetName);

    console.log("[insert-row] Resolved sheet:", {
      spreadsheetId,
      sheetName,
      sheetId,
      numericInsertAtRow,
    });

    // Google Sheets batchUpdate row indexes are zero-based and end-exclusive
    const startIndex = numericInsertAtRow - 1;
    const endIndex = startIndex + 1;

    // 1) Insert the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex,
                endIndex,
              },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });

    console.log("[insert-row] Row inserted:", {
      sheetName,
      numericInsertAtRow,
    });

    // 2) Put client name in column A of the new row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${numericInsertAtRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[clientName ?? ""]],
      },
    });

    console.log("[insert-row] Client name written:", {
      sheetName,
      row: numericInsertAtRow,
      clientName: clientName ?? "",
    });

    return NextResponse.json({
      success: true,
      insertedRowNumber: numericInsertAtRow,
      clientName: clientName ?? "",
    });
  } catch (error: any) {
    console.error("[insert-row] Failed:", error);

    return NextResponse.json(
      { error: error?.message || "Failed to insert row" },
      { status: 500 }
    );
  }
}