"use client";

import React, { useEffect, useState } from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockPreviewCell({ rowData }: Props) {
  const r2Key: string | undefined =
    rowData?.r2_key || rowData?.r2Key || rowData?.r2 || undefined;

  const [src, setSrc] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    
    async function loadImage() {
      if (cancelled) return;
      
      // PRIORITY 1: Try R2 first if we have a key
      if (r2Key && typeof r2Key === "string") {
        try {
          const cleanKey = r2Key.replace(/\/+/g, "/");
          const res = await fetch(
            `/api/r2/presign?mode=json&key=${encodeURIComponent(cleanKey)}`,
            { 
              method: "GET",
              headers: { "Content-Type": "application/json" }
            }
          );
          
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && data?.success && data?.url) {
              setSrc(data.url);
              setLoading(false);
              return; // Success! Use R2 URL
            }
          }
        } catch (error) {
          console.warn("R2 presign failed:", error);
        }
      }
      
      // FALLBACK: Use original Savee URLs only if R2 fails or doesn't exist
      if (!cancelled) {
        const fallbackUrl = 
          rowData?.thumbnail_url || 
          rowData?.image_url || 
          rowData?.og_image_url || 
          "";
        
        setSrc(fallbackUrl);
        setLoading(false);
      }
    }

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [r2Key, rowData?.thumbnail_url, rowData?.image_url, rowData?.og_image_url]);

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
            // If current image fails, try falling back to original Savee URLs
            const fallback = 
              rowData?.thumbnail_url || 
              rowData?.image_url || 
              rowData?.og_image_url;
            if (fallback && target.src !== fallback && !target.src.includes('savee')) {
              console.warn("R2 image failed, falling back to Savee URL:", fallback);
              target.src = fallback;
            }
          }}
        />
      )}
    </div>
  );
}