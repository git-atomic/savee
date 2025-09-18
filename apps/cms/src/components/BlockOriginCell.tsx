"use client";

import React, { useEffect, useMemo, useState } from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockOriginCell({ rowData }: Props) {
  const blockId: number | undefined = rowData?.id || rowData?._id;
  const [prov, setProv] = useState<{
    home: boolean;
    pop: boolean;
    users: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!blockId) {
          setProv(null);
          return;
        }
        const res = await fetch(`/api/blocks/${blockId}/provenance`, {
          credentials: "include",
        });
        if (!res.ok) {
          setProv(null);
          return;
        }
        const data = await res.json();
        const om = data?.origin_map || {};
        const users: string[] = Array.isArray(om.users)
          ? om.users.filter(
              (u: any) => typeof u === "string" && u.trim().length > 0
            )
          : [];
        const home = Boolean(om.home);
        const pop = Boolean(om.pop);
        if (!cancelled) setProv({ home, pop, users });
      } catch {
        if (!cancelled) setProv(null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  const chip = (label: string, kind: "home" | "pop" | "user") => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 6px",
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 600,
      border: "1px solid",
      marginRight: 6,
    };
    if (kind === "home")
      return (
        <span
          key={`home-${label}`}
          style={{
            ...base,
            backgroundColor: "#E0E7FF",
            color: "#3730A3",
            borderColor: "#C7D2FE",
          }}
        >
          {label}
        </span>
      );
    if (kind === "pop")
      return (
        <span
          key={`pop-${label}`}
          style={{
            ...base,
            backgroundColor: "#F5D0FE",
            color: "#86198F",
            borderColor: "#F0ABFC",
          }}
        >
          {label}
        </span>
      );
    return (
      <span
        key={`user-${label}`}
        style={{
          ...base,
          backgroundColor: "#E9D5FF",
          color: "#6B21A8",
          borderColor: "#D8B4FE",
        }}
      >
        {label}
      </span>
    );
  };

  if (!prov) return <span className="text-xs text-gray-500">—</span>;

  const chips: JSX.Element[] = [];
  if (prov.home) chips.push(chip("home", "home"));
  if (prov.pop) chips.push(chip("pop", "pop"));
  for (const u of prov.users) chips.push(chip(u, "user"));

  if (!chips.length) return <span className="text-xs text-gray-500">—</span>;
  return <span>{chips}</span>;
}
