"use client";

import { useState } from "react";
import { cn, getInitials } from "@/lib/utils";

interface AvatarProps {
  name: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const sizeClass = sizeMap[size];
  // A missing image falls back to initials rather than collapsing to blank
  // space — character cards often reference avatars that aren't present.
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn("rounded-full object-cover flex-shrink-0", sizeClass, className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-[var(--purple-light)] text-[var(--purple-fg)] font-semibold flex items-center justify-center flex-shrink-0 select-none",
        sizeClass,
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
