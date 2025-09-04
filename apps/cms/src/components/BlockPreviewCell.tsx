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
  const [debugInfo, setDebugInfo] = useState<string>("");

  // Debug: Log the first few characters of each potential field
  const debugData = {
    id: rowData?.id,
    r2_key: r2Key ? `${r2Key.substring(0, 30)}...` : "null",
    thumb: rowData?.thumbnail_url ? `${rowData.thumbnail_url.substring(0, 30)}...` : "null",
    img: rowData?.image_url ? `${rowData.image_url.substring(0, 30)}...` : "null",
    og: rowData?.og_image_url ? `${rowData.og_image_url.substring(0, 30)}...` : "null",
  };

  // Helper: decide if this row is a video asset
  const isVideoAsset = (): boolean => {
    const mt = (rowData?.media_type || rowData?.mediaType || "").toString().toLowerCase();
    const byType = mt === "video";
    const byField = Boolean(rowData?.video_url || rowData?.videoUrl);
    const byKey = typeof r2Key === "string" && /(?:\/video_|\.mp4$|\.webm$)/i.test(r2Key);
    return Boolean(byType || byField || byKey);
  };

  // Helper: derive a smaller image variant for R2 originals
  const deriveImageVariantKey = (key: string): string => {
    try {
      // original_{hash}.ext  -> small_{hash}.jpg
      const match = key.match(/^(.*)\/original_([0-9a-f]{8,})\.[a-z0-9]+$/i);
      if (match) {
        const base = match[1];
        const hash = match[2];
        return `${base}/small_${hash}.jpg`;
      }
      return key;
    } catch {
      return key;
    }
  };

  useEffect(() => {
    let cancelled = false;
    
    async function loadImage() {
      if (cancelled) return;
      
      // If this is a video, do NOT try to display the R2 mp4 in an <img>.
      // Prefer Savee thumbnail/og/image instead, or show the 'video' label.
      if (isVideoAsset()) {
        const fallbackUrl =
          rowData?.thumbnail_url ||
          rowData?.og_image_url ||
          rowData?.image_url ||
          "";
        setDebugInfo(fallbackUrl ? "video: using fallback image" : "video: no fallback image available");
        setSrc(fallbackUrl);
        setLoading(false);
        return;
      }

      // PRIORITY 1: Try R2 first if we have a key and it's an image
      if (r2Key && typeof r2Key === "string") {
        setDebugInfo(`Trying R2: ${r2Key}`);
        try {
          const imgKey = deriveImageVariantKey(r2Key);
          const cleanKey = imgKey.replace(/\/+/g, "/");
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
        <div className="text-center p-1">
          <span className="text-[8px] text-gray-400 block">No preview</span>
          <span className="text-[6px] text-gray-500 block">{debugInfo}</span>
          <div className="text-[5px] text-gray-400 mt-1">
            <div>ID: {debugData.id}</div>
            <div>R2: {debugData.r2_key}</div>
            <div>T: {debugData.thumb}</div>
            <div>I: {debugData.img}</div>
            <div>O: {debugData.og}</div>
          </div>
        </div>
      )}
    </div>
  );
}