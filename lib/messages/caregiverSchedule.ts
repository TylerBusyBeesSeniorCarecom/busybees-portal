import { normalizeKey, type CaregiverProfile, type ShiftRow } from "@/app/sheets-tools/shared";

type CaregiverScheduleContext = {
  caregiverID: string;
  nameOnSchedule: string;
};

type CaregiverLookupProfile = Partial<Pick<CaregiverProfile, "caregiverId" | "nameOnSchedule" | "name">>;

function candidateStrings(args: {
  caregiverID: string;
  caregiversById: Record<string, CaregiverLookupProfile>;
  idByNameOnSchedule: Record<string, string>;
}) {
  const profile = args.caregiversById[args.caregiverID];
  const resolvedScheduleID =
    args.idByNameOnSchedule[normalizeKey(profile?.nameOnSchedule || "")] ||
    args.idByNameOnSchedule[normalizeKey(profile?.name || "")] ||
    "";

  return {
    profile,
    resolvedScheduleID,
    aliases: new Set(
      [
        args.caregiverID,
        profile?.caregiverId || "",
        profile?.nameOnSchedule || "",
        profile?.name || "",
        resolvedScheduleID,
      ]
        .map((value) => normalizeKey(value))
        .filter(Boolean)
    ),
  };
}

export function resolveCaregiverScheduleContext(args: {
  caregiverID: string;
  caregiversById: Record<string, CaregiverLookupProfile>;
  idByNameOnSchedule: Record<string, string>;
}): CaregiverScheduleContext | null {
  const { profile, resolvedScheduleID } = candidateStrings(args);

  if (profile) {
    return {
      caregiverID: profile.caregiverId || args.caregiverID || resolvedScheduleID || "",
      nameOnSchedule: profile.nameOnSchedule || profile.name || "",
    };
  }

  if (resolvedScheduleID) {
    const matched = args.caregiversById[resolvedScheduleID];
    if (matched) {
      return {
        caregiverID: matched.caregiverId || resolvedScheduleID,
        nameOnSchedule: matched.nameOnSchedule || matched.name || "",
      };
    }
  }

  return null;
}

export function getShiftsForCaregiver(args: {
  rows: ShiftRow[];
  caregiverID: string;
  caregiversById: Record<string, CaregiverLookupProfile>;
  idByNameOnSchedule: Record<string, string>;
  caregiverNameOnSchedule?: string;
}) {
  const resolved = resolveCaregiverScheduleContext(args);
  if (!resolved?.nameOnSchedule && !args.caregiverNameOnSchedule) return [];

  const { aliases } = candidateStrings(args);
  if (resolved) {
    aliases.add(normalizeKey(resolved.nameOnSchedule));
    aliases.add(normalizeKey(resolved.caregiverID));
  }
  aliases.add(normalizeKey(args.caregiverNameOnSchedule || ""));

  return args.rows.filter((row) => {
    const rowCaregiverID = normalizeKey(row.caregiverId);
    const rowCaregiverName = normalizeKey(row.caregiver);
    return Boolean(
      (rowCaregiverID && aliases.has(rowCaregiverID)) ||
        (rowCaregiverName && aliases.has(rowCaregiverName))
    );
  });
}
