import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group relative inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium outline-none transition duration-200 ease-out focus:outline-none disabled:pointer-events-none disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground shadow-sm",
          "before:pointer-events-none before:absolute before:inset-0 before:z-10 before:rounded-[inherit]",
          "before:bg-gradient-to-b before:p-px before:from-white/10 before:to-transparent",
          "after:absolute after:inset-0 after:rounded-[inherit] after:bg-gradient-to-b after:from-white after:to-transparent",
          "after:pointer-events-none after:opacity-[0.16] after:transition after:duration-200 after:ease-out",
          "hover:after:opacity-[0.24]",
        ],
        destructive: [
          "bg-destructive text-destructive-foreground shadow-sm",
          "before:pointer-events-none before:absolute before:inset-0 before:z-10 before:rounded-[inherit]",
          "before:bg-gradient-to-b before:p-px before:from-white/10 before:to-transparent",
          "after:absolute after:inset-0 after:rounded-[inherit] after:bg-gradient-to-b after:from-white after:to-transparent",
          "after:pointer-events-none after:opacity-[0.16] after:transition after:duration-200 after:ease-out",
          "hover:after:opacity-[0.24]",
        ],
        outline: [
          "border border-input bg-card text-secondary-foreground shadow-sm",
          "hover:bg-accent hover:text-accent-foreground",
        ],
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 rounded-[11px] px-3",
        sm: "h-9 gap-3 rounded-lg px-3",
        lg: "h-11 gap-3 rounded-[12px] px-4",
        icon: "h-10 w-10 rounded-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
