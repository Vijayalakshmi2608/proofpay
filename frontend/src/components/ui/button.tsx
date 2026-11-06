import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00EC42]/70 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-[#00EC42]/35 bg-[#00EC42] text-[#071009] shadow-[0_0_22px_rgba(0,236,66,.11)] hover:border-[#39ff6c] hover:bg-[#25f557] hover:shadow-[0_0_28px_rgba(0,236,66,.23)]",
        secondary: "border border-white/[0.09] bg-white/[0.035] text-slate-300 hover:border-white/[0.15] hover:bg-white/[0.07] hover:text-white",
        ghost: "text-slate-400 hover:bg-white/[0.05] hover:text-white",
        outline: "border border-proof/25 bg-proof/[0.04] text-proof hover:bg-proof/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        lg: "h-11 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
