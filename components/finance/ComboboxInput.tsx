"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface ComboboxInputProps {
  /** Current value */
  value: string;
  /** Called when value changes (selection or typed) */
  onChange: (value: string) => void;
  /** Available options to choose from */
  options: string[];
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Whether to allow custom typed values not in the list */
  allowCustom?: boolean;
  /** Label shown when typing a value not in the list */
  customLabel?: string;
  /** Input ID for accessibility */
  id?: string;
}

/**
 * Searchable combobox with custom value fallback.
 *
 * Behavior:
 * - Click or focus → opens filtered dropdown
 * - Type → filters options in real time
 * - Select from list → closes dropdown, sets value
 * - Type custom value → allowed if `allowCustom` is true (default)
 * - Keyboard: Arrow keys navigate, Enter selects, Escape closes
 * - Click outside → closes dropdown
 */
export function ComboboxInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  allowCustom = true,
  customLabel = "Use custom value",
  id,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter options based on query
  const filtered = query.trim()
    ? options.filter((opt) => opt.toLowerCase().includes(query.toLowerCase()))
    : options;

  const isCustom =
    allowCustom &&
    query.trim().length > 0 &&
    !options.some((opt) => opt.toLowerCase() === query.trim().toLowerCase());

  // Close on outside click — only listen when dropdown is open
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-combobox-option]");
      items[highlightIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  const select = useCallback(
    (val: string) => {
      onChange(val);
      setQuery("");
      setOpen(false);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setHighlightIndex(-1);
    if (!open) setOpen(true);
  };

  const onInputFocus = () => {
    setOpen(true);
    setQuery(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = filtered.length + (isCustom ? 1 : 0);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1) % Math.max(totalItems, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filtered.length) {
        select(filtered[highlightIndex]);
      } else if (isCustom && highlightIndex === filtered.length) {
        select(query.trim());
      } else if (query.trim()) {
        select(query.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const displayValue = open ? query : value;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={displayValue}
          onChange={onInputChange}
          onFocus={onInputFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={className ?? "aw-input h-10 w-full pr-8 text-sm"}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen(!open);
            if (!open) {
              setQuery(value);
              inputRef.current?.focus();
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--aw-text-muted)] transition-colors hover:text-[var(--aw-text)]"
          aria-label="Toggle options"
        >
          <ChevronDown
            size={14}
            className="transition-transform"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          />
        </button>
      </div>

      {open && (filtered.length > 0 || isCustom) && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-[var(--aw-border)] bg-white py-1 shadow-lg"
        >
          {filtered.map((option, idx) => (
            <li
              key={option}
              data-combobox-option
              role="option"
              aria-selected={highlightIndex === idx}
              onMouseEnter={() => setHighlightIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(option);
              }}
              className="cursor-pointer px-3 py-2 text-sm text-[var(--aw-text)] transition-colors"
              style={{
                background:
                  highlightIndex === idx
                    ? "var(--aw-primary-soft, rgba(253,186,116,0.12))"
                    : value === option
                      ? "var(--aw-surface-subtle, #FAFAF8)"
                      : undefined,
              }}
            >
              {option}
            </li>
          ))}
          {isCustom && (
            <li
              data-combobox-option
              role="option"
              aria-selected={highlightIndex === filtered.length}
              onMouseEnter={() => setHighlightIndex(filtered.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(query.trim());
              }}
              className="cursor-pointer border-t border-[var(--aw-border)] px-3 py-2 text-sm transition-colors"
              style={{
                color: "var(--aw-primary, #FDBA74)",
                background:
                  highlightIndex === filtered.length
                    ? "var(--aw-primary-soft, rgba(253,186,116,0.12))"
                    : undefined,
              }}
            >
              {customLabel}: &ldquo;{query.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
