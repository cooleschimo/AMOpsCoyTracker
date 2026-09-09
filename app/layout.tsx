import type { Metadata } from "next";
import Link from "next/link";
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

const NAV = [
  { href: "/", label: "This week" },
  { href: "/monitoring", label: "Monitoring" },
  { href: "/graph", label: "Connections" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${baskerville.variable}`}
    >
      <body>
        <header className="border-b border-border bg-card/70 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-6 gap-y-2 px-6 py-4 pl-16 sm:px-12 sm:pl-20 lg:px-16 lg:pl-24">
            <Link href="/" className="text-lg font-semibold tracking-tight text-primary">
              AM News
            </Link>
            <nav className="flex flex-wrap gap-x-5 gap-y-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
