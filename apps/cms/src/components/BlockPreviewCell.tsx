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
      
      // If this is a video, try R2 poster first, then Savee fallback.
      if (isVideoAsset()) {
        // If R2 key exists, try to use poster_<hash>.jpg that matches video_<hash>.*
        if (r2Key && typeof r2Key === 'string') {
          const m = r2Key.match(/^(.*)\/video_([0-9a-f]{8,})\.[a-z0-9]+$/i);
          if (m) {
            const posterKey = `${m[1]}/poster_${m[2]}.jpg`;
            try {
              // Prefer proxy mode to keep visualcms.vercel.app origin
              const fallback = rowData?.thumbnail_url || rowData?.og_image_url || rowData?.image_url || "";
              const proxied = `/api/r2/presign?mode=proxy&key=${encodeURIComponent(posterKey)}${fallback ? `&fallback=${encodeURIComponent(fallback)}` : ''}`;
              const res = await fetch(proxied, { method: 'GET' });
              if (res.ok) {
                setSrc(proxied);
                setLoading(false);
                setDebugInfo('video: R2 poster (proxy)');
                return;
              }
              // Fallback to JSON presign
              const resJson = await fetch(`/api/r2/presign?mode=json&key=${encodeURIComponent(posterKey)}`);
              const data = await resJson.json().catch(() => null);
              if (data?.success && data?.url) {
                setSrc(data.url);
                setLoading(false);
                setDebugInfo('video: R2 poster');
                return;
              }
            } catch (_) {
              // ignore and fall back
            }
          }
        }
        const fallbackUrl = rowData?.thumbnail_url || rowData?.og_image_url || rowData?.image_url || "";
        setDebugInfo(fallbackUrl ? 'video: fallback image' : 'video: no poster');
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
          const fallbackImg = rowData?.thumbnail_url || rowData?.image_url || rowData?.og_image_url || "";
          const proxied = `/api/r2/presign?mode=proxy&key=${encodeURIComponent(cleanKey)}${fallbackImg ? `&fallback=${encodeURIComponent(fallbackImg)}` : ''}`;
          // Try proxy first (keeps our domain)
          const resProxy = await fetch(proxied, { method: 'GET' });
          if (resProxy.ok) {
            setDebugInfo('image: R2 proxy');
            setSrc(proxied);
            setLoading(false);
            return;
          }
          // Fallback to JSON presign
          const presignUrl = `/api/r2/presign?mode=json&key=${encodeURIComponent(cleanKey)}`;
          const res = await fetch(presignUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled && data?.success && data?.url) {
              setDebugInfo('image: R2 json');
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
    <div className="flex items-center justify-center max-w-[300px] max-h-[300px] overflow-hidden rounded border border-gray-200 bg-gray-50 p-1">
      {loading ? (
        <span className="text-[10px] text-gray-600">...</span>
      ) : isVideo ? (
        <span className="text-[10px] text-gray-600">video</span>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={rowData?.title || "preview"}
          className="w-auto h-auto max-w-[250px] max-h-[250px] object-contain"
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