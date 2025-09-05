"use client";

import React, { useEffect, useState } from "react";

type Props = {
  rowData?: any;
};

export default function SaveeUserAvatarCell({ rowData }: Props) {
  const username: string | undefined = rowData?.username;
  // Inline neutral placeholder to avoid external defaults
  const DEFAULT_AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="8" r="4" fill="#E5E7EB"/>' +
        '<path d="M4 21c0-4.2 3.8-7 8-7s8 2.8 8 7" fill="#E5E7EB"/>' +
        "</svg>"
    );
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(() => {
    const r2 = rowData?.avatar_r2_key || rowData?.avatarR2Key;
    if (r2 && typeof r2 === "string") {
      // Use proxy to keep domain, mirror if missing
      return `/api/r2/presign?mode=proxy&key=${encodeURIComponent(r2)}`;
    }
    // Prefer dr.savee-cdn.com avatars if present (non-default)
    const dr = rowData?.profile_image_url || rowData?.profileImageUrl;
    const direct =
      typeof dr === "string" && /dr\.savee-cdn\.com\/avatars\//i.test(dr)
        ? dr
        : rowData?.profile_image_url || rowData?.profileImageUrl;
    if (typeof direct === "string" && /default-avatar/i.test(direct))
      return DEFAULT_AVATAR;
    return direct || DEFAULT_AVATAR;
  });

  useEffect(() => {
    if (!avatarUrl && rowData?.id) {
      fetch(`/api/savee_users/${rowData.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((doc) => {
          if (!doc) return;
          const r2 = doc.avatar_r2_key || doc.avatarR2Key;
          if (r2) {
            setAvatarUrl(
              `/api/r2/presign?mode=proxy&key=${encodeURIComponent(r2)}`
            );
            return;
          }
          if (doc.profile_image_url || doc.profileImageUrl) {
            const direct = doc.profile_image_url || doc.profileImageUrl;
            if (typeof direct === "string" && /default-avatar/i.test(direct)) {
              setAvatarUrl(DEFAULT_AVATAR);
            } else {
              setAvatarUrl(direct);
            }
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowData?.id]);

  // Always render an avatar (defaults to neutral placeholder)

  return (
    <div className="w-9 h-9 rounded-full overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl}
        alt={username || "avatar"}
        className="object-cover w-full h-full rounded-full"
        referrerPolicy="no-referrer"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.src = DEFAULT_AVATAR;
        }}
      />
    </div>
  );
}
