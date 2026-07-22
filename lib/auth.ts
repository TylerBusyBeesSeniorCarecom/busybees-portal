import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { google } from "googleapis";

import { adminDb } from "@/lib/firebaseAdmin";

function norm(v: unknown) {
  return (v ?? "").toString().trim();
}

function normalizeKey(s: string) {
  return norm(s).toLowerCase();
}

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY in environment");
  }

  const credentials = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getCaregiversSheetRows() {
  const spreadsheetId = process.env.SCHEDULE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing SCHEDULE_SPREADSHEET_ID in environment");
  }

  const tabName = process.env.CAREGIVERS_TAB_NAME || "Caregivers";
  const range = `${tabName}!A1:Z2000`;

  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });

  return (resp.data.values ?? []) as string[][];
}

type AuthUser = {
  id: string;
  uid: string;
  name: string;
  email: string;
  role: string;
  caregiverId: string;
};

const ALLOWED_PORTAL_ROLES = new Set(["admin", "scheduler", "beekeeper"]);
const GOOGLE_WORKSPACE_DOMAIN =
  (process.env.GOOGLE_WORKSPACE_DOMAIN || "busybeeseniorcare.com").trim().toLowerCase();

function isAllowedPortalRole(role: string) {
  return ALLOWED_PORTAL_ROLES.has(normalizeKey(role));
}

function isAllowedGoogleWorkspaceEmail(email: string) {
  const normalizedEmail = normalizeKey(email);
  return normalizedEmail.endsWith(`@${GOOGLE_WORKSPACE_DOMAIN}`);
}

async function findPortalUserByEmail(email: string): Promise<AuthUser | null> {
  const normalizedEmail = norm(email).toLowerCase();
  if (!normalizedEmail) return null;

  const candidates = [...new Set([norm(email), normalizedEmail])].filter(Boolean);

  for (const candidate of candidates) {
    const snapshot = await adminDb
      .collection("users")
      .where("email", "==", candidate)
      .limit(1)
      .get();

    if (snapshot.empty) continue;

    const doc = snapshot.docs[0];
    const data = doc.data() as Record<string, unknown>;
    const role = norm(data.role);
    if (!isAllowedPortalRole(role)) {
      return null;
    }

    const caregiverId = norm(data.caregiverId) || doc.id;
    const resolvedEmail = norm(data.email) || normalizedEmail;
    const name =
      norm(data.displayName) ||
      norm(data.nameOnSchedule) ||
      norm(data.name) ||
      resolvedEmail ||
      doc.id;

    return {
      id: doc.id,
      uid: doc.id,
      caregiverId,
      email: resolvedEmail,
      name,
      role,
    };
  }

  return null;
}

async function findAdminByCredentials(username: string, password: string): Promise<AuthUser | null> {
  const values = await getCaregiversSheetRows();
  if (!values.length) return null;

  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) =>
    headers.findIndex((h) => normalizeKey(h) === normalizeKey(name));

  const iCaregiverId = idx("Caregiver ID");
  const iName = idx("Name");
  const iNameOnSchedule = idx("Name on schedule");
  const iEmail =
    idx("Email Address") >= 0 ? idx("Email Address") : idx("Email");
  const iPassword = idx("Password");
  const iRole = idx("Role");

  for (const row of rows) {
    const rowEmail = iEmail >= 0 ? norm(row[iEmail]) : "";
    const rowPassword = iPassword >= 0 ? norm(row[iPassword]) : "";
    const rowRole = iRole >= 0 ? norm(row[iRole]) : "";

    const emailMatches = normalizeKey(rowEmail) === normalizeKey(username);
    const passwordMatches = rowPassword === password;
    const isAdmin = normalizeKey(rowRole) === "admin";

    if (emailMatches && passwordMatches && isAdmin) {
      const caregiverId = iCaregiverId >= 0 ? norm(row[iCaregiverId]) : "";
      const fullName = iName >= 0 ? norm(row[iName]) : "";
      const scheduleName = iNameOnSchedule >= 0 ? norm(row[iNameOnSchedule]) : "";

      return {
        id: caregiverId || rowEmail,
        uid: caregiverId || rowEmail,
        caregiverId,
        name: fullName || scheduleName || rowEmail,
        email: rowEmail,
        role: rowRole,
      };
    }
  }

  return null;
}

