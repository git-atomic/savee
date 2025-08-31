"use client";

import React, { useEffect, useMemo, useState } from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockOriginCell({ rowData }: Props) {
  // Blocks.list rows often contain relationship IDs, not populated docs
  const sourceField = rowData?.source ?? rowData?.source_id;
  const sourceId: string | number | undefined = useMemo(() => {
    if (!sourceField) return undefined;
    if (typeof sourceField === "object" && sourceField?.id)
      return sourceField.id;
    return sourceField as string | number;
  }, [sourceField]);

  const [text, setText] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!sourceId) {
          setText("");
          return;
        }
        const res = await fetch(`/api/sources/${sourceId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          setText("");
          return;
        }
        const data = await res.json();
        const srcType = data?.doc?.sourceType || data?.sourceType;
        const username = data?.doc?.username || data?.username;
        const value = srcType === "user" ? username || "user" : srcType || "";
        if (!cancelled) setText(value);
      } catch {
        if (!cancelled) setText("");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

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
    if (text === "home")
      return {
        ...base,
        backgroundColor: "#E0E7FF",
        color: "#3730A3",
        borderColor: "#C7D2FE",
      };
    if (text === "pop")
      return {
        ...base,
        backgroundColor: "#F5D0FE",
        color: "#86198F",
        borderColor: "#F0ABFC",
      };
    if (!text)
      return {
        ...base,
        backgroundColor: "#F3F4F6",
        color: "#4B5563",
        borderColor: "#E5E7EB",
      };
    return {
      ...base,
      backgroundColor: "#E9D5FF",
      color: "#6B21A8",
      borderColor: "#D8B4FE",
    };
  })();

  return (
    <span style={style} title={text}>
      {text || ""}
    </span>
  );
}
