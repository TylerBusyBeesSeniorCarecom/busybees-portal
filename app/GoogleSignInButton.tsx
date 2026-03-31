"use client";

import { signIn } from "next-auth/react";

export default function GoogleSignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/schedule" })}
      style={{
        display: "block",
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid #333",
        background: "#111",
        color: "white",
        fontSize: 16,
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      Sign in with Google
    </button>
  );
}