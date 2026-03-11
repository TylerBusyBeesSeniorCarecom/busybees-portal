// app/schedule/components/clientProfileModel.ts

export type ClientsApiResponse =
  | { ok: true; meta: any; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

export type ClientProfile = {
  name: string;
  address: string;
  description: string;
  rate: string;
  raw?: Record<string, string>;
};

export type HistoricalRow = {
  shiftId: string;
  date: string;
  client: string;
  caregiver: string;
  caregiverId: string;
  startTime: string;
  endTime: string;
  status: string;
};

export type ClientCaregiverHistoryItem = {
  caregiverId: string; // may be "" sometimes
  caregiverName: string;
  visitCount: number;
  lastDate: string;
};

// Keep these tiny helpers local to the model (so CWWebSchedule doesn’t have to own them)
export function norm(v: any) {
  return (v ?? "").toString().trim();
}
export function normalizeKey(v: string) {
  return norm(v).toLowerCase();
}

function headerIndex(headers: string[], candidates: string[]) {
  const hs = headers.map((h) => norm(h).toLowerCase());
  for (const c of candidates) {
    const i = hs.findIndex((h) => h === c.toLowerCase());
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = hs.findIndex((h) => h.includes(c.toLowerCase()));
    if (i !== -1) return i;
  }
  return -1;
}

export function buildClientsByName(payload: Extract<ClientsApiResponse, { ok: true }>) {
  const headers = (payload.headers || []).map((h) => norm(h));
  const rows = payload.rows || [];

  const iName = headerIndex(headers, ["client name", "name", "client"]);
  const iAddr = headerIndex(headers, ["address", "street address", "location"]);
  const iDesc = headerIndex(headers, ["description", "notes", "client description"]);
  const iRate = headerIndex(headers, ["rate", "hourly rate", "bill rate", "billing rate"]);

  const map: Record<string, ClientProfile> = {};

  for (const r of rows) {
    const name = iName >= 0 ? norm(r[iName]) : "";
    if (!name) continue;

    const address = iAddr >= 0 ? norm(r[iAddr]) : "";
    const description = iDesc >= 0 ? norm(r[iDesc]) : "";
    const rate = iRate >= 0 ? norm(r[iRate]) : "";

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => (raw[h || `col_${idx}`] = norm(r[idx])));

    map[normalizeKey(name)] = { name, address, description, rate, raw };
  }

  return map;
}

// Loose date compare (kept simple)
function toDateSafe(raw: string): Date | null {
  const s = norm(raw);
  if (!s) return null;

  const d0 = new Date(s);
  if (!Number.isNaN(d0.getTime())) return d0;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function compareDatesLoose(a: string, b: string) {
  const da = toDateSafe(a);
  const db = toDateSafe(b);
  const ta = da ? da.getTime() : -Infinity;
  const tb = db ? db.getTime() : -Infinity;
  return ta - tb;
}

export function buildClientHistoryList(args: {
  clientName: string;
  historicalRows: HistoricalRow[];
  caregiversById: Record<string, { name?: string; nameOnSchedule?: string }>;
  idByNameOnSchedule: Record<string, string>;
}): ClientCaregiverHistoryItem[] {
  const clientKey = normalizeKey(args.clientName);
  if (!clientKey) return [];

  const map: Record<
    string,
    { caregiverId: string; caregiverName: string; visitCount: number; lastDate: string }
  > = {};

  for (const r of args.historicalRows) {
    if (normalizeKey(r.client) !== clientKey) continue;

    const rawId = norm(r.caregiverId);
    const rawName = norm(r.caregiver);

    const idFromName = rawName ? args.idByNameOnSchedule[normalizeKey(rawName)] : "";
    const caregiverId = rawId || idFromName || "";

    const prof = caregiverId ? args.caregiversById[caregiverId] : undefined;
    const caregiverName =
      norm(prof?.name) ||
      norm(prof?.nameOnSchedule) ||
      rawName ||
      (caregiverId ? caregiverId : "Unknown");

    const key = caregiverId ? `id:${caregiverId}` : `name:${normalizeKey(caregiverName)}`;
    if (!map[key]) map[key] = { caregiverId, caregiverName, visitCount: 0, lastDate: "" };

    map[key].visitCount += 1;

    const cur = map[key].lastDate;
    if (!cur || compareDatesLoose(cur, r.date) < 0) map[key].lastDate = r.date;
  }

  return Object.values(map)
    .filter((x) => x.caregiverName)
    .sort((a, b) => {
      if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
      return compareDatesLoose(b.lastDate, a.lastDate);
    });
}
