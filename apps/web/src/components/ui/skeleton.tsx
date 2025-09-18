import * as React from "react";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-[11px] bg-neutral-200 dark:bg-neutral-800 ${className}`}
      {...props}
    />
  );
}


