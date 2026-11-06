import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/components/wallet-provider";
import { Toaster } from "sonner";
import "@near-wallet-selector/modal-ui/styles.css";

export const metadata: Metadata = {
  title: "ProofPay — Agreements, verified.",
  description: "Non-custodial milestone escrow and cross-chain payouts, secured by NEAR.",
  applicationName: "ProofPay",
  icons: { icon: "/proofpay-mark.svg" },
};

export const viewport: Viewport = { themeColor: "#0B0F17" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <WalletProvider>{children}</WalletProvider>
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
