// app/schedule/components/OnboardingPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type OnboardingTab = "onSchedule" | "active" | "applicants" | "tasks";
type TaskKey =
  | "scheduledNotOnApp"
  | "scheduledNoProfile"
  | "scheduledNotOnTeam"
  | "onTeamNotScheduled";

type SortMode = "mostComplete" | "leastComplete" | "nameAsc";

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

  currentWeekHours?: number;
  nextWeekHours?: number;
};

type OnboardingResponse = {
  ok: boolean;
  error?: string;
  counts?: {
    total: number;
    onSchedule: number;
    active: number;
    applicants: number;
  };
  people?: OnboardingPerson[];
  groups?: {
    onSchedule: OnboardingPerson[];
    active: OnboardingPerson[];
    applicants: OnboardingPerson[];
  };
};

type TaskBucket = {
  key: TaskKey;
  title: string;
  subtitle: string;
  people: OnboardingPerson[];
};

type CreateProfileFormState = {
  role: string;
  name: string;
  nameOnSchedule: string;
  address: string;
  dateInterviewed: string;
  phoneNumber: string;
  certification: string;
  age: string;
  emailAddress: string;
  status: string;
  password: string;
  caregiverId: string;
};

type EmployeeRow = Record<string, any> & {
  __rowNumber?: number;
  __key?: string;
};

type EmployeeCandidate = {
  rowNumber: number | null;
  interviewId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  status: string;
  phone: string;
  age: string;
  address: string;
  certification: string;
  dateInterviewed: string;
  email: string;
  role: string;
  scheduleName: string;
};

function norm(v: any) {
  return (v ?? "").toString().trim();
}

function lower(v: any) {
  return norm(v).toLowerCase();
}

function prettyName(p: OnboardingPerson) {
  return norm(p.fullName) || norm(p.name) || norm(p.nameOnSchedule) || "Unnamed Person";
}

function isOpenPerson(p: OnboardingPerson) {
  const names = [p.fullName, p.name, p.nameOnSchedule].map(lower);
  return names.includes("open");
}

function sortPeopleByName(list: OnboardingPerson[]) {
  return [...list].sort((a, b) =>
    prettyName(a).toLowerCase().localeCompare(prettyName(b).toLowerCase())
  );
}

function hasCaregiverProfile(p: OnboardingPerson) {
  return (p.sources || []).includes("caregivers");
}

function hasTeamAssignment(p: OnboardingPerson) {
  return Boolean(
    p.isOnTeam || p.isTeamLeader || p.teamLeaderCaregiverId || p.teamMemberCount > 0
  );
}

function resolveTeamLeaderName(person: OnboardingPerson, allPeople: OnboardingPerson[]) {
  if (person.isTeamLeader) return "Team Leader";
  if (!person.teamLeaderCaregiverId) return "";

  const leader =
    allPeople.find((p) => norm(p.caregiverId) === norm(person.teamLeaderCaregiverId)) ||
    null;

  return leader ? prettyName(leader) : person.teamLeaderCaregiverId;
}

function resolveTeamLabel(person: OnboardingPerson, allPeople: OnboardingPerson[]) {
  if (person.isTeamLeader) {
    return `Team Leader${
      person.teamMemberCount
        ? ` • ${person.teamMemberCount} member${person.teamMemberCount === 1 ? "" : "s"}`
        : ""
    }`;
  }

  const leaderName = resolveTeamLeaderName(person, allPeople);
  if (!leaderName) return "Not On Team";

  return `Team: ${leaderName}`;
}

function getChecklistItems(person: OnboardingPerson) {
  return [
    {
      key: "onStaff",
      label: "Marked as On Staff",
      done: person.employeeOnStaff,
    },
    {
      key: "profile",
      label: "Profile Created",
      done: hasCaregiverProfile(person),
    },
    {
      key: "team",
      label: "On a Team",
      done: hasTeamAssignment(person),
    },
    {
      key: "appLogin",
      label: "Logged Into App",
      done: person.hasLoggedIntoApp,
    },
  ];
}

function progressChecks(person: OnboardingPerson) {
  const checks = getChecklistItems(person);
  const complete = checks.filter((c) => c.done).length;
  const total = checks.length;
  const percent = Math.round((complete / total) * 100);
  const missing = checks.filter((c) => !c.done).map((c) => c.label);

  return { complete, total, percent, missing };
}

function badgeStyle(kind: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: "nowrap",
    border: "1px solid transparent",
  };

  switch (kind) {
    case "status":
      return {
        ...base,
        background: "#f4f4f5",
        color: "#3f3f46",
        borderColor: "#d4d4d8",
      };
    case "appYes":
      return {
        ...base,
        background: "#eaf8ef",
        color: "#21653b",
        borderColor: "#b9e2c7",
      };
    case "appNo":
      return {
        ...base,
        background: "#fff1f2",
        color: "#9f1239",
        borderColor: "#fecdd3",
      };
    case "scheduleYes":
      return {
        ...base,
        background: "#fff7cc",
        color: "#7a5a00",
        borderColor: "#f0d66a",
      };
    case "scheduleNo":
      return {
        ...base,
        background: "#f9fafb",
        color: "#4b5563",
        borderColor: "#e5e7eb",
      };
    case "teamLead":
      return {
        ...base,
        background: "#eef4ff",
        color: "#1e40af",
        borderColor: "#c7d2fe",
      };
    case "noTeamLead":
      return {
        ...base,
        background: "#fef3c7",
        color: "#92400e",
        borderColor: "#fcd34d",
      };
    case "profileNo":
      return {
        ...base,
        background: "#fff7ed",
        color: "#9a3412",
        borderColor: "#fed7aa",
      };
    case "pending":
      return {
        ...base,
        background: "#fff0e8",
        color: "#9a4b14",
        borderColor: "#f3c5a5",
      };
    case "task":
      return {
        ...base,
        background: "#fff7db",
        color: "#7a5200",
        borderColor: "#f4d36a",
      };
    case "match":
      return {
        ...base,
        background: "#eef7ff",
        color: "#1d4f91",
        borderColor: "#b9d9ff",
      };
    default:
      return {
        ...base,
        background: "#f5f5f5",
        color: "#444",
        borderColor: "#ddd",
      };
  }
}

