"use client";

import React, { useState, useEffect } from "react";

type OriginMap = {
  home: boolean;
  pop: boolean;
  users: string[];
  tags: string[];
};

type Props = {
  rowData?: any;
};

export default function OriginPillsCell({ rowData }: Props) {
  const [originData, setOriginData] = useState<OriginMap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOriginData = async () => {
      if (!rowData?.id) {
        // Even without ID, try to extract from row data
        setOriginData(extractOriginFromRowData(rowData));
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/blocks/${rowData.id}/provenance`);
        if (response.ok) {
          const data = await response.json();
          setOriginData(data.origin_map);
        } else {
          // Fallback to row data if API fails
          setOriginData(extractOriginFromRowData(rowData));
        }
      } catch (error) {
        console.warn("Failed to fetch origin data:", error);
        // Always fallback to extracting from row data
        setOriginData(extractOriginFromRowData(rowData));
      } finally {
        setLoading(false);
      }
    };

    fetchOriginData();
  }, [rowData?.id]);

  // Extract origin info from existing row data as fallback
  const extractOriginFromRowData = (data: any): OriginMap => {
    const sourceType = data?.source?.source_type;
    const username = data?.source?.username;
    const originText = data?.origin_text;
    const savedByUsernames = data?.saved_by_usernames;

    // Parse saved_by_usernames if it's a string
    let usersList: string[] = [];
    if (savedByUsernames) {
      if (typeof savedByUsernames === "string") {
        usersList = savedByUsernames
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
      } else if (Array.isArray(savedByUsernames)) {
        usersList = savedByUsernames;
      }
    }

    // If we have a username from source, add it
    if (sourceType === "user" && username) {
      usersList.push(username);
    }

    // Deduplicate users
    usersList = [...new Set(usersList)];

    return {
      home: sourceType === "home" || originText === "home",
      pop: sourceType === "pop" || originText === "pop",
      users: usersList,
      tags: [],
    };
  };

  const getBadgeStyle = (
    type: "home" | "pop" | "user"
  ): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 6,
      fontSize: 11,
      lineHeight: "16px",
      fontWeight: 600,
      marginRight: 4,
      marginBottom: 4,
      borderWidth: 1,
      borderStyle: "solid",
    };

    if (type === "home") {
      return {
        ...base,
        backgroundColor: "#EEF2FF", // blue-100
        color: "#1E3A8A", // blue-800
        borderColor: "#BFDBFE", // blue-200
      };
    }
    if (type === "pop") {
      return {
        ...base,
        backgroundColor: "#FFF7ED", // amber-100
        color: "#92400E", // amber-800
        borderColor: "#FDE68A", // amber-300
      };
    }
    // user
    return {
      ...base,
      backgroundColor: "#F8FAFC", // slate-50
      color: "#334155", // slate-700
      borderColor: "#CBD5E1", // slate-300
    };
  };

  if (loading) {
    return (
      <div className="flex space-x-1">
        <div className="animate-pulse bg-gray-200 rounded-md h-5 w-12"></div>
        <div className="animate-pulse bg-gray-200 rounded-md h-5 w-16"></div>
      </div>
    );
  }

  if (!originData) {
    // Ultimate fallback - show basic origin
    const fallback = rowData?.origin_text || rowData?.origin || "UNKNOWN";
    return (
      <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md bg-gray-50 text-gray-700 border border-gray-200">
        {fallback.toUpperCase()}
      </span>
    );
  }

  const badges: JSX.Element[] = [];

  // Add home badge
  if (originData.home) {
    badges.push(
      <span key="home" style={getBadgeStyle("home")}>
        HOME
      </span>
    );
  }

  // Add popular badge
  if (originData.pop) {
    badges.push(
      <span key="pop" style={getBadgeStyle("pop")}>
        POPULAR
      </span>
    );
  }

  // Add user badges (limit to 3 for space efficiency)
  const displayUsers = originData.users
    .slice()
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b))
    .slice(0, 3);
  displayUsers.forEach((username, idx) => {
    badges.push(
      <span key={`user-${username}-${idx}`} style={getBadgeStyle("user")}>
        {username.toUpperCase()}
      </span>
    );
  });

  // Show additional users count if there are more
  if (originData.users.length > 3) {
    badges.push(
      <span key="additional" style={getBadgeStyle("user")}>
        +{originData.users.length - 3} MORE
      </span>
    );
  }

  if (badges.length === 0) {
    // As an alternative plain, enterprise-safe rendering, show comma-separated
    const plain = [
      originData.home ? "HOME" : null,
      originData.pop ? "POPULAR" : null,
      ...originData.users.slice(0, 3).map((u) => u.toUpperCase()),
    ].filter(Boolean) as string[];

    return (
      <span style={{ fontSize: 12, color: "#64748B" }}>
        {plain.length > 0 ? plain.join(", ") : "NO SOURCE"}
      </span>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        maxWidth: 320,
      }}
    >
      {badges}
    </div>
  );
}
