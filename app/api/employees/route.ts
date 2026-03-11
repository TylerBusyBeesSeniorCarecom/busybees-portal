// app/api/employees/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = process.env.EMPLOYEE_INFO_SPREADSHEET_ID || "";
const TAB_NAME = process.env.EMPLOYEE_INFO_TAB_NAME || "Info";
const RANGE = process.env.EMPLOYEE_INFO_RANGE || "A1:AI5000";

function normHeader(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function colToLetters(col: number) {
  let n = col;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellA1(tab: string, row: number, col1: number) {
  return `${tab}!${colToLetters(col1)}${row}`;
}

function rangeRowA1(tab: string, row: number, colCount: number) {
  const lastCol = colToLetters(Math.max(1, colCount));
  return `${tab}!A${row}:${lastCol}${row}`;
}

/**
 * ✅ Uses GOOGLE_APPLICATION_CREDENTIALS (service account JSON file)
 * This matches your current project setup.
 */
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

function buildRows(values: any[][]) {
  const headersRaw = (values[0] || []).map((h) => (h ?? "").toString().trim());
  const headerIndexByNorm: Record<string, number> = {};

  headersRaw.forEach((h, i) => {
    const k = normHeader(h);
    if (k && headerIndexByNorm[k] == null) headerIndexByNorm[k] = i;
  });

  const rows = values.slice(1).map((rowArr, idx) => {
    const out: any = {};
    headersRaw.forEach((h, i) => {
      if (!h) return;
      out[h] = rowArr?.[i] ?? "";
    });

    const rowNumber = idx + 2;
    const interviewId = (out["Interview ID"] ?? "").toString().trim();
    out.__rowNumber = rowNumber;
    out.__key = interviewId || `row_${rowNumber}`;

    return out;
  });

  return { headersRaw, headerIndexByNorm, rows };
}

async function getSheetIdByTitle(
  sheets: any,
  spreadsheetId: string,
  tabName: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const found = (meta.data.sheets || []).find(
    (s: any) => (s.properties?.title || "").toString().trim() === tabName
  );

  const sheetId = found?.properties?.sheetId;
  if (typeof sheetId !== "number") {
    throw new Error(`Could not find sheetId for tab '${tabName}'. Check EMPLOYEE_INFO_TAB_NAME.`);
  }
  return sheetId;
}

export async function GET() {
  try {
    if (!SPREADSHEET_ID) {
      return NextResponse.json(
        { ok: false, error: "Missing EMPLOYEE_INFO_SPREADSHEET_ID in .env.local" },
        { status: 500 }
      );
    }

    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB_NAME}!${RANGE}`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = (resp.data.values || []) as any[][];
    if (!values.length) {
      return NextResponse.json({ ok: true, headers: [], rows: [] });
    }

    const { headersRaw, rows } = buildRows(values);

    return NextResponse.json({ ok: true, headers: headersRaw, rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!SPREADSHEET_ID) {
      return NextResponse.json(
        { ok: false, error: "Missing EMPLOYEE_INFO_SPREADSHEET_ID in .env.local" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const mode = typeof body.mode === "string" ? body.mode : "";
    const updates: Record<string, any> =
      body.updates && typeof body.updates === "object" ? body.updates : {};

    const sheets = await getSheetsClient();

    const readResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB_NAME}!${RANGE}`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = (readResp.data.values || []) as any[][];
    if (!values.length) {
      return NextResponse.json(
        { ok: false, error: "Sheet is empty (no headers found)." },
        { status: 400 }
      );
    }

    const { headersRaw, headerIndexByNorm, rows } = buildRows(values);

    if (mode === "create") {
      if (headerIndexByNorm[normHeader("Interview ID")] != null) {
        const incoming = (updates["Interview ID"] ?? "").toString().trim();
        if (!incoming) {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          updates["Interview ID"] =
            "INT-" +
            d.getFullYear() +
            pad(d.getMonth() + 1) +
            pad(d.getDate()) +
            "-" +
            pad(d.getHours()) +
            pad(d.getMinutes()) +
            pad(d.getSeconds()) +
            "-" +
            Math.random().toString(16).slice(2, 6).toUpperCase();
        }
      }

      const rowArr = headersRaw.map((h) => {
        const key = (h ?? "").toString().trim();
        if (!key) return "";
        return updates[key] ?? "";
      });

      const sheetId = await getSheetIdByTitle(sheets, SPREADSHEET_ID, TAB_NAME);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: 1,
                  endIndex: 2,
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: rangeRowA1(TAB_NAME, 2, headersRaw.length),
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowArr] },
      });

      return NextResponse.json({
        ok: true,
        mode: "create",
        created: { interviewId: updates["Interview ID"] ?? null, insertedRow: 2 },
      });
    }

    if (mode === "update") {
      const interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
      const rowNumber =
        typeof body.rowNumber === "number" && Number.isFinite(body.rowNumber)
          ? Math.trunc(body.rowNumber)
          : null;

      if (!interviewId && !rowNumber) {
        return NextResponse.json(
          { ok: false, error: "Provide interviewId or rowNumber for update." },
          { status: 400 }
        );
      }

      let targetRow = rowNumber;

      if (!targetRow && interviewId) {
        const match = rows.find((r) => String(r["Interview ID"] ?? "").trim() === interviewId);
        if (!match) {
          return NextResponse.json(
            { ok: false, error: `No row found for Interview ID '${interviewId}'.` },
            { status: 404 }
          );
        }
        targetRow = match.__rowNumber;
      }

      if (!targetRow || targetRow < 2) {
        return NextResponse.json(
          { ok: false, error: `Invalid target rowNumber '${targetRow}'.` },
          { status: 400 }
        );
      }

      const data: { range: string; values: any[][] }[] = [];

      for (const [header, value] of Object.entries(updates)) {
        const rawHeader = (header ?? "").toString().trim();
        if (!rawHeader) continue;

        const normed = normHeader(rawHeader);
        let col0 = headerIndexByNorm[normed];

        if (col0 == null) {
          const exactIdx = headersRaw.findIndex(
            (h) => (h ?? "").toString().trim() === rawHeader
          );
          if (exactIdx >= 0) col0 = exactIdx;
        }

        if (col0 == null) continue;

        data.push({
          range: cellA1(TAB_NAME, targetRow, col0 + 1),
          values: [[value ?? ""]],
        });
      }

      const writeResp = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: "USER_ENTERED", data },
      });

      return NextResponse.json({
        ok: true,
        mode: "update",
        meta: {
          updatedRow: targetRow,
          updatedCells: writeResp.data.totalUpdatedCells ?? data.length,
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown mode '${mode}'. Use 'create' or 'update'.` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}