/** Small shared UI primitives. */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-sans text-base font-semibold tracking-wide text-white">
      <span className="h-4 w-1.5 rounded-sm bg-tactical shadow-[0_0_8px_#00ff88]" />
      {children}
    </h2>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  variant?: "solid" | "outline";
  ariaLabel: string;
}

/** Button group (timeframe / scope / log controls). */
export function Segmented<T extends string>({ options, value, onChange, variant = "solid", ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-lg border border-obsidian-700 bg-obsidian-950 p-0.5 text-xs">
      {options.map((o) => {
        const active = o.value === value;
        const activeCls =
          variant === "solid"
            ? "bg-tactical font-bold text-obsidian-950 shadow-[0_0_8px_rgba(0,255,136,0.3)]"
            : "border border-tactical/30 bg-obsidian-800 font-semibold text-tactical";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap rounded px-2.5 py-1 transition-all ${active ? activeCls : "border border-transparent text-gray-400 hover:text-white"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
