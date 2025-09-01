"use client";

import React, { useEffect, useState } from "react";

type Props = {
  rowData?: any;
};

export default function BlockUsersCell({ rowData }: Props) {
  const blockId = rowData?.id || rowData?._id;
  const [users, setUsers] = useState<Array<{ id: number; username: string }>>(
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function run() {
      try {
        if (!blockId) return;
        const res = await fetch(`/api/blocks/${blockId}/users`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUsers(Array.isArray(data?.users) ? data.users : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }
    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [blockId]);

  if (!users.length) return <span className="text-xs text-gray-500">—</span>;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {users.map((u) => (
        <span
          key={u.id}
          title={u.username}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 6px",
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid #E5E7EB",
            background: "#F3F4F6",
            color: "#374151",
          }}
        >
          {u.username}
        </span>
      ))}
    </div>
  );
}
