import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * What to call a profile link, by where it points.
 *
 * Most are LinkedIn, but not all — an org chart or a fund's own team page shows
 * up too. Saying "profile" everywhere hides which; naming the host tells a
 * reader what they are about to open.
 */
export function profileLabel(url: string | null | undefined): string {
  if (!url) return "profile";
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (host.endsWith("linkedin.com")) return "LinkedIn";
  if (host.endsWith("crunchbase.com")) return "Crunchbase";
  if (host.endsWith("theorg.com")) return "The Org";
  if (host.endsWith("x.com") || host.endsWith("twitter.com")) return "X";
  if (host.endsWith("github.com")) return "GitHub";
  return "profile";
}
