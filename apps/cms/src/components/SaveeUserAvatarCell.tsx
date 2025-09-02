"use client";

import React, { useEffect, useState } from "react";

type Props = {
  rowData?: any;
};

export default function SaveeUserAvatarCell({ rowData }: Props) {
  const username: string | undefined = rowData?.username;
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(
    rowData?.profile_image_url || rowData?.profileImageUrl
  );

  useEffect(() => {
    if (!avatarUrl && rowData?.id) {
      fetch(`/api/savee_users/${rowData.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((doc) => {
          if (doc && (doc.profile_image_url || doc.profileImageUrl)) {
            setAvatarUrl(doc.profile_image_url || doc.profileImageUrl);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowData?.id]);

  if (!avatarUrl) {
    return <span className="text-xs text-gray-400">—</span>;
  }

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
          target.src = "https://st.savee-cdn.com/img/default-avatar-1.jpg";
        }}
      />
    </div>
  );
}
