import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  // Fixed locale + UTC would drift from the user's clock; en-US with an
  // explicit shape keeps server and client output identical for a given
  // timestamp, which matters because these render during SSR.
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** "3h ago" for a millisecond age. The single implementation — callers differ
 *  only in the unit they start from (ISO strings vs Drawer 2's Unix seconds). */
export function formatAge(msAgo: number): string {
  if (msAgo < 60_000)     return "just now";
  if (msAgo < 3_600_000)  return `${Math.floor(msAgo / 60_000)}m ago`;
  if (msAgo < 86_400_000) return `${Math.floor(msAgo / 3_600_000)}h ago`;
  return `${Math.floor(msAgo / 86_400_000)}d ago`;
}

export function formatRelative(isoString: string): string {
  return formatAge(Date.now() - new Date(isoString).getTime());
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
