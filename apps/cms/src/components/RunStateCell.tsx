"use client";

import React, { useEffect, useMemo, useState } from "react";

type Props = {
  rowData?: any;
};

export default function RunStateCell({ rowData }: Props) {
  const sourceField = rowData?.source ?? rowData?.source_id;
  const sourceId: string | number | undefined = useMemo(() => {
    if (!sourceField) return undefined;
    if (typeof sourceField === "object" && sourceField?.id)
      return sourceField.id;
    return sourceField as string | number;
  }, [sourceField]);

  const [state, setState] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!sourceId) return setState("");
        const res = await fetch(`/api/sources/${sourceId}`, {
          credentials: "include",
        });
        if (!res.ok) return setState("");
        const data = await res.json();
        const s = (data?.doc?.status || data?.status || "").toString();
        if (!cancelled) setState(s);
      } catch {
        if (!cancelled) setState("");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  // Prefer run row's status when it is explicit (running/paused/error)
  const runStatus = (rowData?.status || "").toString().toLowerCase();
  const effective =
    (["running", "paused", "error"].includes(runStatus) ? runStatus : state) ||
    "";

  const style: React.CSSProperties = (() => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 6px",
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 600,
      border: "1px solid",
    };
    switch (effective) {
      case "running":
        return {
          ...base,
          backgroundColor: "#DBEAFE",
          color: "#1E40AF",
          borderColor: "#BFDBFE",
        };
      case "active":
        return {
          ...base,
          backgroundColor: "#D1FAE5",
          color: "#065F46",
          borderColor: "#A7F3D0",
        };
      case "paused":
        return {
          ...base,
          backgroundColor: "#FEF3C7",
          color: "#92400E",
          borderColor: "#FDE68A",
        };
      case "error":
        return {
          ...base,
          backgroundColor: "#FEE2E2",
          color: "#991B1B",
          borderColor: "#FCA5A5",
        };
      default:
        return {
          ...base,
          backgroundColor: "#F3F4F6",
          color: "#374151",
          borderColor: "#E5E7EB",
        };
    }
  })();

  return <span style={style}>{effective || ""}</span>;
}
