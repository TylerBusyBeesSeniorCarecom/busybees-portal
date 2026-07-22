import NextAuth from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name: string;
      email: string;
      image?: string | null;
      role: string;
      uid: string;
      caregiverId: string;
    };
  }

  interface User {
    role?: string;
    uid?: string;
    caregiverId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    name?: string;
    email?: string;
    picture?: string;
    role?: string;
    uid?: string;
    caregiverId?: string;
    authError?: string;
  }
}
