import { clsx } from "clsx";
import type React from "react";

export function Logo({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={clsx("flex items-center gap-2", className)} {...props}>
      <div className="flex size-7 items-center justify-center rounded-lg bg-mox-sapphire">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="size-4"
          aria-hidden="true"
        >
          <path
            d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z"
            fill="white"
            fillOpacity="0.9"
          />
          <path
            d="M8 3L12 5.5V10.5L8 13L4 10.5V5.5L8 3Z"
            fill="#2563eb"
          />
        </svg>
      </div>
      <span className="text-sm font-semibold tracking-tight text-gray-950 dark:text-white">
        Mox Market
      </span>
    </div>
  );
}

export function LogoMark({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={clsx(
        "flex size-7 items-center justify-center rounded-lg bg-mox-sapphire",
        className,
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="size-4"
        aria-hidden="true"
      >
        <path
          d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z"
          fill="white"
          fillOpacity="0.9"
        />
        <path
          d="M8 3L12 5.5V10.5L8 13L4 10.5V5.5L8 3Z"
          fill="#2563eb"
        />
      </svg>
    </div>
  );
}
