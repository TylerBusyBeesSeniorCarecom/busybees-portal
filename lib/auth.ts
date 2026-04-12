import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { google } from "googleapis";

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
  name: string;
  email: string;
  role: string;
  caregiverId: string;
};

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
      if (account?.provider === "credentials") {
        return true;
      }

      if (account?.provider === "google") {
        const email =
          user?.email ||
          (typeof profile?.email === "string" ? profile.email : "");

        if (!email) return false;

        const adminUser = await findAdminByEmail(email);
        return !!adminUser;
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

        if (typeof user?.role === "string") {
          token.role = user.role;
        }

        if (typeof user?.caregiverId === "string") {
          token.caregiverId = user.caregiverId;
        }

        if (account?.provider === "google" && token.email) {
          const adminUser = await findAdminByEmail(String(token.email));
          if (adminUser) {
            token.role = adminUser.role;
            token.caregiverId = adminUser.caregiverId;
          }
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
        session.user.caregiverId =
          typeof token.caregiverId === "string" ? token.caregiverId : "";
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};