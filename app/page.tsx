"use client";

import SignInCard from "@/app/components/auth/SignInCard";

export default function Home() {
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

        <SignInCard />
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
