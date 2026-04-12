import NextAuth from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name: string;
      email: string;
      image?: string | null;
      role: string;
      caregiverId: string;
    };
  }

  interface User {
    role?: string;
    caregiverId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    name?: string;
    email?: string;
    picture?: string;
    role?: string;
    caregiverId?: string;
  }
}