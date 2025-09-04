"use client";

import React, { useEffect, useState } from "react";

type Props = {
  cellData?: any;
  rowData?: any;
};

export default function BlockPreviewCell({ rowData }: Props) {
  const r2Key: string | undefined =
    rowData?.r2_key || rowData?.r2Key || rowData?.r2 || undefined;

  // Debug logging
  console.log("BlockPreviewCell rowData:", {
    id: rowData?.id,
    r2_key: rowData?.r2_key,
    r2Key: rowData?.r2Key,
    r2: rowData?.r2,
    thumbnail_url: rowData?.thumbnail_url,
    image_url: rowData?.image_url,
    og_image_url: rowData?.og_image_url,
    title: rowData?.title
  });

  const [src, setSrc] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    
    async function loadImage() {
      if (cancelled) return;
      
      // PRIORITY 1: Try R2 first if we have a key
      if (r2Key && typeof r2Key === "string") {
        setDebugInfo(`Trying R2: ${r2Key}`);
        try {
          const cleanKey = r2Key.replace(/\/+/g, "/");
          const presignUrl = `/api/r2/presign?mode=json&key=${encodeURIComponent(cleanKey)}`;
          console.log("Fetching presign URL:", presignUrl);
          
          const res = await fetch(presignUrl, { 
            method: "GET",
            headers: { "Content-Type": "application/json" }
          });
          
          console.log("Presign response:", res.status, res.statusText);
          
          if (res.ok) {
            const data = await res.json();
            console.log("Presign data:", data);
            
            if (!cancelled && data?.success && data?.url) {
              setDebugInfo(`R2 success: ${data.url.substring(0, 50)}...`);
              setSrc(data.url);
              setLoading(false);
              return; // Success! Use R2 URL
            } else {
              setDebugInfo(`R2 failed: ${data?.error || 'no url'}`);
            }
          } else {
            setDebugInfo(`R2 HTTP error: ${res.status}`);
          }
        } catch (error) {
          console.warn("R2 presign failed:", error);
          setDebugInfo(`R2 exception: ${String(error)}`);
        }
      } else {
        setDebugInfo("No R2 key");
      }
      
      // FALLBACK: Use original Savee URLs only if R2 fails or doesn't exist
      if (!cancelled) {
        const fallbackUrl = 
          rowData?.thumbnail_url || 
          rowData?.image_url || 
          rowData?.og_image_url || 
          "";
        
        if (fallbackUrl) {
          setDebugInfo(`Fallback: ${fallbackUrl.substring(0, 50)}...`);
        } else {
          setDebugInfo("No fallback URLs");
        }
        
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
    <div className="w-16 h-16 rounded overflow-hidden border border-gray-200 bg-gray-50 flex flex-col items-center justify-center">
      {loading ? (
        <span className="text-[10px] text-gray-600">...</span>
      ) : isVideo ? (
        <span className="text-[10px] text-gray-600">video</span>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={rowData?.title || "preview"}
          className="object-cover w-full h-full"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            console.error("Image failed to load:", target.src);
            setDebugInfo(`IMG ERROR: ${target.src.substring(0, 30)}...`);
            
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
      ) : (
        <div className="text-center">
          <span className="text-[8px] text-gray-400 block">No preview</span>
          <span className="text-[6px] text-gray-500 block">{debugInfo}</span>
        </div>
      )}
    </div>
  );
}