import type { Metadata } from "next";
import { StartPage } from "@/components/home/start-page";

export const metadata: Metadata = { title: "New Tab" };

export default function NewTabPage() {
  return <StartPage />;
}
