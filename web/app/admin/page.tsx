import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/dashboard";

export const metadata: Metadata = {
  title: "Home Base admin",
  robots: { index: false },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
