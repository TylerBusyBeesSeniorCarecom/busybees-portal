// app/api/teams/route.ts
import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamMember = {
  nameOnSchedule: string;
};

type TeamColumn = {
  teamLeaderCaregiverId: string;
  members: TeamMember[];
  memberCount: number;
};

function norm(v: unknown): string {
  return (v ?? "").toString().trim();
}

function normalizeKey(v: unknown): string {
  return norm(v).toLowerCase().replace(/\s+/g, " ");
}

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY");

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

function parseTeams(values: string[][]): TeamColumn[] {
  if (!values.length) return [];

  const headerRow = values[0] ?? [];
  const bodyRows = values.slice(1);
  const teams: TeamColumn[] = [];

  for (let col = 0; col < headerRow.length; col++) {
    const teamLeaderCaregiverId = norm(headerRow[col]);
    if (!teamLeaderCaregiverId) continue;

    const members: TeamMember[] = [];

    for (const row of bodyRows) {
      const memberName = norm(row?.[col]);
      if (!memberName) continue;

      members.push({
        nameOnSchedule: memberName,
      });
    }

    teams.push({
      teamLeaderCaregiverId,
      members,
      memberCount: members.length,
    });
  }

  return teams;
}

export async function GET() {
  try {
    const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error("Missing SCHEDULE_SPREADSHEET_ID");
    }

    const tabName = process.env.TEAMS_TAB_NAME || "Teams";
    const range = `'${tabName}'!A1:Z200`;

    const sheets = await getSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const values = (res.data.values ?? []) as string[][];
    const teams = parseTeams(values);

    const byLeaderId: Record<string, TeamColumn> = {};
    const teamByMemberName: Record<
      string,
      {
        teamLeaderCaregiverId: string;
        memberNameOnSchedule: string;
      }
    > = {};
    const allMemberNames: string[] = [];

    for (const team of teams) {
      if (team.teamLeaderCaregiverId) {
        byLeaderId[team.teamLeaderCaregiverId] = team;
      }

      for (const member of team.members) {
        const key = normalizeKey(member.nameOnSchedule);
        if (!key) continue;

        teamByMemberName[key] = {
          teamLeaderCaregiverId: team.teamLeaderCaregiverId,
          memberNameOnSchedule: member.nameOnSchedule,
        };

        allMemberNames.push(member.nameOnSchedule);
      }
    }

    return NextResponse.json({
      ok: true,
      tabName,
      teamCount: teams.length,
      teams,
      byLeaderId,
      teamByMemberName,
      allMemberNames,
    });
  } catch (err: any) {
    console.error("[teams] Route failed:", err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}