"use client";

import { clsx } from "clsx";
import type React from "react";
import { useEffect, useRef } from "react";

// ----- Shared Spinner -----

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("animate-spin text-gray-400", className)}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ----- Shared Search Input -----

const INPUT_CLASSES = clsx(
  "block w-full rounded-lg bg-white px-3 py-1.5",
  "text-sm/6 text-gray-950 dark:text-white",
  "outline -outline-offset-1 outline-gray-950/15",
  "placeholder:text-gray-400 dark:placeholder:text-gray-500",
  "focus:outline-2 focus:outline-mox-sapphire",
  "dark:bg-white/10 dark:outline-white/15 dark:focus:outline-mox-sapphire-light",
);

// ----- Generic Suggestion List -----

export interface SuggestionListProps<T> {
  /** Current input value — controlled by parent */
  query: string;
  /** Called when the input value changes */
  onQueryChange: (value: string) => void;
  /** Input placeholder text */
  placeholder: string;
  /** Items to display in the list */
  items: T[];
  /** Unique key for each item */
  keyExtractor: (item: T) => string;
  /** Render a single list item */
  renderItem: (item: T, isHighlighted: boolean) => React.ReactNode;
  /** Called when an item is selected */
  onSelect: (item: T) => void;
  /** Whether an item is disabled (greyed out, not clickable) */
  isDisabled?: (item: T) => boolean;
  /** Show loading state instead of items */
  isLoading?: boolean;
  /** Loading message shown alongside spinner */
  loadingMessage?: string;
  /** Message shown when items array is empty and not loading */
  emptyMessage?: string;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
  /** Show a spinner inside the input */
  inputLoading?: boolean;
  /** Index of keyboard-highlighted item (-1 for none) */
  highlightedIndex?: number;
  /** Additional keyboard handler for the input */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Called when the input receives focus */
  onFocus?: () => void;
  /** Ref to the input element */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Ref to the list container (for outside-click detection) */
  listRef?: React.RefObject<HTMLDivElement | null>;
  /** Additional padding class for the input (e.g., pr-8 for spinner space) */
  inputClassName?: string;
  /** Additional class for the list container (e.g., overlay positioning) */
  listClassName?: string;
}

export function SuggestionList<T>({
  query,
  onQueryChange,
  placeholder,
  items,
  keyExtractor,
  renderItem,
  onSelect,
  isDisabled,
  isLoading,
  loadingMessage,
  emptyMessage = "No results.",
  autoFocus,
  inputLoading,
  highlightedIndex = -1,
  onKeyDown,
  onFocus,
  inputRef: externalInputRef,
  listRef,
  inputClassName,
  listClassName,
}: SuggestionListProps<T>) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  useEffect(() => {
    if (autoFocus) {
      // Delay slightly for modal animation
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, inputRef]);

  return (
    <>
      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          placeholder={placeholder}
          className={clsx(INPUT_CLASSES, inputClassName)}
        />
        {inputLoading && (
          <div className="absolute inset-y-0 right-2 flex items-center">
            <Spinner className="size-4" />
          </div>
        )}
      </div>

      {/* List */}
      <div ref={listRef} className={listClassName}>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-5" />
            {loadingMessage && (
              <span className="ml-2 text-sm text-gray-500">
                {loadingMessage}
              </span>
            )}
          </div>
        ) : items.length === 0 ? (
          emptyMessage && (
            <p className="py-8 text-center text-sm text-gray-500">
              {emptyMessage}
            </p>
          )
        ) : (
          items.map((item, index) => {
            const disabled = isDisabled?.(item) ?? false;
            const highlighted = index === highlightedIndex;

            return (
              <button
                key={keyExtractor(item)}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onSelect(item)}
                className={clsx(
                  "flex w-full items-center gap-2 text-left text-sm transition-colors",
                  highlighted
                    ? "bg-mox-sapphire text-white"
                    : "text-gray-950 dark:text-white",
                  !disabled &&
                    !highlighted &&
                    "hover:bg-gray-950/5 dark:hover:bg-white/5",
                  disabled && "opacity-50",
                )}
              >
                {renderItem(item, highlighted)}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
