// app/api/onboarding/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyObj = Record<string, any>;

type CaregiverRecord = {
  caregiverId: string;
  nameOnSchedule: string;
  name: string;
  status: string;
  certification: string;
  role: string;
  email: string;
  phone: string;
  address: string;
  dateInterviewed: string;
  age: string;
};

type EmployeeRow = Record<string, any> & {
  __rowNumber?: number;
  __key?: string;
};

type ScheduledCaregiverRow = {
  caregiverId: string;
  caregiver: string;
  dates: string[];
  statuses: string[];
  shiftCount: number;
};

type AllShiftsResponse = {
  ok: boolean;
  tabs?: {
    currentWeek?: string;
    nextWeek?: string;
  };
  currentWeek?: {
    rowCount?: number;
    scheduledCount?: number;
    caregivers?: ScheduledCaregiverRow[];
    rows?: any[];
  };
  nextWeek?: {
    rowCount?: number;
    scheduledCount?: number;
    caregivers?: ScheduledCaregiverRow[];
    rows?: any[];
  };
  error?: string;
};

type AppLoginSummary = {
  caregiverId: string;
  nameOnSchedule: string;
  email: string;
  role: string;
  hasLoggedIntoApp: boolean;
  loginCount: number;
  firstLoginUtc: string;
  lastLoginUtc: string;
  firstLoginEt: string;
  lastLoginEt: string;
  latestDevice: string;
  latestOs: string;
  latestOsVersion: string;
  latestAppVersion: string;
  latestTimeZone: string;
  latestResult: string;
  latestMessage: string;
};

type AppLoginsResponse = {
  ok: boolean;
  tabName?: string;
  rowCount?: number;
  caregiverCount?: number;
  logins?: AppLoginSummary[];
  byCaregiverId?: Record<string, AppLoginSummary>;
  error?: string;
};

type TeamMember = {
  nameOnSchedule: string;
};

type TeamColumn = {
  teamLeaderCaregiverId: string;
  members: TeamMember[];
  memberCount: number;
};

type TeamsResponse = {
  ok: boolean;
  tabName?: string;
  teamCount?: number;
  teams?: TeamColumn[];
  byLeaderId?: Record<string, TeamColumn>;
  teamByMemberName?: Record<
    string,
    {
      teamLeaderCaregiverId: string;
      memberNameOnSchedule: string;
    }
  >;
  allMemberNames?: string[];
  error?: string;
};

type OnboardingPerson = {
  caregiverId: string;
  name: string;
  nameOnSchedule: string;
  fullName: string;
  phone: string;
  email: string;
  certification: string;
  role: string;
  status: string;
  address: string;
  dateInterviewed: string;
  age: string;

  employeeInfoStatus: string;
  employeeOnStaff: boolean;
  employeePending: boolean;
  employeeRowNumber: number | null;
  interviewId: string;

  onCurrentWeek: boolean;
  onNextWeek: boolean;
  submittedCWAvailability: boolean;
  submittedNWAvailability: boolean;

  hasLoggedIntoApp: boolean;
  loginCount: number;
  lastAppLoginUtc: string;
  lastAppLoginEt: string;
  lastAppLoginDevice: string;
  lastAppLoginOs: string;
  lastAppLoginAppVersion: string;
  lastAppLoginResult: string;

  teamLeaderCaregiverId: string;
  isOnTeam: boolean;
  isTeamLeader: boolean;
  teamMemberCount: number;

  onSchedule: boolean;
  active: boolean;
  applicant: boolean;

  sources: string[];
};

function norm(v: any): string {
  return (v ?? "").toString().trim();
}

function lower(v: any): string {
  return norm(v).toLowerCase();
}

