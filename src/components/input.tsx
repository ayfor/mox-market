"use client";

import { clsx } from "clsx";
import type React from "react";

export function TextInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={clsx(
        className,
        "block w-full rounded-lg bg-white px-3 py-1.5",
        "text-base/6 text-gray-950 sm:text-sm/6 dark:text-white",
        "outline -outline-offset-1 outline-gray-950/15 focus:outline-2 focus:outline-mox-sapphire dark:bg-white/10 dark:outline-white/15 dark:focus:outline-mox-sapphire-light",
      )}
      {...props}
    />
  );
}