function cardStyle(selected: boolean): React.CSSProperties {
  return {
    border: selected ? "2px solid #f4b400" : "1px solid #e5e7eb",
    borderRadius: 16,
    background: selected ? "#fffdf5" : "#ffffff",
    padding: 14,
    cursor: "pointer",
    boxShadow: selected
      ? "0 8px 24px rgba(244, 180, 0, 0.14)"
      : "0 4px 14px rgba(15, 23, 42, 0.06)",
    transition: "all 0.15s ease",
  };
}

function summaryCardStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? "2px solid #f4b400" : "1px solid #e5e7eb",
    background: active ? "#fffdf4" : "#ffffff",
    borderRadius: 16,
    padding: "12px 14px",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
  };
}

function formatHoursChip(label: string, hours: unknown, scheduled: boolean) {
  const n = typeof hours === "number" && Number.isFinite(hours) ? hours : null;

  if (n != null) {
    const display = Number.isInteger(n) ? String(n) : n.toFixed(1);
    return `${label}: ${display}h`;
  }

  return scheduled ? `${label}: Scheduled` : `${label}: Not Scheduled`;
}

function ProgressCircle({
  person,
  selected,
  size = 48,
}: {
  person: OnboardingPerson;
  selected: boolean;
  size?: number;
}) {
  const { complete, total, percent, missing } = progressChecks(person);
  const fill = `conic-gradient(#f4b400 0% ${percent}%, #ece7d5 ${percent}% 100%)`;

  const title =
    missing.length === 0
      ? `${complete}/${total} complete • Nothing missing`
      : `${complete}/${total} complete • Missing: ${missing.join(", ")}`;

  return (
    <div
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: fill,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: selected
          ? "0 0 0 3px rgba(244,180,0,0.12)"
          : "0 1px 3px rgba(15,23,42,0.08)",
      }}
    >
      <div
        style={{
          width: size - 10,
          height: size - 10,
          borderRadius: "50%",
          background: selected ? "#fffaf0" : "#fffdf8",
          color: "#1f2937",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: size >= 56 ? 14 : 12,
        }}
      >
        {complete}/{total}
      </div>
    </div>
  );
}

function applySort(list: OnboardingPerson[], sortMode: SortMode) {
  const withProgress = [...list];

  if (sortMode === "nameAsc") {
    return sortPeopleByName(withProgress);
  }

  return withProgress.sort((a, b) => {
    const aProgress = progressChecks(a).complete;
    const bProgress = progressChecks(b).complete;

    if (sortMode === "mostComplete") {
      if (bProgress !== aProgress) return bProgress - aProgress;
      return prettyName(a).toLowerCase().localeCompare(prettyName(b).toLowerCase());
    }

    if (aProgress !== bProgress) return aProgress - bProgress;
    return prettyName(a).toLowerCase().localeCompare(prettyName(b).toLowerCase());
  });
}

function getHeaderValue(row: Record<string, any>, possibleHeaders: string[]) {
  for (const key of possibleHeaders) {
    if (row[key] != null && norm(row[key]) !== "") return norm(row[key]);
  }

  const wanted = possibleHeaders.map((h) =>
    h
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
  );

  for (const [k, v] of Object.entries(row)) {
    const nk = k
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .trim();

    if (wanted.includes(nk) && norm(v) !== "") {
      return norm(v);
    }
  }

  return "";
}

function parseEmployeeCandidate(row: EmployeeRow): EmployeeCandidate {
  const firstName = getHeaderValue(row, ["First Name", "Firstname", "First"]);
  const lastName = getHeaderValue(row, ["Last Name", "Lastname", "Last"]);
  const fullName =
    getHeaderValue(row, ["Name", "Full Name", "Employee Name", "Caregiver Name"]) ||
    `${firstName} ${lastName}`.trim();

  return {
    rowNumber: typeof row.__rowNumber === "number" ? row.__rowNumber : null,
    interviewId: getHeaderValue(row, ["Interview ID"]),
    fullName,
    firstName,
    lastName,
    status: getHeaderValue(row, [
      "Status",
      "Employee Status",
      "Hiring Status",
      "Applicant Status",
      "Onboarding Status",
    ]),
    phone: getHeaderValue(row, ["Phone", "Phone Number", "Mobile", "Cell"]),
    age: getHeaderValue(row, ["Age"]),
    address: getHeaderValue(row, ["Address", "Home Address", "Street Address"]),
    certification: getHeaderValue(row, ["Certification", "Certifications", "Cert"]),
    dateInterviewed: getHeaderValue(row, ["Date Interviewed", "Date Interview"]),
    email: getHeaderValue(row, ["Email", "Email Address"]),
    role: getHeaderValue(row, ["Role", "Position"]),
    scheduleName: getHeaderValue(row, [
      "Name on Schedule",
      "Name On Schedule",
      "Schedule Name",
    ]),
  };
}

function getFirstNameFromScheduledText(value: string) {
  return norm(value).split(/\s+/).filter(Boolean)[0] || "";
}

function getLastInitialFromScheduledText(value: string) {
  const parts = norm(value).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  const second = parts[1].replace(/[^a-zA-Z]/g, "");
  return second ? second[0].toLowerCase() : "";
}



