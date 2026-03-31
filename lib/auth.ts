import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],

  pages: {
    signIn: "/",
  },

  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase() || "";
      return email.endsWith("@busybeesseniorcare.com");
    },

    async jwt({ token, user, profile }) {
      // On first sign in, persist the important user fields into the token
      if (user || profile) {
        token.name =
          user?.name ||
          (typeof profile?.name === "string" ? profile.name : "") ||
          token.name;

        token.email =
          user?.email ||
          (typeof profile?.email === "string" ? profile.email : "") ||
          token.email;

        // Optional: keep image if you want it later
        if (user?.image) token.picture = user.image;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.name = typeof token.name === "string" ? token.name : "";
        session.user.email = typeof token.email === "string" ? token.email : "";
        session.user.image = typeof token.picture === "string" ? token.picture : null;
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};