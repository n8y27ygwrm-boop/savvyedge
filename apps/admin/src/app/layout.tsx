import type { Metadata } from "next";
import { verifyAdminSession } from "@/lib/auth";
import { AdminShell } from "@/components/ui/AdminShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "SavvyEdge Admin Governance",
  description: "Internal SavvyEdge Workflow Governance Administration Console",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await verifyAdminSession();
  const { authenticated, user } = session;

  return (
    <html lang="en">
      <body>
        <AdminShell authenticated={authenticated} user={user}>
          {children}
        </AdminShell>
      </body>
    </html>
  );
}