function normalizeKey(v: any): string {
  return lower(v).replace(/\s+/g, " ");
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isTruthyLike(v: any): boolean {
  const s = lower(v);
  return (
    s === "true" ||
    s === "yes" ||
    s === "y" ||
    s === "1" ||
    s === "on staff" ||
    s === "active" ||
    s === "x"
  );
}

function getHeaderValue(row: AnyObj, possibleHeaders: string[]): string {
  for (const key of possibleHeaders) {
    if (row[key] != null && norm(row[key]) !== "") return norm(row[key]);
  }

  const entries = Object.entries(row);
  const wanted = possibleHeaders.map((h) => normalizeKey(h));

  for (const [k, v] of entries) {
    if (wanted.includes(normalizeKey(k)) && norm(v) !== "") {
      return norm(v);
    }
  }

  return "";
}

function getEmployeeStatus(row: EmployeeRow): string {
  return getHeaderValue(row, [
    "Status",
    "Employee Status",
    "Hiring Status",
    "Applicant Status",
    "Onboarding Status",
  ]);
}

function getEmployeeInterviewId(row: EmployeeRow): string {
  return getHeaderValue(row, ["Interview ID"]);
}

function getEmployeeCaregiverId(row: EmployeeRow): string {
  return getHeaderValue(row, [
    "Caregiver ID",
    "Employee ID",
    "User ID",
    "Staff ID",
  ]);
}

function getEmployeeName(row: EmployeeRow): string {
  const direct = getHeaderValue(row, [
    "Name",
    "Full Name",
    "Employee Name",
    "Caregiver Name",
  ]);
  if (direct) return direct;

  const first = getHeaderValue(row, ["First Name", "Firstname", "First"]);
  const last = getHeaderValue(row, ["Last Name", "Lastname", "Last"]);
  return `${first} ${last}`.trim();
}

function getEmployeeNameOnSchedule(row: EmployeeRow): string {
  return getHeaderValue(row, [
    "Name on Schedule",
    "Name On Schedule",
    "Schedule Name",
  ]);
}

function getEmployeePhone(row: EmployeeRow): string {
  return getHeaderValue(row, ["Phone", "Phone Number", "Mobile", "Cell"]);
}

function getEmployeeEmail(row: EmployeeRow): string {
  return getHeaderValue(row, ["Email", "Email Address"]);
}

function getEmployeeCertification(row: EmployeeRow): string {
  return getHeaderValue(row, ["Certification", "Certifications", "Cert"]);
}

function getEmployeeRole(row: EmployeeRow): string {
  return getHeaderValue(row, ["Role", "Position"]);
}

function getEmployeeAddress(row: EmployeeRow): string {
  return getHeaderValue(row, ["Address", "Home Address", "Street Address"]);
}

function getEmployeeAge(row: EmployeeRow): string {
  return getHeaderValue(row, ["Age"]);
}

function getEmployeeDateInterviewed(row: EmployeeRow): string {
  return getHeaderValue(row, ["Date Interviewed", "Date Interview"]);
}

function getEmployeeOnStaff(row: EmployeeRow): boolean {
  const explicitOnStaff = getHeaderValue(row, ["On Staff"]);
  if (explicitOnStaff) return isTruthyLike(explicitOnStaff);

  const status = lower(getEmployeeStatus(row));
  return status === "on staff" || status === "active";
}

function getEmployeePending(row: EmployeeRow): boolean {
  const status = lower(getEmployeeStatus(row));
  return status === "pending";
}

function extract2DValues(payload: any): string[][] {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    if (payload.every((r) => Array.isArray(r))) return payload as string[][];
    return [];
  }

  const candidates = [
    payload.values,
    payload.grid,
    payload.rows,
    payload.data,
    payload.result,
    payload.payload?.values,
    payload.payload?.grid,
    payload.payload?.rows,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.every((r) => Array.isArray(r))) {
      return c as string[][];
    }
  }

  return [];
}

function flatten2D(values: string[][]): string[] {
  return values.flatMap((row) => row.map((cell) => norm(cell)));
}

