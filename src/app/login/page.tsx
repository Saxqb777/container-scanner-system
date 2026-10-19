"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Login failed");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <h1>Seal Register</h1>
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="msg msg-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Checking..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
