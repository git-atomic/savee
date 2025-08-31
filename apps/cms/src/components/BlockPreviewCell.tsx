"use client";

import React from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockPreviewCell({ rowData }: Props) {
  const url: string =
    rowData?.thumbnail_url || rowData?.image_url || rowData?.og_image_url || "";

  if (!url) return <span className="text-xs text-gray-400">No preview</span>;

  const isVideo = Boolean(rowData?.video_url) && !rowData?.thumbnail_url;

  return (
    <div className="w-16 h-16 rounded overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
      {isVideo ? (
        <span className="text-[10px] text-gray-600">video</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={rowData?.title || "preview"}
          className="object-cover w-full h-full"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
