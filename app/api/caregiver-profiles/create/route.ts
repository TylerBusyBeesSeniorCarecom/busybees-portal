// app/api/caregiver-profiles/create/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateCaregiverProfileBody = {
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

function norm(v: unknown): string {
  return (v ?? "").toString().trim();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  try {
    console.log("--------------------------------------------------");
    console.log("[caregiver-profiles/create] Incoming POST request");

    const rawBody = await req.text();
    console.log("[caregiver-profiles/create] Raw body:", rawBody);

    let body: Partial<CreateCaregiverProfileBody> = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      console.error("[caregiver-profiles/create] ❌ Failed to parse JSON body");
      throw new Error("Invalid JSON body");
    }

    const payload: CreateCaregiverProfileBody = {
      role: norm(body.role),
      name: norm(body.name),
      nameOnSchedule: norm(body.nameOnSchedule),
      address: norm(body.address),
      dateInterviewed: norm(body.dateInterviewed),
      phoneNumber: norm(body.phoneNumber),
      certification: norm(body.certification),
      age: norm(body.age),
      emailAddress: norm(body.emailAddress),
      status: norm(body.status) || "Active",
      password: norm(body.password),
      caregiverId: norm(body.caregiverId),
    };

    console.log("[caregiver-profiles/create] Parsed payload:", payload);

    // Blank submissions are allowed for debugging / form testing.
    if (!payload.role) {
      console.warn("[caregiver-profiles/create] ⚠️ role is blank");
    }
    if (!payload.name) {
      console.warn("[caregiver-profiles/create] ⚠️ name is blank");
    }
    if (!payload.nameOnSchedule) {
      console.warn("[caregiver-profiles/create] ⚠️ nameOnSchedule is blank");
    }
    if (!payload.password) {
      console.warn("[caregiver-profiles/create] ⚠️ password is blank");
    }
    if (!payload.caregiverId) {
      console.warn("[caregiver-profiles/create] ⚠️ caregiverId is blank");
    }

    if (payload.emailAddress && !looksLikeEmail(payload.emailAddress)) {
      console.warn(
        "[caregiver-profiles/create] ⚠️ emailAddress does not look valid:",
        payload.emailAddress
      );
    }

    const formResponseUrl =
      process.env.CAREGIVER_PROFILE_FORM_RESPONSE_URL ||
      "https://docs.google.com/forms/d/e/1FAIpQLSeuBVdWipLcvns1DMM9a9LaLHWC3POrloovecOKwMX8PwLMVA/formResponse";

    console.log("[caregiver-profiles/create] Form URL:", formResponseUrl);

    const roleEntry = requireEnv("CAREGIVER_PROFILE_ROLE_ENTRY");
    const nameEntry = requireEnv("CAREGIVER_PROFILE_NAME_ENTRY");
    const nameOnScheduleEntry = requireEnv("CAREGIVER_PROFILE_NAME_ON_SCHEDULE_ENTRY");
    const addressEntry = requireEnv("CAREGIVER_PROFILE_ADDRESS_ENTRY");
    const dateInterviewedEntry = requireEnv("CAREGIVER_PROFILE_DATE_INTERVIEWED_ENTRY");
    const phoneEntry = requireEnv("CAREGIVER_PROFILE_PHONE_ENTRY");
    const certificationEntry = requireEnv("CAREGIVER_PROFILE_CERTIFICATION_ENTRY");
    const ageEntry = requireEnv("CAREGIVER_PROFILE_AGE_ENTRY");
    const emailEntry = requireEnv("CAREGIVER_PROFILE_EMAIL_ENTRY");
    const statusEntry = requireEnv("CAREGIVER_PROFILE_STATUS_ENTRY");
    const passwordEntry = requireEnv("CAREGIVER_PROFILE_PASSWORD_ENTRY");
    const caregiverIdEntry = requireEnv("CAREGIVER_PROFILE_ID_ENTRY");

    console.log("[caregiver-profiles/create] Entry mapping:");
    console.log({
      roleEntry,
      nameEntry,
      nameOnScheduleEntry,
      addressEntry,
      dateInterviewedEntry,
      phoneEntry,
      certificationEntry,
      ageEntry,
      emailEntry,
      statusEntry,
      passwordEntry,
      caregiverIdEntry,
    });

    const formData = new URLSearchParams();

    // Toggle these while debugging.
    // Start with a minimal set, then turn fields back on one at a time.
    const INCLUDE_ROLE = true;
    const INCLUDE_NAME = true;
    const INCLUDE_NAME_ON_SCHEDULE = true;
    const INCLUDE_ADDRESS = true;
    const INCLUDE_DATE_INTERVIEWED = true;
    const INCLUDE_PHONE = true;
    const INCLUDE_CERTIFICATION = true;
    const INCLUDE_AGE = true;
    const INCLUDE_EMAIL = true;
    const INCLUDE_STATUS = true;
    const INCLUDE_PASSWORD = true;
    const INCLUDE_CAREGIVER_ID = true;

    if (INCLUDE_ROLE) formData.set(roleEntry, payload.role);
    if (INCLUDE_NAME) formData.set(nameEntry, payload.name);
    if (INCLUDE_NAME_ON_SCHEDULE) formData.set(nameOnScheduleEntry, payload.nameOnSchedule);
    if (INCLUDE_ADDRESS) formData.set(addressEntry, payload.address);
    if (INCLUDE_DATE_INTERVIEWED) formData.set(dateInterviewedEntry, payload.dateInterviewed);
    if (INCLUDE_PHONE) formData.set(phoneEntry, payload.phoneNumber);
    if (INCLUDE_CERTIFICATION) formData.set(certificationEntry, payload.certification);
    if (INCLUDE_AGE) formData.set(ageEntry, payload.age);
    if (INCLUDE_EMAIL) formData.set(emailEntry, payload.emailAddress);
    if (INCLUDE_STATUS) formData.set(statusEntry, payload.status);
    if (INCLUDE_PASSWORD) formData.set(passwordEntry, payload.password);
    if (INCLUDE_CAREGIVER_ID) formData.set(caregiverIdEntry, payload.caregiverId);

    console.log("[caregiver-profiles/create] Included fields:");
    console.log({
      INCLUDE_ROLE,
      INCLUDE_NAME,
      INCLUDE_NAME_ON_SCHEDULE,
      INCLUDE_ADDRESS,
      INCLUDE_DATE_INTERVIEWED,
      INCLUDE_PHONE,
      INCLUDE_CERTIFICATION,
      INCLUDE_AGE,
      INCLUDE_EMAIL,
      INCLUDE_STATUS,
      INCLUDE_PASSWORD,
      INCLUDE_CAREGIVER_ID,
    });

    console.log("[caregiver-profiles/create] Encoded body:");
    console.log(formData.toString());

    const start = Date.now();

    const response = await fetch(formResponseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
      },
      body: formData.toString(),
      redirect: "manual",
      cache: "no-store",
    });

    const duration = Date.now() - start;

    console.log("[caregiver-profiles/create] Response status:", response.status);
    console.log("[caregiver-profiles/create] Duration (ms):", duration);

    console.log("[caregiver-profiles/create] Response headers:");
    response.headers.forEach((v, k) => {
      console.log(`  ${k}: ${v}`);
    });

    const text = await response.text();

    console.log("[caregiver-profiles/create] Response length:", text.length);
    console.log("[caregiver-profiles/create] Response preview (first 1500 chars):");
    console.log(text.slice(0, 1500));

    console.log("[caregiver-profiles/create] Response preview (last 500 chars):");
    console.log(text.slice(-500));

    const interestingSnippets = [
      "Something went wrong",
      "invalid",
      "required",
      "response",
      "email",
      "date",
      "choice",
      "must be",
      "login",
      "sign in",
      "caregiver",
      "entry.",
    ];

    for (const snippet of interestingSnippets) {
      if (text.toLowerCase().includes(snippet.toLowerCase())) {
        console.log(`[caregiver-profiles/create] HTML contains: ${snippet}`);
      }
    }

    const okStatuses = [200, 302, 303];

    if (!okStatuses.includes(response.status)) {
      console.error("[caregiver-profiles/create] ❌ FAILED SUBMISSION");
      throw new Error(
        `Google Form submission failed (${response.status}). Check logs above.`
      );
    }

    console.log("[caregiver-profiles/create] ✅ SUCCESS");

    return NextResponse.json({
      ok: true,
      message: "Caregiver profile form submitted successfully.",
    });
  } catch (err: any) {
    console.error("[caregiver-profiles/create] ❌ ERROR OCCURRED:");
    console.error(err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}