import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  showValue?: boolean;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onChange, label, showValue = true, min = 0, max = 100, step = 1, ...props }, ref) => (
    <div className={cn("space-y-1", className)}>
      {(label || showValue) && (
        <div className="flex justify-between items-center">
          {label && <span className="text-xs text-[var(--muted-fg)]">{label}</span>}
          {showValue && <span className="text-xs font-medium text-[var(--foreground)]">{value}</span>}
        </div>
      )}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--border)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--purple)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
        style={{
          background: `linear-gradient(to right, var(--purple) 0%, var(--purple) ${((value - Number(min)) / (Number(max) - Number(min))) * 100}%, var(--border) ${((value - Number(min)) / (Number(max) - Number(min))) * 100}%, var(--border) 100%)`,
        }}
        {...props}
      />
    </div>
  )
);
Slider.displayName = "Slider";
