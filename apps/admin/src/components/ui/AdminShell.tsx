import React from "react";
import { SidebarNavigation } from "./SidebarNavigation";
import { TopBar } from "./TopBar";

interface AdminShellProps {
  children: React.ReactNode;
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
  authenticated: boolean;
}

export function AdminShell({ children, user, authenticated }: AdminShellProps) {
  if (!authenticated) {
    return <main>{children}</main>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--admin-bg)" }}>
      {/* Desktop Sidebar */}
      <SidebarNavigation user={user} />

      {/* Main Content Workspace */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar user={user} />
        <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1400, width: "100%", margin: "0 auto" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
