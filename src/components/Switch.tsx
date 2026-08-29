import React from 'react';

interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  size?: "sm" | "md" | "lg";
}

const Switch: React.FC<SwitchProps> = ({
  checked = false,
  onChange,
  disabled = false,
  id,
  name,
  size = "md",
}) => {
  const scaleClass =
    size === "sm"
      ? "text-[9px]"
      : size === "lg"
      ? "text-[14px]"
      : "text-[11px]";

  return (
    <label
      className={`cursor-pointer relative inline-block h-[3em] w-[6em] rounded-full bg-[hsl(0,0%,7%)] shadow-[0px_2px_4px_0px_rgb(18,18,18,0.25),0px_4px_8px_0px_rgb(18,18,18,0.35)] select-none transition-opacity ${scaleClass} ${
        disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
      }`}
    >
      <span className="absolute inset-[0.1em] rounded-full border-[1px] border-[hsl(0,0%,25%)]" />
      <div className="absolute left-[0.5em] top-1/2 flex h-[2em] w-[2em] -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[inset_0px_2px_2px_0px_hsl(0,0%,85%)]">
        <div className="h-[1.5em] w-[1.5em] rounded-full bg-[hsl(0,0%,7%)] shadow-[0px_2px_2px_0px_hsl(0,0%,85%)]" />
      </div>
      <div className="absolute right-[0.5em] top-1/2 h-[0.25em] w-[1.5em] -translate-y-1/2 rounded-full bg-[hsl(0,0%,50%)] shadow-[inset_0px_2px_1px_0px_hsl(0,0%,40%)]" />
      <input
        className="peer sr-only"
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="absolute left-[0.25em] top-1/2 flex h-[2.5em] w-[2.5em] -translate-y-1/2 items-center justify-center rounded-full bg-[rgb(26,26,26)] shadow-[inset_4px_4px_4px_0px_rgba(64,64,64,0.25),inset_-4px_-4px_4px_0px_rgba(16,16,16,0.5)] duration-300 peer-checked:left-[calc(100%-2.75em)] peer-checked:bg-[hsl(38,92%,50%)]">
        <span className="relative h-full w-full rounded-full">
          <span className="absolute inset-[0.1em] rounded-full border-[1px] border-[hsl(0,0%,50%)]" />
        </span>
      </span>
    </label>
  );
};

export default Switch;
