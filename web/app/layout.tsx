import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Base: your own start page",
  description:
    "Home Base is a personal start page with search, your favourite sites and your own design, on every device.",
  icons: { icon: "/icons/icon32.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before anything is painted, so pages don't flash the wrong colours.
            It must block rendering to do that, which is why it isn't deferred. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/boot.js" />
      </head>
      <body>
        {children}
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  );
}
