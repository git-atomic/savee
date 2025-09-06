"use client";

import React, { useEffect, useMemo, useState } from "react";

type Props = {
  rowData?: any;
};

export default function SaveeUserAvatarCell({ rowData }: Props) {
  const username: string | undefined = rowData?.username;

  const seededColor = useMemo(() => {
    if (!username) return "#9CA3AF"; // gray-400 fallback
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const sat = 72; // vivid
    const light = 52; // mid-light
    // Convert HSL to RGB hex for SVG compatibility in some clients
    const h = hue / 360;
    const s = sat / 100;
    const l = light / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }, [username]);

  const DEFAULT_AVATAR = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="60" fill="${seededColor}" />
    </svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }, [seededColor]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(() => {
    const r2 = rowData?.avatar_r2_key || rowData?.avatarR2Key;
    if (r2 && typeof r2 === "string") {
      // Use proxy to keep domain, mirror if missing
      return `/api/r2/presign?mode=proxy&key=${encodeURIComponent(r2)}`;
    }
    
    // Check if we have a profile_image_url with default avatar
    const profileUrl = rowData?.profile_image_url || rowData?.profileImageUrl;
    if (typeof profileUrl === "string" && /default-avatar-\d+\.jpg|st\.savee-cdn\.com\/img\//i.test(profileUrl)) {
      // Use the actual default avatar URL directly
      return profileUrl;
    }
    
    // Check for custom avatars
    if (typeof profileUrl === "string" && /dr\.savee-cdn\.com\/avatars\//i.test(profileUrl)) {
      return profileUrl;
    }
    
    // Only show colored circle if we have no avatar information at all
    return DEFAULT_AVATAR;
  });

  useEffect(() => {
    if (avatarUrl === DEFAULT_AVATAR && rowData?.id) {
      fetch(`/api/savee_users/${rowData.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((doc) => {
          if (!doc) return;
          
          // Priority 1: R2 key
          const r2 = doc.avatar_r2_key || doc.avatarR2Key;
          if (r2) {
            setAvatarUrl(
              `/api/r2/presign?mode=proxy&key=${encodeURIComponent(r2)}`
            );
            return;
          }
          
          // Priority 2: Direct Savee avatar URLs
          const profileUrl = doc.profile_image_url || doc.profileImageUrl;
          if (typeof profileUrl === "string") {
            if (/default-avatar-\d+\.jpg|st\.savee-cdn\.com\/img\//i.test(profileUrl)) {
              setAvatarUrl(profileUrl);
              return;
            }
            if (/dr\.savee-cdn\.com\/avatars\//i.test(profileUrl)) {
              setAvatarUrl(profileUrl);
              return;
            }
          }
          
          // Keep colored placeholder as final fallback
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
