// app/api/caregivers/route.ts

import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY in environment");

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function normalizeKey(s: string) {
  return norm(s).toLowerCase();
}

export async function GET() {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error("Missing SCHEDULE_SPREADSHEET_ID in .env.local");
    }

    const tabName = process.env.CAREGIVERS_TAB_NAME || "Caregivers";
    const range = `${tabName}!A1:Z2000`;

    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = (resp.data.values ?? []) as string[][];
    if (values.length === 0) {
      return NextResponse.json({
        ok: true,
        caregivers: [],
        byId: {},
        idByNameOnSchedule: {},
      });
    }

    const headers = values[0].map((h) => norm(h));
    const rows = values.slice(1);

    const idx = (name: string) =>
      headers.findIndex((h) => normalizeKey(h) === normalizeKey(name));

    // --- Core Columns ---
    const iId = idx("Caregiver ID");
    const iNameOnSchedule = idx("Name on schedule");
    const iName = idx("Name");
    const iStatus = idx("Status");
    const iCert = idx("Certification");
    const iTeamLeader =
      idx("Team Leader") >= 0
        ? idx("Team Leader")
        : idx("Team Lead") >= 0
        ? idx("Team Lead")
        : idx("Leader");
    const iRole = idx("Role");
    const iEmail = idx("Email");
    const iPhone = idx("Phone");

    // --- ✅ NEW Columns ---
    const iAddress =
      idx("Address") >= 0
        ? idx("Address")
        : idx("Home Address") >= 0
        ? idx("Home Address")
        : idx("Street Address");

    const iDateInterviewed =
      idx("Date Interview") >= 0
        ? idx("Date Interview")
        : idx("Date Interviewed");

    const iAge = idx("Age");

    const caregivers = rows
      .filter((r) => r.some((c) => norm(c) !== ""))
      .map((r) => {
        const caregiverId = iId >= 0 ? norm(r[iId]) : "";
        const nameOnSchedule = iNameOnSchedule >= 0 ? norm(r[iNameOnSchedule]) : "";
        const name = iName >= 0 ? norm(r[iName]) : "";

        return {
          caregiverId,
          nameOnSchedule,
          name,

          status: iStatus >= 0 ? norm(r[iStatus]) : "",
          certification: iCert >= 0 ? norm(r[iCert]) : "",
          teamLeader: iTeamLeader >= 0 ? norm(r[iTeamLeader]) : "",
          role: iRole >= 0 ? norm(r[iRole]) : "",
          email: iEmail >= 0 ? norm(r[iEmail]) : "",
          phone: iPhone >= 0 ? norm(r[iPhone]) : "",

          address: iAddress >= 0 ? norm(r[iAddress]) : "",
          dateInterviewed: iDateInterviewed >= 0 ? norm(r[iDateInterviewed]) : "",
          age: iAge >= 0 ? norm(r[iAge]) : "",
        };
      })
      .filter((c) => c.caregiverId || c.nameOnSchedule || c.name);

    const byId: Record<string, any> = {};
    const idByNameOnSchedule: Record<string, string> = {};

    for (const c of caregivers) {
      if (c.caregiverId) {
        byId[c.caregiverId] = c;
      }
      if (c.nameOnSchedule && c.caregiverId) {
        idByNameOnSchedule[normalizeKey(c.nameOnSchedule)] = c.caregiverId;
      }
    }

    return NextResponse.json({
      ok: true,
      caregivers,
      byId,
      idByNameOnSchedule,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
