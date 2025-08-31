"use client";

import React from "react";

type Row = {
  profile_image_r2_key?: string;
  profile_image_url?: string;
};

export default function SaveeUserAvatarCell({ data }: { data?: Row }) {
  const r2 = data?.profile_image_r2_key;
  const url = data?.profile_image_url;
  const src = r2 ? `/api/r2/presign?key=${encodeURIComponent(r2)}` : url;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {src ? (
        <img
          src={src}
          alt="avatar"
          style={{
            width: 32,
            height: 32,
            borderRadius: "9999px",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "9999px",
            background: "#ddd",
          }}
        />
      )}
    </div>
  );
}