function addSource(person: OnboardingPerson, source: string) {
  person.sources = dedupeStrings([...person.sources, source]);
}

function makeEmptyPerson(base?: Partial<OnboardingPerson>): OnboardingPerson {
  return {
    caregiverId: norm(base?.caregiverId),
    name: norm(base?.name),
    nameOnSchedule: norm(base?.nameOnSchedule),
    fullName: norm(base?.fullName),
    phone: norm(base?.phone),
    email: norm(base?.email),
    certification: norm(base?.certification),
    role: norm(base?.role),
    status: norm(base?.status),
    address: norm(base?.address),
    dateInterviewed: norm(base?.dateInterviewed),
    age: norm(base?.age),

    employeeInfoStatus: norm(base?.employeeInfoStatus),
    employeeOnStaff: Boolean(base?.employeeOnStaff),
    employeePending: Boolean(base?.employeePending),
    employeeRowNumber:
      typeof base?.employeeRowNumber === "number" ? base.employeeRowNumber : null,
    interviewId: norm(base?.interviewId),

    onCurrentWeek: Boolean(base?.onCurrentWeek),
    onNextWeek: Boolean(base?.onNextWeek),
    submittedCWAvailability: Boolean(base?.submittedCWAvailability),
    submittedNWAvailability: Boolean(base?.submittedNWAvailability),

    hasLoggedIntoApp: Boolean(base?.hasLoggedIntoApp),
    loginCount:
      typeof base?.loginCount === "number" ? base.loginCount : 0,
    lastAppLoginUtc: norm(base?.lastAppLoginUtc),
    lastAppLoginEt: norm(base?.lastAppLoginEt),
    lastAppLoginDevice: norm(base?.lastAppLoginDevice),
    lastAppLoginOs: norm(base?.lastAppLoginOs),
    lastAppLoginAppVersion: norm(base?.lastAppLoginAppVersion),
    lastAppLoginResult: norm(base?.lastAppLoginResult),

    teamLeaderCaregiverId: norm(base?.teamLeaderCaregiverId),
    isOnTeam: Boolean(base?.isOnTeam),
    isTeamLeader: Boolean(base?.isTeamLeader),
    teamMemberCount:
      typeof base?.teamMemberCount === "number" ? base.teamMemberCount : 0,

    onSchedule: Boolean(base?.onSchedule),
    active: Boolean(base?.active),
    applicant: Boolean(base?.applicant),

    sources: base?.sources ?? [],
  };
}

async function fetchInternalJson(req: Request, path: string): Promise<any> {
  const url = new URL(req.url);
  const origin = url.origin;

  const r = await fetch(`${origin}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const rawText = await r.text();
  const text = rawText.trim();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Invalid JSON from ${path} (${r.status}). Response preview: ${rawText.slice(0, 300)}`
    );
  }

  if (!r.ok) {
    throw new Error(
      `Failed to fetch ${path}: ${data?.error || r.statusText || "Unknown error"}`
    );
  }

  return data;
}

function buildCaregiverIndexes(caregivers: CaregiverRecord[]) {
  const byId = new Map<string, CaregiverRecord>();
  const byNameOnSchedule = new Map<string, CaregiverRecord>();
  const byName = new Map<string, CaregiverRecord>();

  for (const c of caregivers) {
    const caregiverId = norm(c.caregiverId);
    const nameOnSchedule = norm(c.nameOnSchedule);
    const name = norm(c.name);

    if (caregiverId) byId.set(caregiverId, c);
    if (nameOnSchedule) byNameOnSchedule.set(normalizeKey(nameOnSchedule), c);
    if (name) byName.set(normalizeKey(name), c);
  }

  return { byId, byNameOnSchedule, byName };
}