async function findAdminByEmail(email: string): Promise<AuthUser | null> {
  const values = await getCaregiversSheetRows();
  if (!values.length) return null;

  const headers = values[0].map((h) => norm(h));
  const rows = values.slice(1);

  const idx = (name: string) =>
    headers.findIndex((h) => normalizeKey(h) === normalizeKey(name));

  const iCaregiverId = idx("Caregiver ID");
  const iName = idx("Name");
  const iNameOnSchedule = idx("Name on schedule");
  const iEmail =
    idx("Email Address") >= 0 ? idx("Email Address") : idx("Email");
  const iRole = idx("Role");

  for (const row of rows) {
    const rowEmail = iEmail >= 0 ? norm(row[iEmail]) : "";
    const rowRole = iRole >= 0 ? norm(row[iRole]) : "";

    const emailMatches = normalizeKey(rowEmail) === normalizeKey(email);
    const isAdmin = normalizeKey(rowRole) === "admin";

    if (emailMatches && isAdmin) {
      const caregiverId = iCaregiverId >= 0 ? norm(row[iCaregiverId]) : "";
      const fullName = iName >= 0 ? norm(row[iName]) : "";
      const scheduleName = iNameOnSchedule >= 0 ? norm(row[iNameOnSchedule]) : "";

      return {
        id: caregiverId || rowEmail,
        uid: caregiverId || rowEmail,
        caregiverId,
        name: fullName || scheduleName || rowEmail,
        email: rowEmail,
        role: rowRole,
      };
    }
  }

  return null;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),

    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = norm(credentials?.username);
        const password = norm(credentials?.password);

        if (!username || !password) return null;

        const user = await findAdminByCredentials(username, password);
        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          caregiverId: user.caregiverId,
        };
      },
    }),
  ],

  pages: {
    signIn: "/",
  },

  callbacks: {
    async signIn({ user, account, profile }) {
      const email =
        user?.email ||
        (typeof profile?.email === "string" ? profile.email : "");

      if (account?.provider === "credentials") {
        if (!email) return "/?error=portal_user_not_found";
        const portalUser = await findPortalUserByEmail(email);
        return portalUser ? true : "/?error=portal_user_not_found";
      }

      if (account?.provider === "google") {
        if (!email) return false;
        if (!isAllowedGoogleWorkspaceEmail(email)) {
          return "/?error=workspace_domain_required";
        }

        const portalUser = await findPortalUserByEmail(email);
        return portalUser ? true : "/?error=portal_user_not_found";
      }

      return false;
    },

    async jwt({ token, user, profile, account }) {
      if (user || profile) {
        token.name =
          user?.name ||
          (typeof profile?.name === "string" ? profile.name : "") ||
          token.name;

        token.email =
          user?.email ||
          (typeof profile?.email === "string" ? profile.email : "") ||
          token.email;

        if (user?.image) token.picture = user.image;

        if (account?.provider && token.email) {
          const portalUser = await findPortalUserByEmail(String(token.email));
          if (!portalUser) {
            token.role = "";
            token.caregiverId = "";
            token.uid = "";
            token.authError = "portal_user_not_found";
            return token;
          }

          token.role = portalUser.role;
          token.caregiverId = portalUser.caregiverId;
          token.uid = portalUser.uid;
          token.name = portalUser.name || token.name;
          token.email = portalUser.email || token.email;
          delete token.authError;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.name = typeof token.name === "string" ? token.name : "";
        session.user.email = typeof token.email === "string" ? token.email : "";
        session.user.image =
          typeof token.picture === "string" ? token.picture : null;
        session.user.role = typeof token.role === "string" ? token.role : "";
        session.user.uid = typeof token.uid === "string" ? token.uid : "";
        session.user.caregiverId =
          typeof token.caregiverId === "string" ? token.caregiverId : "";
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
