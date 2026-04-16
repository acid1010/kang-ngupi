"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border transition-colors",
        variant === "default" && "bg-[#1F8A8A]/20 text-[#3CC8C8] border-[#1F8A8A]/30",
        variant === "outline" && "border-[#2a5555] text-white/80",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
