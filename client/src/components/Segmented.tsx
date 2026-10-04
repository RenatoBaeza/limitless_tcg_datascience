import { useLayoutEffect, useRef, useState } from "react";

/**
 * A segmented control whose selection is one pill that slides between options
 * rather than a highlight that blinks from one to the next. The motion is what
 * tells the eye which way the choice moved.
 *
 * The buttons keep `aria-pressed`, so to assistive tech this is still the
 * plain group of toggle buttons it always was.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  label,
  size = "md",
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  labelledBy?: string;
  label?: string;
  size?: "md" | "sm";
}) {
  const group = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;

    const measure = () => {
      const active = element.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    // Web fonts land after first paint and change every button's width.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div
      ref={group}
      className={`segmented segmented-${size}`}
      role="group"
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {pill && (
        <span
          className="segmented-pill"
          aria-hidden="true"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
