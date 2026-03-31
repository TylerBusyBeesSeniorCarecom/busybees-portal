import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

// ✅ Update this import to match your project
import { authOptions } from "@/lib/auth";

type PublishWeekType = "current" | "next";

function getPublishConfig() {
  const webhookUrl = process.env.SCHEDULE_PUBLISH_WEBHOOK_URL?.trim();
  const token = process.env.SCHEDULE_PUBLISH_TOKEN?.trim();

  if (!webhookUrl) {
    throw new Error("Missing SCHEDULE_PUBLISH_WEBHOOK_URL");
  }

  if (!token) {
    throw new Error("Missing SCHEDULE_PUBLISH_TOKEN");
  }

  return { webhookUrl, token };
}

function getActionFromWeekType(weekType: string): string {
  if (weekType === "current") return "publishCurrentWeek";
  if (weekType === "next") return "publishNextWeek";
  throw new Error("Invalid weekType. Expected 'current' or 'next'.");
}

function getUserRole(session: any): string {
  return String(
    session?.user?.role ||
      session?.user?.userRole ||
      session?.user?.appRole ||
      ""
  ).trim();
}

function getUserEmail(session: any): string {
  return String(session?.user?.email || "").trim();
}

function canPublish(role: string, email: string): boolean {
  const normalizedRole = String(role || "").toLowerCase().trim();
  const normalizedEmail = String(email || "").toLowerCase().trim();

  if (
    normalizedRole === "admin" ||
    normalizedRole === "scheduler" ||
    normalizedRole === "owner"
  ) {
    return true;
  }

  // ✅ temporary fallback until session roles are fully wired up
  return [
    "tyler@busybeesseniorcare.com",
    "office@busybeesseniorcare.com",
    "destinee@busybeesseniorcare.com",
    "kristin@busybeesseniorcare.com",
  ].includes(normalizedEmail);
}

export async function POST(req: NextRequest) {
  try {
    console.log("--------------------------------------------------");
    console.log("[publish-schedule] Incoming POST request");

    const session = await getServerSession(authOptions);

    if (!session) {
      console.error("[publish-schedule] No session found");
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const role = getUserRole(session);
    const email = getUserEmail(session);

    console.log("[publish-schedule] Session user email:", email || "(none)");
    console.log("[publish-schedule] Session user role:", role || "(none)");

    if (!canPublish(role, email)) {
  console.error("[publish-schedule] User does not have publish permission");
  return NextResponse.json(
    {
      ok: false,
      error: "You do not have permission to publish schedules.",
    },
    { status: 403 }
  );
}

    const body = await req.json();
    console.log("[publish-schedule] Raw request body:", body);

    const weekType = String(body?.weekType || "")
      .trim()
      .toLowerCase() as PublishWeekType;

    if (weekType !== "current" && weekType !== "next") {
      console.error("[publish-schedule] Invalid weekType:", weekType);
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid weekType. Expected 'current' or 'next'.",
        },
        { status: 400 }
      );
    }

    const action = getActionFromWeekType(weekType);
    const { webhookUrl, token } = getPublishConfig();

    console.log("[publish-schedule] weekType:", weekType);
    console.log("[publish-schedule] action:", action);
    console.log("[publish-schedule] Calling Apps Script webhook...");

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        token,
        requestedBy: email || "Unknown",
      }),
      cache: "no-store",
    });

    const responseText = await webhookResponse.text();

    console.log(
      "[publish-schedule] Apps Script HTTP status:",
      webhookResponse.status
    );
    console.log(
      "[publish-schedule] Apps Script raw response:",
      responseText
    );

    let data: any = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (parseError) {
      console.error(
        "[publish-schedule] Failed to parse Apps Script JSON response"
      );
      return NextResponse.json(
        {
          ok: false,
          error: "Apps Script returned invalid JSON.",
          rawResponse: responseText,
        },
        { status: 502 }
      );
    }

    if (!webhookResponse.ok) {
      console.error(
        "[publish-schedule] Apps Script returned non-OK HTTP status"
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            data?.error ||
            `Apps Script request failed with status ${webhookResponse.status}`,
          details: data,
        },
        { status: 502 }
      );
    }

    if (!data?.ok) {
      console.error("[publish-schedule] Apps Script returned ok:false");
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || "Publish failed in Apps Script.",
          details: data,
        },
        { status: 500 }
      );
    }

    console.log("[publish-schedule] Publish completed successfully");

    return NextResponse.json({
      ok: true,
      weekType,
      result: data,
    });
  } catch (error: any) {
    console.error("[publish-schedule] Route failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}