function buildEmployeeCandidates(person: OnboardingPerson, rows: EmployeeRow[]) {
  const scheduledName = prettyName(person);
  const scheduledFirst = getFirstNameFromScheduledText(scheduledName).toLowerCase();
  const scheduledLastInitial = getLastInitialFromScheduledText(scheduledName);

  const candidates = rows
    .map(parseEmployeeCandidate)
    .filter((candidate) => {
      const candidateFirst = lower(candidate.firstName);
      const candidateFull = lower(candidate.fullName);
      const candidateSchedule = lower(candidate.scheduleName);
      const candidateLast = lower(candidate.lastName);

      if (!scheduledFirst) return false;

      const firstMatches =
        candidateFirst === scheduledFirst ||
        candidateFull.startsWith(scheduledFirst) ||
        candidateSchedule.startsWith(scheduledFirst);

      if (!firstMatches) return false;

      if (!scheduledLastInitial) return true;

      return (
        candidateLast.startsWith(scheduledLastInitial) ||
        candidateSchedule.split(/\s+/)[1]?.startsWith(scheduledLastInitial)
      );
    })
    .sort((a, b) => lower(a.fullName).localeCompare(lower(b.fullName)));

  return candidates;
}

export default function OnboardingPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [tab, setTab] = useState<OnboardingTab>("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedTask, setSelectedTask] = useState<TaskKey>("scheduledNotOnApp");
  const [sortMode, setSortMode] = useState<SortMode>("mostComplete");

  const [showCreateProfileModal, setShowCreateProfileModal] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [profileSubmitError, setProfileSubmitError] = useState("");

  const [employeeMatchLoading, setEmployeeMatchLoading] = useState(false);
  const [employeeMatchError, setEmployeeMatchError] = useState("");
  const [employeeCandidates, setEmployeeCandidates] = useState<EmployeeCandidate[]>([]);
  const [selectedEmployeeKey, setSelectedEmployeeKey] = useState("");

 const [profileForm, setProfileForm] = useState<CreateProfileFormState>({
  role: "Caregiver",
  name: "",
  nameOnSchedule: "",
  address: "",
  dateInterviewed: "",
  phoneNumber: "",
  certification: "",
  age: "",
  emailAddress: "",
  status: "Active",
  password: "",
  caregiverId: "",
});

  async function load() {
    try {
      setLoading(true);
      setError("");

      const r = await fetch("/api/onboarding", { cache: "no-store" });
      const text = await r.text();

      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Onboarding API returned invalid JSON (${r.status}). Response preview: ${text.slice(
            0,
            200
          )}`
        );
      }

      if (!r.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load onboarding data (${r.status})`);
      }

      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load onboarding data");
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployeeCandidates(person: OnboardingPerson) {
    try {
      setEmployeeMatchLoading(true);
      setEmployeeMatchError("");
      setEmployeeCandidates([]);
      setSelectedEmployeeKey("");

      const r = await fetch("/api/employees", { cache: "no-store" });
      const text = await r.text();

      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Employees API returned invalid JSON (${r.status}). Response preview: ${text.slice(
            0,
            200
          )}`
        );
      }

      if (!r.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load employees (${r.status})`);
      }

      const rows: EmployeeRow[] = Array.isArray(json?.rows) ? json.rows : [];
      const candidates = buildEmployeeCandidates(person, rows);
      setEmployeeCandidates(candidates);

      if (candidates[0]) {
        setSelectedEmployeeKey(
          candidates[0].interviewId || `${candidates[0].fullName}-${candidates[0].rowNumber ?? ""}`
        );
      }
    } catch (err: any) {
      setEmployeeMatchError(err?.message || "Failed to load employee matches");
    } finally {
      setEmployeeMatchLoading(false);
    }
  }

  function openCreateProfileModal(person: OnboardingPerson) {
    setProfileSubmitError("");
    setEmployeeMatchError("");
    setEmployeeCandidates([]);
    setSelectedEmployeeKey("");

   setProfileForm({
  role: person.role || "Caregiver",
  name: prettyName(person),
  nameOnSchedule: person.nameOnSchedule || prettyName(person),
  address: person.address || "",
  dateInterviewed: person.dateInterviewed || "",
  phoneNumber: person.phone || "",
  certification: person.certification || "",
  age: person.age || "",
  emailAddress: person.email || "",
  status: "Active",
  password: "",
  caregiverId: person.caregiverId || "",
});

    setShowCreateProfileModal(true);
    void loadEmployeeCandidates(person);
  }

  function applyEmployeeCandidate(candidate: EmployeeCandidate) {
    setSelectedEmployeeKey(
      candidate.interviewId || `${candidate.fullName}-${candidate.rowNumber ?? ""}`
    );

   setProfileForm((prev) => ({
  ...prev,
  role: candidate.role || prev.role || "Caregiver",
  name: candidate.fullName || prev.name,
  nameOnSchedule: candidate.scheduleName || prev.nameOnSchedule,
  address: candidate.address || prev.address,
  dateInterviewed: candidate.dateInterviewed || prev.dateInterviewed,
  phoneNumber: candidate.phone || prev.phoneNumber,
  certification: candidate.certification || prev.certification,
  age: candidate.age || prev.age,
  emailAddress: candidate.email || prev.emailAddress,
  status: lower(candidate.status).includes("inactive") ? "Inactive" : prev.status || "Active",
  caregiverId: prev.caregiverId || "",
}));
  }

  async function submitCreateProfile() {
    try {
      setSubmittingProfile(true);
      setProfileSubmitError("");

      const r = await fetch("/api/caregiver-profiles/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileForm),
      });

      const text = await r.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Create profile API returned invalid JSON (${r.status}). Response preview: ${text.slice(
            0,
            200
          )}`
        );
      }

      if (!r.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to create caregiver profile (${r.status})`);
      }

      setShowCreateProfileModal(false);
      await load();
    } catch (err: any) {
      setProfileSubmitError(err?.message || "Failed to create caregiver profile");
    } finally {
      setSubmittingProfile(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    load();
  }, [open]);

  const allPeople = useMemo(() => {
    const people = data?.people ?? [];
    return sortPeopleByName(people.filter((p) => !isOpenPerson(p)));
  }, [data]);

  const visibleGroups = useMemo(() => {
    return {
      onSchedule: sortPeopleByName(
        (data?.groups?.onSchedule ?? []).filter((p) => !isOpenPerson(p))
      ),
      active: sortPeopleByName((data?.groups?.active ?? []).filter((p) => !isOpenPerson(p))),
      applicants: sortPeopleByName(
        (data?.groups?.applicants ?? []).filter((p) => !isOpenPerson(p))
      ),
    };
  }, [data]);

  const counts = useMemo(
    () => ({
      total: allPeople.length,
      onSchedule: visibleGroups.onSchedule.length,
      active: visibleGroups.active.length,
      applicants: visibleGroups.applicants.length,
    }),
    [allPeople, visibleGroups]
  );

  const taskBuckets = useMemo<TaskBucket[]>(() => {
    const scheduledNotOnApp = sortPeopleByName(
      allPeople.filter((p) => p.onSchedule && !p.hasLoggedIntoApp)
    );

    const scheduledNoProfile = sortPeopleByName(
      allPeople.filter((p) => p.onSchedule && !hasCaregiverProfile(p))
    );

    const scheduledNotOnTeam = sortPeopleByName(
      allPeople.filter((p) => p.onSchedule && !hasTeamAssignment(p))
    );

    const onTeamNotScheduled = sortPeopleByName(
      allPeople.filter((p) => hasTeamAssignment(p) && !p.onSchedule)
    );

    return [
      {
        key: "scheduledNotOnApp",
        title: "On Schedule, Not In App",
        subtitle: "People working this week or next week who have not logged into the app.",
        people: scheduledNotOnApp,
      },
      {
        key: "scheduledNoProfile",
        title: "On Schedule, No Caregiver Profile",
        subtitle: "People on the schedule who are missing from the caregiver route data.",
        people: scheduledNoProfile,
      },
      {
        key: "scheduledNotOnTeam",
        title: "On Schedule, Not On Team",
        subtitle: "People on the schedule who are not assigned to any team.",
        people: scheduledNotOnTeam,
      },
      {
        key: "onTeamNotScheduled",
        title: "On Team, Not On Schedule",
        subtitle:
          "People assigned to teams who are not on the current or next week schedule.",
        people: onTeamNotScheduled,
      },
    ];
  }, [allPeople]);

  const activeTaskBucket =
    taskBuckets.find((bucket) => bucket.key === selectedTask) ?? taskBuckets[0] ?? null;

  const basePeople = useMemo(() => {
    if (tab === "tasks") return activeTaskBucket?.people ?? [];

    switch (tab) {
      case "onSchedule":
        return visibleGroups.onSchedule;
      case "active":
        return visibleGroups.active;
      case "applicants":
        return visibleGroups.applicants;
      default:
        return allPeople;
    }
  }, [tab, visibleGroups, allPeople, activeTaskBucket]);

  const filteredPeople = useMemo(() => {
    const q = lower(search);

    const filtered = basePeople.filter((p) => {
      if (!q) return true;

      const hay = [
        p.fullName,
        p.name,
        p.nameOnSchedule,
        p.phone,
        p.email,
        p.certification,
        p.role,
        p.status,
        p.employeeInfoStatus,
        p.caregiverId,
        p.interviewId,
        p.teamLeaderCaregiverId,
        p.lastAppLoginEt,
        p.lastAppLoginDevice,
        p.lastAppLoginOs,
        hasCaregiverProfile(p) ? "has profile" : "no profile",
        p.hasLoggedIntoApp ? "logged into app" : "not in app",
        resolveTeamLabel(p, allPeople),
      ]
        .map((x) => lower(x))
        .join(" ");

      return hay.includes(q);
    });

    return applySort(filtered, sortMode);
  }, [basePeople, search, allPeople, sortMode]);

  useEffect(() => {
    if (!filteredPeople.length) {
      setSelectedId("");
      return;
    }

    const stillExists = filteredPeople.some(
      (p) => (p.caregiverId || prettyName(p)) === selectedId
    );

    if (!stillExists) {
      setSelectedId(filteredPeople[0].caregiverId || prettyName(filteredPeople[0]));
    }
  }, [filteredPeople, selectedId]);

  const selectedPerson =
    filteredPeople.find((p) => (p.caregiverId || prettyName(p)) === selectedId) ||
    filteredPeople[0] ||
    null;

  const tabDefinition =
    tab === "onSchedule"
      ? "Caregiver is on the schedule for this week or next week."
      : tab === "active"
      ? "List of people on the schedule for the current week or next week, have submitted availability for this week or next week or are marked as on Staff."
      : tab === "applicants"
      ? "People currently marked as pending applicants."
      : "Task lists for people who are missing onboarding-related items.";

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(15, 23, 42, 0.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1400px, 96vw)",
          height: "min(900px, 92vh)",
          background: "#fffdf8",
          borderRadius: 24,
          border: "1px solid rgba(244,180,0,0.22)",
          boxShadow: "0 28px 80px rgba(15, 23, 42, 0.24)",
          display: "grid",
          gridTemplateRows: "auto auto auto minmax(0, 1fr)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "18px 20px 14px 20px",
            borderBottom: "1px solid #f1e6bf",
            background:
              "linear-gradient(180deg, rgba(255,249,230,0.95), rgba(255,253,248,0.95))",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#1f2937",
                letterSpacing: "-0.02em",
              }}
            >
              Onboarding
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                color: "#6b7280",
              }}
            >
              View onboarding activity, app access, team assignment, schedule presence, and
              task lists.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={load}
              style={{
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#374151",
                borderRadius: 12,
                padding: "10px 14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Refresh
            </button>

            <button
              onClick={onClose}
              style={{
                border: "1px solid #d1d5db",
                background: "#111827",
                color: "#fff",
                borderRadius: 12,
                padding: "10px 14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "14px 20px 8px 20px",
            flexWrap: "wrap",
          }}
        >
          {[
            { key: "onSchedule", label: "On Schedule", count: counts.onSchedule },
            { key: "active", label: "Active", count: counts.active },
            { key: "applicants", label: "Applicants", count: counts.applicants },
            {
              key: "tasks",
              label: "Tasks",
              count: taskBuckets.reduce((sum, bucket) => sum + bucket.people.length, 0),
            },
          ].map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key as OnboardingTab)}
                style={{
                  border: active ? "2px solid #f4b400" : "1px solid #e5e7eb",
                  background: active ? "#fff7db" : "#ffffff",
                  color: active ? "#7a5200" : "#374151",
                  borderRadius: 999,
                  padding: "10px 14px",
                  fontWeight: 800,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{item.label}</span>
                <span
                  style={{
                    minWidth: 24,
                    height: 24,
                    padding: "0 7px",
                    borderRadius: 999,
                    background: active ? "#f4b400" : "#f3f4f6",
                    color: active ? "#1f2937" : "#4b5563",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            padding: "4px 20px 14px 20px",
            borderBottom: "1px solid #f3ead0",
            display: "grid",
            gridTemplateColumns: "minmax(280px, 420px) 1fr",
            gap: 14,
          }}
        >
          <div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "tasks"
                  ? "Search task list by name, app status, or team..."
                  : "Search name, phone, certification, status..."
              }
              style={{
                width: "100%",
                border: "1px solid #d1d5db",
                borderRadius: 14,
                padding: "12px 14px",
                outline: "none",
                fontSize: 14,
                background: "#fff",
              }}
            />
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "#6b7280",
                lineHeight: 1.4,
              }}
            >
              {tabDefinition}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: 10,
              alignItems: "stretch",
            }}
          >
            <div style={summaryCardStyle(tab === "onSchedule")}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>On Schedule</div>
              <div
                style={{ marginTop: 4, fontSize: 24, fontWeight: 800, color: "#1f2937" }}
              >
                {counts.onSchedule}
              </div>
            </div>

            <div style={summaryCardStyle(tab === "active")}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>Active</div>
              <div
                style={{ marginTop: 4, fontSize: 24, fontWeight: 800, color: "#1f2937" }}
              >
                {counts.active}
              </div>
            </div>

            <div style={summaryCardStyle(tab === "applicants")}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>Applicants</div>
              <div
                style={{ marginTop: 4, fontSize: 24, fontWeight: 800, color: "#1f2937" }}
              >
                {counts.applicants}
              </div>
            </div>

            {tab === "tasks" ? (
              <div style={summaryCardStyle(true)}>
                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                  Task Bucket
                </div>
                <div
                  style={{ marginTop: 4, fontSize: 14, fontWeight: 800, color: "#1f2937" }}
                >
                  {activeTaskBucket?.title || "Tasks"}
                </div>
              </div>
            ) : (
              <div style={summaryCardStyle(false)}>
                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>Sort</div>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    border: "1px solid #d1d5db",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 13,
                    background: "#fff",
                  }}
                >
                  <option value="mostComplete">Most Complete</option>
                  <option value="leastComplete">Least Complete</option>
                  <option value="nameAsc">Name A–Z</option>
                </select>
              </div>
            )}

            <div style={summaryCardStyle(false)}>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>Showing</div>
              <div
                style={{ marginTop: 4, fontSize: 24, fontWeight: 800, color: "#1f2937" }}
              >
                {filteredPeople.length}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateColumns:
              tab === "tasks"
                ? "minmax(330px, 0.8fr) minmax(420px, 0.95fr) minmax(360px, 0.9fr)"
                : "minmax(420px, 0.95fr) minmax(360px, 0.85fr)",
            gap: 0,
          }}
        >
          {tab === "tasks" && (
            <div
              style={{
                minHeight: 0,
                borderRight: "1px solid #f1e8cb",
                background: "#fffefb",
                overflow: "auto",
                padding: 16,
              }}
            >
              <div style={{ display: "grid", gap: 12 }}>
                {taskBuckets.map((bucket) => {
                  const active = selectedTask === bucket.key;
                  return (
                    <button
                      key={bucket.key}
                      onClick={() => setSelectedTask(bucket.key)}
                      style={{
                        ...cardStyle(active),
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "start",
                          gap: 12,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>
                            {bucket.title}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: "#6b7280",
                              lineHeight: 1.4,
                            }}
                          >
                            {bucket.subtitle}
                          </div>
                        </div>

                        <span style={badgeStyle("task")}>{bucket.people.length}</span>
                      </div>

                      {!!bucket.people.length && (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 12,
                            color: "#4b5563",
                            lineHeight: 1.5,
                          }}
                        >
                          {bucket.people
                            .slice(0, 3)
                            .map((p) => prettyName(p))
                            .join(", ")}
                          {bucket.people.length > 3 ? ` +${bucket.people.length - 3} more` : ""}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{
              minHeight: 0,
              borderRight: "1px solid #f1e8cb",
              background: "#fffefb",
              overflow: "auto",
              padding: 16,
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 22,
                  border: "1px solid #eee",
                  borderRadius: 16,
                  background: "#fff",
                  color: "#6b7280",
                  fontWeight: 600,
                }}
              >
                Loading onboarding data...
              </div>
            ) : error ? (
              <div
                style={{
                  padding: 18,
                  border: "1px solid #fecaca",
                  borderRadius: 16,
                  background: "#fff1f2",
                  color: "#991b1b",
                  fontWeight: 700,
                }}
              >
                {error}
              </div>
            ) : filteredPeople.length === 0 ? (
              <div
                style={{
                  padding: 22,
                  border: "1px solid #eee",
                  borderRadius: 16,
                  background: "#fff",
                  color: "#6b7280",
                  fontWeight: 600,
                }}
              >
                {tab === "tasks"
                  ? "No people found in this task bucket."
                  : "No people found for this section."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {filteredPeople.map((p) => {
                  const name = prettyName(p);
                  const rowId = p.caregiverId || name;
                  const selected =
                    rowId ===
                    (selectedId ||
                      (filteredPeople[0]?.caregiverId || prettyName(filteredPeople[0])));

                  const teamLeaderName = resolveTeamLeaderName(p, allPeople);
                  const isOnScheduleTab = tab === "onSchedule";
                  const isActiveTab = tab === "active";
                  const showIdentityLine = !isOnScheduleTab && !isActiveTab;

                  return (
                    <div
                      key={`${rowId}-${p.interviewId || "no-interview"}`}
                      style={cardStyle(selected)}
                      onClick={() => setSelectedId(rowId)}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "48px minmax(0, 1fr)",
                          gap: 12,
                          alignItems: "start",
                        }}
                      >
                        <ProgressCircle person={p} selected={selected} size={48} />

                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "start",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 16,
                                  fontWeight: 800,
                                  color: "#1f2937",
                                  lineHeight: 1.2,
                                }}
                              >
                                {name}
                              </div>

                              {showIdentityLine && (
                                <div
                                  style={{
                                    marginTop: 4,
                                    fontSize: 13,
                                    color: "#6b7280",
                                  }}
                                >
                                  {p.caregiverId
                                    ? `Caregiver ID: ${p.caregiverId}`
                                    : p.interviewId
                                    ? `Interview ID: ${p.interviewId}`
                                    : "No ID available"}
                                </div>
                              )}
                            </div>

                            {(p.employeeInfoStatus || p.status) && (
                              <span style={badgeStyle("status")}>
                                {p.employeeInfoStatus || p.status}
                              </span>
                            )}
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            <span style={badgeStyle(p.hasLoggedIntoApp ? "appYes" : "appNo")}>
                              {p.hasLoggedIntoApp ? "App Login" : "No App Login"}
                            </span>

                            <span
                              style={badgeStyle(p.onCurrentWeek ? "scheduleYes" : "scheduleNo")}
                            >
                              {formatHoursChip("CW", p.currentWeekHours, p.onCurrentWeek)}
                            </span>

                            <span
                              style={badgeStyle(p.onNextWeek ? "scheduleYes" : "scheduleNo")}
                            >
                              {formatHoursChip("NW", p.nextWeekHours, p.onNextWeek)}
                            </span>

                            {teamLeaderName ? (
                              <span style={badgeStyle("teamLead")}>
                                {p.isTeamLeader ? "Team Leader" : `Leader: ${teamLeaderName}`}
                              </span>
                            ) : (
                              <span style={badgeStyle("noTeamLead")}>No Team Leader</span>
                            )}

                            {!hasCaregiverProfile(p) && (
                              <span style={badgeStyle("profileNo")}>No Profile</span>
                            )}

                            {p.employeePending && (
                              <span style={badgeStyle("pending")}>Pending</span>
                            )}
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              display: "grid",
                              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                              gap: 8,
                              fontSize: 13,
                              color: "#4b5563",
                            }}
                          >
                            <div>
                              <strong>Phone:</strong> {p.phone || "—"}
                            </div>
                            <div>
                              <strong>Cert:</strong> {p.certification || "—"}
                            </div>

                            {!isOnScheduleTab && !isActiveTab && (
                              <>
                                <div>
                                  <strong>Email:</strong> {p.email || "—"}
                                </div>
                                <div>
                                  <strong>Role:</strong> {p.role || "—"}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              minHeight: 0,
              overflow: "auto",
              padding: 18,
              background: "#fffdf8",
            }}
          >
            {!selectedPerson ? (
              <div
                style={{
                  padding: 20,
                  border: "1px solid #ececec",
                  borderRadius: 18,
                  background: "#fff",
                  color: "#6b7280",
                  fontWeight: 600,
                }}
              >
                Select a person to view details.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    border: "1px solid #f1e3ab",
                    borderRadius: 20,
                    background:
                      "linear-gradient(180deg, rgba(255,249,227,0.95), rgba(255,255,255,1))",
                    padding: 18,
                    boxShadow: "0 8px 20px rgba(15,23,42,0.05)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <ProgressCircle person={selectedPerson} selected size={58} />

                    <div>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 800,
                          color: "#111827",
                          lineHeight: 1.15,
                        }}
                      >
                        {prettyName(selectedPerson)}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          color: "#6b7280",
                        }}
                      >
                        {selectedPerson.caregiverId
                          ? `Caregiver ID: ${selectedPerson.caregiverId}`
                          : selectedPerson.interviewId
                          ? `Interview ID: ${selectedPerson.interviewId}`
                          : "No ID available"}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <span
                      style={badgeStyle(selectedPerson.hasLoggedIntoApp ? "appYes" : "appNo")}
                    >
                      {selectedPerson.hasLoggedIntoApp ? "Logged Into App" : "Not In App"}
                    </span>

                    <span
                      style={badgeStyle(
                        selectedPerson.onCurrentWeek ? "scheduleYes" : "scheduleNo"
                      )}
                    >
                      {formatHoursChip(
                        "CW",
                        selectedPerson.currentWeekHours,
                        selectedPerson.onCurrentWeek
                      )}
                    </span>

                    <span
                      style={badgeStyle(selectedPerson.onNextWeek ? "scheduleYes" : "scheduleNo")}
                    >
                      {formatHoursChip(
                        "NW",
                        selectedPerson.nextWeekHours,
                        selectedPerson.onNextWeek
                      )}
                    </span>

                    {resolveTeamLeaderName(selectedPerson, allPeople) ? (
                      <span style={badgeStyle("teamLead")}>
                        {selectedPerson.isTeamLeader
                          ? "Team Leader"
                          : `Leader: ${resolveTeamLeaderName(selectedPerson, allPeople)}`}
                      </span>
                    ) : (
                      <span style={badgeStyle("noTeamLead")}>No Team Leader</span>
                    )}

                    {!hasCaregiverProfile(selectedPerson) && (
                      <span style={badgeStyle("profileNo")}>Missing Caregiver Profile</span>
                    )}

                    {selectedPerson.employeePending && (
                      <span style={badgeStyle("pending")}>Pending Applicant</span>
                    )}
                  </div>
                </div>

                {tab === "tasks" &&
                  selectedTask === "scheduledNoProfile" &&
                  selectedPerson &&
                  !hasCaregiverProfile(selectedPerson) && (
                    <div
                      style={{
                        border: "1px solid #f1d7a8",
                        borderRadius: 18,
                        background: "#fffaf0",
                        padding: 18,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#1f2937",
                          marginBottom: 8,
                        }}
                      >
                        Create Caregiver Profile
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          color: "#6b7280",
                          lineHeight: 1.5,
                          marginBottom: 14,
                        }}
                      >
                        This person is on the schedule but does not have a caregiver profile yet.
                        Use the existing Google Form to create it, and choose the correct employee
                        match from the sidebar to auto-fill the details.
                      </div>

                      <button
                        onClick={() => openCreateProfileModal(selectedPerson)}
                        style={{
                          border: "1px solid #d1d5db",
                          background: "#111827",
                          color: "#fff",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Create Caregiver Profile
                      </button>
                    </div>
                  )}

                <div
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 18,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1f2937",
                      marginBottom: 12,
                    }}
                  >
                    Details
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 12,
                      fontSize: 14,
                    }}
                  >
                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Phone</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.phone || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Email</div>
                      <div
                        style={{
                          color: "#111827",
                          marginTop: 4,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {selectedPerson.email || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Certification</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.certification || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Status</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.employeeInfoStatus || selectedPerson.status || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Role</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.role || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Age</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.age || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Team</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {resolveTeamLabel(selectedPerson, allPeople)}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Caregiver Profile</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {hasCaregiverProfile(selectedPerson) ? "Yes" : "No"}
                      </div>
                    </div>

                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Address</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.address || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Interview Date</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.dateInterviewed || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Employee Row</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.employeeRowNumber ?? "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 18,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1f2937",
                      marginBottom: 12,
                    }}
                  >
                    Scheduled Shift Summary
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        background: selectedPerson.onCurrentWeek ? "#fff7db" : "#f9fafb",
                        border: "1px solid #ececec",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280" }}>
                        Current Week
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#111827",
                        }}
                      >
                        {formatHoursChip(
                          "",
                          selectedPerson.currentWeekHours,
                          selectedPerson.onCurrentWeek
                        ).replace(/^:\s*/, "")}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        background: selectedPerson.onNextWeek ? "#fff7db" : "#f9fafb",
                        border: "1px solid #ececec",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280" }}>
                        Next Week
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#111827",
                        }}
                      >
                        {formatHoursChip(
                          "",
                          selectedPerson.nextWeekHours,
                          selectedPerson.onNextWeek
                        ).replace(/^:\s*/, "")}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 18,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1f2937",
                      marginBottom: 12,
                    }}
                  >
                    App & Team Snapshot
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        background: selectedPerson.hasLoggedIntoApp ? "#eaf8ef" : "#f9fafb",
                        border: "1px solid #ececec",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280" }}>
                        App Login
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#111827",
                        }}
                      >
                        {selectedPerson.hasLoggedIntoApp ? "Logged In" : "No Login Found"}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        Count: {selectedPerson.loginCount || 0}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        background: hasTeamAssignment(selectedPerson) ? "#eef4ff" : "#f9fafb",
                        border: "1px solid #ececec",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7280" }}>
                        Team Status
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#111827",
                        }}
                      >
                        {resolveTeamLabel(selectedPerson, allPeople)}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        Members: {selectedPerson.teamMemberCount || 0}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 12,
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Last App Login</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.lastAppLoginEt || selectedPerson.lastAppLoginUtc || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Login Result</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.lastAppLoginResult || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>Latest Device</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {selectedPerson.lastAppLoginDevice || "—"}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: "#6b7280", fontWeight: 700 }}>OS / App Version</div>
                      <div style={{ color: "#111827", marginTop: 4 }}>
                        {[selectedPerson.lastAppLoginOs, selectedPerson.lastAppLoginAppVersion]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {showCreateProfileModal && (
          <div
            onClick={() => setShowCreateProfileModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2100,
              background: "rgba(15, 23, 42, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(1180px, 96vw)",
                maxHeight: "90vh",
                overflow: "auto",
                background: "#fffdf8",
                borderRadius: 24,
                border: "1px solid rgba(244,180,0,0.22)",
                boxShadow: "0 28px 80px rgba(15, 23, 42, 0.24)",
                padding: 20,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#111827",
                }}
              >
                Create Caregiver Profile
              </div>

              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: "#6b7280",
                }}
              >
                This will submit the caregiver profile to your existing Google Form. Choose a
                matching employee from the right sidebar to auto-fill the details.
              </div>

              {profileSubmitError && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid #fecaca",
                    background: "#fff1f2",
                    color: "#991b1b",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {profileSubmitError}
                </div>
              )}

              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "minmax(420px, 1fr) minmax(320px, 0.9fr)",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1f2937",
                      marginBottom: 12,
                    }}
                  >
                    Profile Form
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 14,
                    }}
                  >
                    {[
                      ["Role", "role"],
                      ["Name", "name"],
                      ["Name on Schedule", "nameOnSchedule"],
                      ["Address", "address"],
                      ["Date Interviewed", "dateInterviewed"],
                      ["Phone Number", "phoneNumber"],
                      ["Certification", "certification"],
                      ["Age", "age"],
                      ["Email Address", "emailAddress"],
                      ["Status", "status"],
                      ["Password", "password"],
                    ].map(([label, key]) => {
                      const isFullWidth = key === "address";
                      const isPassword = key === "password";
                      const isSelect = key === "role" || key === "status";

                      return (
                        <div
                          key={key}
                          style={{
                            gridColumn: isFullWidth ? "1 / -1" : undefined,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#6b7280",
                              marginBottom: 6,
                            }}
                          >
                            {label}
                          </div>

                          {isSelect ? (
                            <select
                              value={(profileForm as any)[key]}
                              onChange={(e) =>
                                setProfileForm((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              style={{
                                width: "100%",
                                border: "1px solid #d1d5db",
                                borderRadius: 12,
                                padding: "10px 12px",
                                fontSize: 14,
                                background: "#fff",
                              }}
                            >
                              {key === "role" ? (
                                <>
                                  <option value="Caregiver">Caregiver</option>
                                  <option value="Scheduler">Scheduler</option>
                                  <option value="Admin">Admin</option>
                                </>
                              ) : (
                                <>
                                  <option value="Active">Active</option>
                                  <option value="Inactive">Inactive</option>
                                </>
                              )}
                            </select>
                          ) : (
                            <input
                              type={isPassword ? "password" : "text"}
                              value={(profileForm as any)[key]}
                              onChange={(e) =>
                                setProfileForm((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              style={{
                                width: "100%",
                                border: "1px solid #d1d5db",
                                borderRadius: 12,
                                padding: "10px 12px",
                                fontSize: 14,
                                background: "#fff",
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid #ececec",
                    borderRadius: 18,
                    background: "#fff",
                    padding: 16,
                    minHeight: 220,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "start",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#1f2937",
                        }}
                      >
                        Possible Employee Matches
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: "#6b7280",
                          lineHeight: 1.4,
                        }}
                      >
                        Matches are ranked by first name and schedule-name similarity. Click one
                        to auto-fill the profile form.
                      </div>
                    </div>

                    <span style={badgeStyle("match")}>{employeeCandidates.length}</span>
                  </div>

                  {employeeMatchLoading ? (
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        background: "#f9fafb",
                        color: "#6b7280",
                        border: "1px solid #ececec",
                        fontWeight: 600,
                      }}
                    >
                      Loading employee matches...
                    </div>
                  ) : employeeMatchError ? (
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        background: "#fff1f2",
                        color: "#991b1b",
                        border: "1px solid #fecaca",
                        fontWeight: 700,
                      }}
                    >
                      {employeeMatchError}
                    </div>
                  ) : employeeCandidates.length === 0 ? (
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        background: "#f9fafb",
                        color: "#6b7280",
                        border: "1px solid #ececec",
                        fontWeight: 600,
                      }}
                    >
                      No likely employee matches found for this scheduled name.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                        maxHeight: 520,
                        overflow: "auto",
                        paddingRight: 2,
                      }}
                    >
                      {employeeCandidates.map((candidate) => {
                        const candidateKey =
                          candidate.interviewId ||
                          `${candidate.fullName}-${candidate.rowNumber ?? ""}`;
                        const selected = selectedEmployeeKey === candidateKey;

                        return (
                          <div
                            key={candidateKey}
                            style={{
                              border: selected ? "2px solid #f4b400" : "1px solid #e5e7eb",
                              borderRadius: 16,
                              background: selected ? "#fffdf5" : "#fff",
                              padding: 12,
                              boxShadow: selected
                                ? "0 8px 20px rgba(244,180,0,0.12)"
                                : "0 2px 8px rgba(15,23,42,0.04)",
                            }}
                          >
                           <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "start",
  }}
>
  <div>
    <div
      style={{
        fontSize: 15,
        fontWeight: 800,
        color: "#111827",
      }}
    >
      {candidate.fullName || "Unnamed Employee"}
    </div>
    <div
      style={{
        marginTop: 4,
        fontSize: 12,
        color: "#6b7280",
      }}
    >
      {candidate.scheduleName
        ? `Schedule Name: ${candidate.scheduleName}`
        : "No schedule name"}
    </div>
  </div>
</div>

                            <div
                              style={{
                                marginTop: 10,
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 8,
                                fontSize: 12,
                                color: "#4b5563",
                              }}
                            >
                              <div>
                                <strong>Status:</strong> {candidate.status || "—"}
                              </div>
                              <div>
                                <strong>Phone:</strong> {candidate.phone || "—"}
                              </div>
                              <div>
                                <strong>Age:</strong> {candidate.age || "—"}
                              </div>
                              <div>
                                <strong>Cert:</strong> {candidate.certification || "—"}
                              </div>
                              <div>
                                <strong>Interviewed:</strong> {candidate.dateInterviewed || "—"}
                              </div>
                              <div>
                                <strong>Email:</strong> {candidate.email || "—"}
                              </div>
                              <div style={{ gridColumn: "1 / -1" }}>
                                <strong>Address:</strong> {candidate.address || "—"}
                              </div>
                            </div>

                            <div
                              style={{
                                marginTop: 10,
                                display: "flex",
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                onClick={() => applyEmployeeCandidate(candidate)}
                                style={{
                                  border: "1px solid #d1d5db",
                                  background: selected ? "#f4b400" : "#111827",
                                  color: selected ? "#1f2937" : "#fff",
                                  borderRadius: 12,
                                  padding: "8px 12px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {selected ? "Autofill" : "Use This Employee"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                }}
              >
                <button
                  onClick={() => setShowCreateProfileModal(false)}
                  disabled={submittingProfile}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    color: "#374151",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={submitCreateProfile}
                  disabled={submittingProfile}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#111827",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    opacity: submittingProfile ? 0.7 : 1,
                  }}
                >
                  {submittingProfile ? "Submitting..." : "Submit Profile"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}