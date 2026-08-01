import { formatAge } from "@/lib/utils";

/** Format a Unix-seconds timestamp (Drawer 2's unit) as a relative string */
export function formatRelativeTime(unixSeconds: number): string {
  return formatAge(Date.now() - unixSeconds * 1000);
}

/** Format a Unix-seconds timestamp as an absolute date string */
export function formatAbsTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
