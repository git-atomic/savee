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
    // Start with non-R2 URLs immediately for faster rendering
    return (
      rowData?.thumbnail_url || rowData?.image_url || rowData?.og_image_url || ""
    );
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    
    async function presign() {
      if (!r2Key || typeof r2Key !== "string") return;
      
      setLoading(true);
      try {
        const cleanKey = r2Key.replace(/\/+/g, "/");
        const res = await fetch(
          `/api/r2/presign?mode=json&key=${encodeURIComponent(cleanKey)}`,
          { 
            method: "GET",
            headers: { "Content-Type": "application/json" }
          }
        );
        
        if (!res.ok) {
          console.warn(`Presign failed: ${res.status} ${res.statusText}`);
          return;
        }
        
        const data = await res.json();
        if (!cancelled && data?.success && data?.url) {
          setSrc(data.url);
        } else if (!cancelled && data?.error) {
          console.warn("Presign error:", data.error);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Presign fetch error:", error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Only try presign if we have an R2 key
    if (r2Key) {
      presign();
    }

    return () => {
      cancelled = true;
    };
  }, [r2Key]);

  const isVideo = Boolean(rowData?.video_url) && !rowData?.thumbnail_url;

  if (!src && !isVideo && !loading) {
    return <span className="text-xs text-gray-400">No preview</span>;
  }

  return (
    <div className="w-16 h-16 rounded overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
      {loading ? (
        <span className="text-[10px] text-gray-600">...</span>
      ) : isVideo ? (
        <span className="text-[10px] text-gray-600">video</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={rowData?.title || "preview"}
          className="object-cover w-full h-full"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            // If R2 image fails, try falling back to original URLs
            const fallback = 
              rowData?.thumbnail_url || 
              rowData?.image_url || 
              rowData?.og_image_url;
            if (fallback && target.src !== fallback) {
              target.src = fallback;
            }
          }}
        />
      )}
    </div>
  );
}