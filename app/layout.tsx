import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import "./globals.css";

// The faces the design system names. Loaded through next/font so they are
// self-hosted and carry no layout shift on first paint.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const baskerville = Libre_Baskerville({
  variable: "--font-baskerville",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "AM News",
  description: "Discovery, connection and intelligence for inward investment",
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${baskerville.variable}`}
    >
      <body>
        {children}
      </body>
    </html>
  );
}
