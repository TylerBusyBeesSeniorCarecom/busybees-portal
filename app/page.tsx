"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [isCredentialsSigningIn, setIsCredentialsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleGoogleSignIn() {
    try {
      setErrorMessage("");
      setIsGoogleSigningIn(true);
      await signIn("google", { callbackUrl: "/schedule" });
    } catch (error) {
      console.error("Google sign-in failed:", error);
      setErrorMessage("Google sign-in failed. Please try again.");
      setIsGoogleSigningIn(false);
    }
  }

  async function handleCredentialsSignIn(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    try {
      setErrorMessage("");

      const cleanUsername = username.trim();

      if (!cleanUsername || !password) {
        setErrorMessage("Please enter your username and password.");
        return;
      }

      setIsCredentialsSigningIn(true);

      const result = await signIn("credentials", {
        username: cleanUsername,
        password,
        redirect: false,
        callbackUrl: "/schedule",
      });

      if (!result) {
        setErrorMessage("Sign-in failed. Please try again.");
        setIsCredentialsSigningIn(false);
        return;
      }

      if (result.error) {
        setErrorMessage("Invalid username, password, or access level.");
        setIsCredentialsSigningIn(false);
        return;
      }

      window.location.href = result.url || "/schedule";
    } catch (error) {
      console.error("Credentials sign-in failed:", error);
      setErrorMessage("Sign-in failed. Please try again.");
      setIsCredentialsSigningIn(false);
    }
  }

  const isBusy = isGoogleSigningIn || isCredentialsSigningIn;

  return (
    <main
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top left, rgba(250,204,21,0.16), transparent 28%), radial-gradient(circle at bottom right, rgba(245,158,11,0.12), transparent 24%), linear-gradient(180deg, #0f172a 0%, #111827 45%, #0b1220 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -120,
          left: -80,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "rgba(250, 204, 21, 0.10)",
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -140,
          right: -80,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: "rgba(245, 158, 11, 0.10)",
          filter: "blur(70px)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.08,
          backgroundImage:
            "radial-gradient(circle, #facc15 1px, transparent 1.2px)",
          backgroundSize: "28px 28px",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.2))",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.2))",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 1080,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 28,
          alignItems: "stretch",
        }}
      >
        <section
          style={{
            background:
              "linear-gradient(180deg, rgba(17,24,39,0.92) 0%, rgba(15,23,42,0.96) 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 28,
            padding: "42px 40px",
            boxShadow: "0 30px 90px rgba(0,0,0,0.45)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 620,
            backdropFilter: "blur(10px)",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                borderRadius: 999,
                background: "rgba(250,204,21,0.10)",
                border: "1px solid rgba(250,204,21,0.20)",
                color: "#fde68a",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.2,
              }}
            >
              <span style={{ fontSize: 16 }}>🐝</span>
              Busy Bees Senior Care
            </div>

            <h1
              style={{
                marginTop: 28,
                marginBottom: 14,
                fontSize: 46,
                lineHeight: 1.06,
                fontWeight: 800,
                letterSpacing: -1.2,
              }}
            >
              Scheduler
              <br />
              Portal
            </h1>

            <p
              style={{
                maxWidth: 520,
                fontSize: 18,
                lineHeight: 1.7,
                color: "rgba(255,255,255,0.78)",
                margin: 0,
              }}
            >
              One secure place for scheduling, staffing visibility, and daily
              operations across the Busy Bees team.
            </p>

            <div
              style={{
                marginTop: 34,
                display: "grid",
                gap: 14,
                maxWidth: 520,
              }}
            >
              {[
                "View and manage weekly schedules",
                "Access caregiver and client workflow tools",
                "Sign in with Google or your portal credentials",
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    color: "rgba(255,255,255,0.86)",
                    fontSize: 15,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: "rgba(250,204,21,0.14)",
                      border: "1px solid rgba(250,204,21,0.28)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#facc15",
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </div>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: 30,
              paddingTop: 24,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: "rgba(255,255,255,0.52)",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Access
              </div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>
                Admin portal access
              </div>
            </div>

            <div>
              <div
                style={{
                  color: "rgba(255,255,255,0.52)",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Environment
              </div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>
                Busy Bees Operations
              </div>
            </div>
          </div>
        </section>

        <section
          style={{
            background: "rgba(255,255,255,0.96)",
            borderRadius: 28,
            padding: "38px 34px",
            boxShadow: "0 30px 90px rgba(0,0,0,0.34)",
            border: "1px solid rgba(255,255,255,0.65)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minHeight: 620,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(180deg, #fde68a 0%, #facc15 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              boxShadow: "0 14px 30px rgba(234,179,8,0.28)",
              marginBottom: 22,
            }}
          >
            🐝
          </div>

          <div
            style={{
              color: "#b45309",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Welcome back
          </div>

          <h2
            style={{
              margin: 0,
              fontSize: 34,
              lineHeight: 1.15,
              color: "#111827",
              fontWeight: 800,
              letterSpacing: -0.8,
            }}
          >
            Sign in to continue
          </h2>

          <p
            style={{
              marginTop: 14,
              marginBottom: 28,
              color: "#4b5563",
              fontSize: 15,
              lineHeight: 1.7,
            }}
          >
            Sign in with your Busy Bees admin email and password, or continue
            with Google if your account is enabled for it.
          </p>

          <div
            style={{
              background: "#fffaf0",
              border: "1px solid #fde68a",
              color: "#92400e",
              borderRadius: 16,
              padding: "14px 16px",
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 22,
            }}
          >
            This portal is restricted to authorized admin users.
          </div>

          <form
            onSubmit={handleCredentialsSignIn}
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <label
                htmlFor="username"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Email address"
                disabled={isBusy}
                style={{
                  width: "100%",
                  padding: "15px 16px",
                  borderRadius: 14,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#111827",
                  fontSize: 15,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <label
                htmlFor="password"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                disabled={isBusy}
                style={{
                  width: "100%",
                  padding: "15px 16px",
                  borderRadius: 14,
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#111827",
                  fontSize: 15,
                  outline: "none",
                }}
              />
            </div>

            {errorMessage ? (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  borderRadius: 14,
                  padding: "12px 14px",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isBusy}
              style={{
                width: "100%",
                padding: "15px 16px",
                borderRadius: 14,
                border: "none",
                background: isBusy
                  ? "#e5e7eb"
                  : "linear-gradient(180deg, #facc15 0%, #f59e0b 100%)",
                color: "#111827",
                fontSize: 16,
                fontWeight: 800,
                cursor: isBusy ? "not-allowed" : "pointer",
                boxShadow: isBusy
                  ? "none"
                  : "0 14px 28px rgba(245,158,11,0.22)",
                transition: "all 0.18s ease",
              }}
            >
              {isCredentialsSigningIn ? "Signing you in..." : "Sign in with username and password"}
            </button>
          </form>

          <div
            style={{
              marginTop: 22,
              marginBottom: 22,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#9ca3af",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              Or
            </div>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isBusy}
            style={{
              width: "100%",
              padding: "15px 16px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: isBusy
                ? "#e5e7eb"
                : "linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
              cursor: isBusy ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              boxShadow: isBusy ? "none" : "0 10px 24px rgba(15,23,42,0.08)",
              transition: "all 0.18s ease",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#fff",
                border: "1px solid #e5e7eb",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              G
            </span>
            {isGoogleSigningIn ? "Signing you in..." : "Continue with Google"}
          </button>

          <div
            style={{
              marginTop: 18,
              fontSize: 12,
              color: "#6b7280",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Need help accessing the portal? Contact a Busy Bees administrator or
            your team lead.
          </div>

          <div
            style={{
              marginTop: 30,
              paddingTop: 18,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 12,
              color: "#6b7280",
            }}
          >
            <span>Busy Bees Senior Care</span>
            <span>Secure staff access</span>
          </div>
        </section>
      </div>

      <style jsx>{`
        @media (max-width: 920px) {
          main > div {
            grid-template-columns: 1fr !important;
            max-width: 560px !important;
          }
        }

        @media (max-width: 640px) {
          main {
            padding: 16px !important;
          }
        }
      `}</style>
    </main>
  );
}