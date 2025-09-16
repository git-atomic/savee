import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, value, ...props }, ref) => {
    const isNumber = type === "number";

    const handleNumberChange = (delta: number) => {
      if (!isNumber || !onChange) return;

      const currentValue = Number(value) || 0;
      const newValue = Math.max(0, currentValue + delta);

      const event = {
        target: { value: newValue.toString() },
        currentTarget: { value: newValue.toString() },
      } as React.ChangeEvent<HTMLInputElement>;

      onChange(event);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isNumber) {
        // Only allow numbers
        const value = e.target.value.replace(/[^0-9]/g, "");
        e.target.value = value;
      }
      if (onChange) onChange(e);
    };

    return (
      <div className="group relative flex w-full overflow-hidden bg-card text-foreground shadow-sm transition duration-200 ease-out before:absolute before:inset-0 before:ring-1 before:ring-inset before:ring-border before:pointer-events-none before:rounded-[inherit] before:transition before:duration-200 before:ease-out hover:shadow-none has-[input:focus]:shadow-lg has-[input:focus]:before:ring-ring has-[input:disabled]:shadow-none has-[input:disabled]:before:ring-transparent rounded-[11px]">
        <label className="group/input-wrapper flex w-full cursor-text items-center bg-card transition duration-200 ease-out hover:[&:not(&:has(input:focus))]:bg-accent has-[input:disabled]:pointer-events-none has-[input:disabled]:bg-muted gap-2 px-3 h-10">
          <input
            type={type}
            className={cn(
              "w-full h-10 bg-transparent bg-none text-sm text-foreground outline-none transition duration-200 ease-out placeholder:select-none placeholder:text-muted-foreground placeholder:transition placeholder:duration-200 placeholder:ease-out group-hover/input-wrapper:placeholder:text-muted-foreground focus:outline-none disabled:text-muted-foreground disabled:placeholder:text-muted-foreground [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0",
              className
            )}
            ref={ref}
            value={value}
            onChange={handleInputChange}
            {...props}
          />
          {isNumber && (
            <div className="flex flex-col ml-auto">
              <button
                type="button"
                className="p-0.5 hover:bg-accent rounded-sm transition-colors"
                onClick={() => handleNumberChange(1)}
                tabIndex={-1}
              >
                <ChevronUp className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="p-0.5 hover:bg-accent rounded-sm transition-colors"
                onClick={() => handleNumberChange(-1)}
                tabIndex={-1}
              >
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}
        </label>
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
