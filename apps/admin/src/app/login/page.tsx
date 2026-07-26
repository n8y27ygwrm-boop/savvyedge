"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div style={{ maxWidth: 400, margin: "100px auto", padding: 24, border: "1px solid #ccc", borderRadius: 8 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>SavvyEdge Admin Governance</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
        Enter administrative credentials to access the workflow review queue.
      </p>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#991b1b", borderRadius: 4, fontSize: 14 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: "bold" }}>
            Email Address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ccc" }}
            required
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: "bold" }}>
            Admin Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ccc" }}
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: 10, background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Authenticating..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
