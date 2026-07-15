import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "navy";
type Size = "sm" | "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary: "brand-button-accent border-transparent text-white",
  secondary: "border-[#dfe4e8] bg-white text-[#243444] hover:bg-[#f4f6f7]",
  ghost: "border-transparent bg-transparent text-[#52606d] hover:bg-[#edf1f3] hover:text-[var(--brand-primary)]",
  danger: "border-transparent bg-[#a94339] text-white hover:bg-[#913c33]",
  navy: "brand-button-primary border-transparent text-white",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
  icon: "size-10 p-0",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "brand-radius focus-ring inline-flex shrink-0 items-center justify-center gap-2 border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});

export function buttonClassName({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "brand-radius focus-ring inline-flex shrink-0 items-center justify-center gap-2 border font-semibold transition-colors",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}
