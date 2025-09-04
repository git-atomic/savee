"use client";

import React, { useEffect, useState } from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockPreviewCell({ rowData }: Props) {
  const r2Key: string | undefined =
    rowData?.r2_key || rowData?.r2Key || rowData?.r2 || undefined;

  const [src, setSrc] = useState<string | undefined>(() => {
    if (r2Key && typeof r2Key === "string") return undefined; // we'll presign below
    return (
      rowData?.thumbnail_url || rowData?.image_url || rowData?.og_image_url || ""
    );
  });

  useEffect(() => {
    let cancelled = false;
    async function presign() {
      if (!r2Key) return;
      try {
        const res = await fetch(
          `/api/r2/presign?mode=json&key=${encodeURIComponent(
            r2Key.replace(/\\/+/g, "/")
          )}`
        );
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.success && data?.url) setSrc(data.url);
      } catch (_) {
        // fall back to non-R2 URLs if present
        if (!cancelled)
          setSrc(
            rowData?.thumbnail_url ||
              rowData?.image_url ||
              rowData?.og_image_url ||
              ""
          );
      }
    }
    presign();
    return () => {
      cancelled = true;
    };
  }, [r2Key, rowData?.thumbnail_url, rowData?.image_url, rowData?.og_image_url]);

  const isVideo = Boolean(rowData?.video_url) && !rowData?.thumbnail_url;

  if (!src && !isVideo)
    return <span className="text-xs text-gray-400">No preview</span>;

  return (
    <div className="w-16 h-16 rounded overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
      {isVideo ? (
        <span className="text-[10px] text-gray-600">video</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={rowData?.title || "preview"}
          className="object-cover w-full h-full"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