function resolveCaregiverFromText(
  text: string,
  caregivers: CaregiverRecord[]
): CaregiverRecord | null {
  const cell = lower(text);
  if (!cell) return null;

  for (const c of caregivers) {
    const id = lower(c.caregiverId);
    const nos = lower(c.nameOnSchedule);
    const name = lower(c.name);

    if (id && cell.includes(id)) return c;
    if (nos && cell.includes(nos)) return c;
    if (name && cell.includes(name)) return c;
  }

  return null;
}

function createPeopleStore() {
  const byCaregiverId = new Map<string, OnboardingPerson>();
  const syntheticByName = new Map<string, OnboardingPerson>();

  function getOrCreate(input: {
    caregiver?: CaregiverRecord | null;
    fallbackName?: string;
    fallbackNameOnSchedule?: string;
    fallbackPhone?: string;
    fallbackEmail?: string;
    fallbackStatus?: string;
    fallbackCertification?: string;
    fallbackRole?: string;
    fallbackAddress?: string;
    fallbackDateInterviewed?: string;
    fallbackAge?: string;
  }): OnboardingPerson {
    const caregiver = input.caregiver ?? null;

    if (caregiver?.caregiverId) {
      const existing = byCaregiverId.get(caregiver.caregiverId);
      if (existing) return existing;

      const created = makeEmptyPerson({
        caregiverId: caregiver.caregiverId,
        name: caregiver.name,
        nameOnSchedule: caregiver.nameOnSchedule,
        fullName: caregiver.name || caregiver.nameOnSchedule,
        phone: caregiver.phone,
        email: caregiver.email,
        certification: caregiver.certification,
        role: caregiver.role,
        status: caregiver.status,
        address: caregiver.address,
        dateInterviewed: caregiver.dateInterviewed,
        age: caregiver.age,
      });

      byCaregiverId.set(caregiver.caregiverId, created);
      return created;
    }

    const nameKey = normalizeKey(
      input.fallbackName || input.fallbackNameOnSchedule || ""
    );

    if (nameKey) {
      const existing = syntheticByName.get(nameKey);
      if (existing) return existing;

      const created = makeEmptyPerson({
        caregiverId: "",
        name: norm(input.fallbackName),
        nameOnSchedule: norm(input.fallbackNameOnSchedule),
        fullName: norm(input.fallbackName || input.fallbackNameOnSchedule),
        phone: norm(input.fallbackPhone),
        email: norm(input.fallbackEmail),
        certification: norm(input.fallbackCertification),
        role: norm(input.fallbackRole),
        status: norm(input.fallbackStatus),
        address: norm(input.fallbackAddress),
        dateInterviewed: norm(input.fallbackDateInterviewed),
        age: norm(input.fallbackAge),
      });

      syntheticByName.set(nameKey, created);
      return created;
    }

    return makeEmptyPerson();
  }

  function all(): OnboardingPerson[] {
    return dedupePeople([
      ...Array.from(byCaregiverId.values()),
      ...Array.from(syntheticByName.values()),
    ]);
  }

  return { getOrCreate, all };
}

