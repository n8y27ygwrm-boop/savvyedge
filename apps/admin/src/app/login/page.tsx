"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { LoadingButton } from "@/components/ui/LoadingButton";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Invalid email or password");
        setLoading(false);
        return;
      }

      router.push("/review");
      router.refresh();
    } catch {
      setError("Network error occurred");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "radial-gradient(ellipse at top, #1e293b 0%, #090a0f 70%)",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%" }}>
        <GlassPanel raised padding="36px">
          {/* Logo & Title */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "linear-gradient(135deg, #2563eb, #0d9488)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 22,
                color: "#fff",
                boxShadow: "0 4px 20px rgba(37, 99, 235, 0.4)",
                marginBottom: 16,
              }}
            >
              S
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--admin-text)", margin: "0 0 6px 0", letterSpacing: "-0.01em" }}>
              SavvyEdge Governance Console
            </h1>
            <p style={{ fontSize: 13, color: "var(--admin-muted)", margin: 0, lineHeight: 1.5 }}>
              Authenticate with administrative credentials to access the intelligence workflow operator workstation.
            </p>
          </div>

          {error && (
            <InlineAlert
              type="error"
              message={error}
              onDismiss={() => setError(null)}
              style={{ marginBottom: 20 }}
            />
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="email"
                style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "var(--admin-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "rgba(0, 0, 0, 0.4)",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
                required
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                htmlFor="password"
                style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: "var(--admin-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Admin Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "rgba(0, 0, 0, 0.4)",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
                required
              />
            </div>

            <LoadingButton
              type="submit"
              loading={loading}
              style={{ width: "100%", padding: 12, fontSize: 14 }}
            >
              {loading ? "Authenticating Operator..." : "Sign In to Operations Console"}
            </LoadingButton>
          </form>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--admin-border)", textAlign: "center", fontSize: 11, color: "var(--admin-muted-dark)" }}>
            SavvyEdge Security & Governance System • Authorized Personnel Only
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