function dedupePeople(people: OnboardingPerson[]): OnboardingPerson[] {
  const out = new Map<string, OnboardingPerson>();

  for (const p of people) {
    const key =
      norm(p.caregiverId) ||
      normalizeKey(p.nameOnSchedule) ||
      normalizeKey(p.name) ||
      normalizeKey(p.fullName);

    if (!key) continue;

    const existing = out.get(key);
    if (!existing) {
      out.set(key, p);
      continue;
    }

    existing.sources = dedupeStrings([...existing.sources, ...p.sources]);
    existing.onCurrentWeek = existing.onCurrentWeek || p.onCurrentWeek;
    existing.onNextWeek = existing.onNextWeek || p.onNextWeek;
    existing.submittedCWAvailability =
      existing.submittedCWAvailability || p.submittedCWAvailability;
    existing.submittedNWAvailability =
      existing.submittedNWAvailability || p.submittedNWAvailability;
    existing.employeeOnStaff = existing.employeeOnStaff || p.employeeOnStaff;
    existing.employeePending = existing.employeePending || p.employeePending;

    existing.hasLoggedIntoApp = existing.hasLoggedIntoApp || p.hasLoggedIntoApp;
    existing.loginCount = Math.max(existing.loginCount, p.loginCount);
    existing.lastAppLoginUtc = existing.lastAppLoginUtc || p.lastAppLoginUtc;
    existing.lastAppLoginEt = existing.lastAppLoginEt || p.lastAppLoginEt;
    existing.lastAppLoginDevice =
      existing.lastAppLoginDevice || p.lastAppLoginDevice;
    existing.lastAppLoginOs = existing.lastAppLoginOs || p.lastAppLoginOs;
    existing.lastAppLoginAppVersion =
      existing.lastAppLoginAppVersion || p.lastAppLoginAppVersion;
    existing.lastAppLoginResult =
      existing.lastAppLoginResult || p.lastAppLoginResult;

    existing.teamLeaderCaregiverId =
      existing.teamLeaderCaregiverId || p.teamLeaderCaregiverId;
    existing.isOnTeam = existing.isOnTeam || p.isOnTeam;
    existing.isTeamLeader = existing.isTeamLeader || p.isTeamLeader;
    existing.teamMemberCount = Math.max(existing.teamMemberCount, p.teamMemberCount);

    existing.employeeInfoStatus =
      existing.employeeInfoStatus || p.employeeInfoStatus;
    existing.phone = existing.phone || p.phone;
    existing.email = existing.email || p.email;
    existing.certification = existing.certification || p.certification;
    existing.role = existing.role || p.role;
    existing.status = existing.status || p.status;
    existing.address = existing.address || p.address;
    existing.dateInterviewed = existing.dateInterviewed || p.dateInterviewed;
    existing.age = existing.age || p.age;
    existing.name = existing.name || p.name;
    existing.nameOnSchedule = existing.nameOnSchedule || p.nameOnSchedule;
    existing.fullName = existing.fullName || p.fullName;
    existing.interviewId = existing.interviewId || p.interviewId;
    existing.employeeRowNumber =
      existing.employeeRowNumber ?? p.employeeRowNumber ?? null;
  }

  return Array.from(out.values());
}

function finalizePeople(people: OnboardingPerson[]): OnboardingPerson[] {
  return people
    .map((p) => {
      p.onSchedule = p.onCurrentWeek || p.onNextWeek;
      p.active =
        p.onCurrentWeek ||
        p.onNextWeek ||
        p.submittedCWAvailability ||
        p.submittedNWAvailability ||
        p.employeeOnStaff;
      p.applicant = p.employeePending;
      p.sources = dedupeStrings(p.sources);

      if (!p.fullName) {
        p.fullName = p.name || p.nameOnSchedule || "";
      }

      return p;
    })
    .sort((a, b) => {
      const aName = lower(a.fullName || a.name || a.nameOnSchedule);
      const bName = lower(b.fullName || b.name || b.nameOnSchedule);
      return aName.localeCompare(bName);
    });
}

export async function GET(req: Request) {
  try {
    console.log("[onboarding] Loading all-shifts...");
    const allShiftsData = (await fetchInternalJson(
      req,
      "/api/all-shifts"
    )) as AllShiftsResponse;

    console.log("[onboarding] Loading availability cw...");
    const availabilityCWData = await fetchInternalJson(req, "/api/availability?week=cw");

    console.log("[onboarding] Loading availability nw...");
    const availabilityNWData = await fetchInternalJson(req, "/api/availability?week=nw");

    console.log("[onboarding] Loading caregivers...");
    const caregiversData = await fetchInternalJson(req, "/api/caregivers");

    console.log("[onboarding] Loading employees...");
    const employeesData = await fetchInternalJson(req, "/api/employees");

    console.log("[onboarding] Loading app-logins...");
    const appLoginsData = (await fetchInternalJson(
      req,
      "/api/app-logins"
    )) as AppLoginsResponse;

    console.log("[onboarding] Loading teams...");
    const teamsData = (await fetchInternalJson(
      req,
      "/api/teams"
    )) as TeamsResponse;

    const caregivers: CaregiverRecord[] = Array.isArray(caregiversData?.caregivers)
      ? caregiversData.caregivers
      : [];

    const employeeRows: EmployeeRow[] = Array.isArray(employeesData?.rows)
      ? employeesData.rows
      : [];

    const cwScheduledCaregivers: ScheduledCaregiverRow[] = Array.isArray(
      allShiftsData?.currentWeek?.caregivers
    )
      ? allShiftsData.currentWeek!.caregivers!
      : [];

    const nwScheduledCaregivers: ScheduledCaregiverRow[] = Array.isArray(
      allShiftsData?.nextWeek?.caregivers
    )
      ? allShiftsData.nextWeek!.caregivers!
      : [];

    const appLoginsByCaregiverId: Record<string, AppLoginSummary> =
      appLoginsData?.byCaregiverId ?? {};

    const teamsByLeaderId: Record<string, TeamColumn> =
      teamsData?.byLeaderId ?? {};

    const teamByMemberName:
      | Record<
          string,
          {
            teamLeaderCaregiverId: string;
            memberNameOnSchedule: string;
          }
        >
      | undefined = teamsData?.teamByMemberName;

    const { byId, byNameOnSchedule, byName } = buildCaregiverIndexes(caregivers);
    const store = createPeopleStore();

    // ------------------------------------------------------------
    // 1) Seed from caregivers sheet
    // ------------------------------------------------------------
    for (const c of caregivers) {
      const person = store.getOrCreate({ caregiver: c });
      addSource(person, "caregivers");
    }

    // ------------------------------------------------------------
    // 2) Merge employee info
    // ------------------------------------------------------------
    for (const row of employeeRows) {
      const caregiverId = getEmployeeCaregiverId(row);
      const employeeName = getEmployeeName(row);
      const employeeNameOnSchedule = getEmployeeNameOnSchedule(row);

      let caregiver: CaregiverRecord | null = null;

      if (caregiverId && byId.has(caregiverId)) {
        caregiver = byId.get(caregiverId)!;
      } else if (
        employeeNameOnSchedule &&
        byNameOnSchedule.has(normalizeKey(employeeNameOnSchedule))
      ) {
        caregiver = byNameOnSchedule.get(normalizeKey(employeeNameOnSchedule))!;
      } else if (employeeName && byName.has(normalizeKey(employeeName))) {
        caregiver = byName.get(normalizeKey(employeeName))!;
      }

      const person = store.getOrCreate({
        caregiver,
        fallbackName: employeeName,
        fallbackNameOnSchedule: employeeNameOnSchedule,
        fallbackPhone: getEmployeePhone(row),
        fallbackEmail: getEmployeeEmail(row),
        fallbackStatus: getEmployeeStatus(row),
        fallbackCertification: getEmployeeCertification(row),
        fallbackRole: getEmployeeRole(row),
        fallbackAddress: getEmployeeAddress(row),
        fallbackDateInterviewed: getEmployeeDateInterviewed(row),
        fallbackAge: getEmployeeAge(row),
      });

      if (!person.phone) person.phone = getEmployeePhone(row);
      if (!person.email) person.email = getEmployeeEmail(row);
      if (!person.certification) person.certification = getEmployeeCertification(row);
      if (!person.role) person.role = getEmployeeRole(row);
      if (!person.address) person.address = getEmployeeAddress(row);
      if (!person.dateInterviewed) person.dateInterviewed = getEmployeeDateInterviewed(row);
      if (!person.age) person.age = getEmployeeAge(row);

      person.employeeInfoStatus = getEmployeeStatus(row);
      person.employeeOnStaff = person.employeeOnStaff || getEmployeeOnStaff(row);
      person.employeePending = person.employeePending || getEmployeePending(row);
      person.employeeRowNumber =
        typeof row.__rowNumber === "number" ? row.__rowNumber : person.employeeRowNumber;
      person.interviewId = person.interviewId || getEmployeeInterviewId(row);

      if (!person.name && employeeName) person.name = employeeName;
      if (!person.nameOnSchedule && employeeNameOnSchedule) {
        person.nameOnSchedule = employeeNameOnSchedule;
      }
      if (!person.fullName) {
        person.fullName = person.name || person.nameOnSchedule || "";
      }

      addSource(person, "employees");
    }

    // ------------------------------------------------------------
    // 3) Parse current week scheduled caregivers from All Shifts
    // ------------------------------------------------------------
    for (const row of cwScheduledCaregivers) {
      const scheduledCaregiverId = norm(row.caregiverId);
      const scheduledCaregiverName = norm(row.caregiver);

      let caregiver: CaregiverRecord | null = null;

      if (scheduledCaregiverId && byId.has(scheduledCaregiverId)) {
        caregiver = byId.get(scheduledCaregiverId)!;
      } else if (
        scheduledCaregiverName &&
        byNameOnSchedule.has(normalizeKey(scheduledCaregiverName))
      ) {
        caregiver = byNameOnSchedule.get(normalizeKey(scheduledCaregiverName))!;
      } else if (scheduledCaregiverName && byName.has(normalizeKey(scheduledCaregiverName))) {
        caregiver = byName.get(normalizeKey(scheduledCaregiverName))!;
      }

      const person = store.getOrCreate({
        caregiver,
        fallbackName: scheduledCaregiverName,
        fallbackNameOnSchedule: scheduledCaregiverName,
      });

      person.onCurrentWeek = true;
      addSource(person, "all_shifts_cw");
    }

    // ------------------------------------------------------------
    // 4) Parse next week scheduled caregivers from NW All Shifts
    // ------------------------------------------------------------
    for (const row of nwScheduledCaregivers) {
      const scheduledCaregiverId = norm(row.caregiverId);
      const scheduledCaregiverName = norm(row.caregiver);

      let caregiver: CaregiverRecord | null = null;

      if (scheduledCaregiverId && byId.has(scheduledCaregiverId)) {
        caregiver = byId.get(scheduledCaregiverId)!;
      } else if (
        scheduledCaregiverName &&
        byNameOnSchedule.has(normalizeKey(scheduledCaregiverName))
      ) {
        caregiver = byNameOnSchedule.get(normalizeKey(scheduledCaregiverName))!;
      } else if (scheduledCaregiverName && byName.has(normalizeKey(scheduledCaregiverName))) {
        caregiver = byName.get(normalizeKey(scheduledCaregiverName))!;
      }

      const person = store.getOrCreate({
        caregiver,
        fallbackName: scheduledCaregiverName,
        fallbackNameOnSchedule: scheduledCaregiverName,
      });

      person.onNextWeek = true;
      addSource(person, "all_shifts_nw");
    }

    // ------------------------------------------------------------
    // 5) Parse CW availability
    // ------------------------------------------------------------
    const cwAvailValues = extract2DValues(availabilityCWData);
    for (const cell of flatten2D(cwAvailValues)) {
      if (!cell) continue;
      const caregiver = resolveCaregiverFromText(cell, caregivers);
      if (!caregiver) continue;

      const person = store.getOrCreate({ caregiver });
      person.submittedCWAvailability = true;
      addSource(person, "availability_cw");
    }

    // ------------------------------------------------------------
    // 6) Parse NW availability
    // ------------------------------------------------------------
    const nwAvailValues = extract2DValues(availabilityNWData);
    for (const cell of flatten2D(nwAvailValues)) {
      if (!cell) continue;
      const caregiver = resolveCaregiverFromText(cell, caregivers);
      if (!caregiver) continue;

      const person = store.getOrCreate({ caregiver });
      person.submittedNWAvailability = true;
      addSource(person, "availability_nw");
    }

    // ------------------------------------------------------------
    // 7) Merge app login info
    // ------------------------------------------------------------
    for (const [caregiverId, login] of Object.entries(appLoginsByCaregiverId)) {
      const caregiver = byId.get(caregiverId) ?? null;

      const person = store.getOrCreate({
        caregiver,
        fallbackNameOnSchedule: login?.nameOnSchedule,
        fallbackEmail: login?.email,
        fallbackRole: login?.role,
      });

      person.hasLoggedIntoApp = true;
      person.loginCount = Math.max(person.loginCount, login?.loginCount ?? 0);
      person.lastAppLoginUtc = person.lastAppLoginUtc || norm(login?.lastLoginUtc);
      person.lastAppLoginEt = person.lastAppLoginEt || norm(login?.lastLoginEt);
      person.lastAppLoginDevice =
        person.lastAppLoginDevice || norm(login?.latestDevice);
      person.lastAppLoginOs =
        person.lastAppLoginOs || norm(login?.latestOs);
      person.lastAppLoginAppVersion =
        person.lastAppLoginAppVersion || norm(login?.latestAppVersion);
      person.lastAppLoginResult =
        person.lastAppLoginResult || norm(login?.latestResult);

      addSource(person, "app_logins");
    }

    // ------------------------------------------------------------
    // 8) Merge team leader info
    // ------------------------------------------------------------
    for (const [leaderId, team] of Object.entries(teamsByLeaderId)) {
      const caregiver = byId.get(leaderId) ?? null;

      const person = store.getOrCreate({
        caregiver,
        fallbackNameOnSchedule: caregiver?.nameOnSchedule,
      });

      person.isTeamLeader = true;
      person.teamMemberCount = Math.max(person.teamMemberCount, team?.memberCount ?? 0);
      addSource(person, "teams_leader");
    }

    // ------------------------------------------------------------
    // 9) Merge team member info by nameOnSchedule
    // ------------------------------------------------------------
    for (const [memberNameKey, teamInfo] of Object.entries(teamByMemberName ?? {})) {
      const caregiver =
        byNameOnSchedule.get(memberNameKey) ??
        byName.get(memberNameKey) ??
        null;

      const person = store.getOrCreate({
        caregiver,
        fallbackNameOnSchedule: teamInfo?.memberNameOnSchedule,
        fallbackName: teamInfo?.memberNameOnSchedule,
      });

      person.isOnTeam = true;
      person.teamLeaderCaregiverId =
        person.teamLeaderCaregiverId || norm(teamInfo?.teamLeaderCaregiverId);

      addSource(person, "teams_member");
    }

    const people = finalizePeople(store.all());

    const onSchedule = people.filter((p) => p.onSchedule);
    const active = people.filter((p) => p.active);
    const applicants = people.filter((p) => p.applicant);

    return NextResponse.json({
      ok: true,
      counts: {
        total: people.length,
        onSchedule: onSchedule.length,
        active: active.length,
        applicants: applicants.length,
      },
      people,
      groups: {
        onSchedule,
        active,
        applicants,
      },
      meta: {
        currentWeekScheduledCaregivers: cwScheduledCaregivers.length,
        nextWeekScheduledCaregivers: nwScheduledCaregivers.length,
        cwAvailabilityCellsScanned: flatten2D(cwAvailValues).length,
        nwAvailabilityCellsScanned: flatten2D(nwAvailValues).length,
        caregiversLoaded: caregivers.length,
        employeeRowsLoaded: employeeRows.length,
        appLoginsLoaded: Object.keys(appLoginsByCaregiverId).length,
        teamsLoaded: Object.keys(teamsByLeaderId).length,
      },
    });
  } catch (err: any) {
    console.error("[onboarding] Route failed:", err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}