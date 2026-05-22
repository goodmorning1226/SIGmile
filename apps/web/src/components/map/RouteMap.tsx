"use client";

import { useState } from "react";
import { Warehouse } from "lucide-react";
import type { RouteMapData } from "@/lib/services/route-map-service";
import { cn } from "@/lib/utils/cn";

/**
 * RouteMap — TomTom Static Map 底圖 + SVG overlay。
 *  - 底圖：<img src={staticMapUrl}> 由 server 預先組好 URL
 *  - overlay：用 Web Mercator 投影把 marker / polyline 轉成像素座標畫到 SVG 上
 *
 * 沒有 TOMTOM_API_KEY 時 staticMapUrl 為 null，會 fallback 顯示淺色網格背景，
 * 但 marker / polyline 仍然會以正確相對位置畫出來。
 */

interface Props {
  data: RouteMapData;
  className?: string;
}

/** 緯度 → Mercator y（unit-less），給對齊 TomTom Static Map 的 bbox 用 */
function mercatorY(lat: number) {
  // clamp 避免極區 NaN
  const r = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

function projector(bbox: RouteMapData["bbox"], w: number, h: number) {
  const yTop = mercatorY(bbox.maxLat);
  const yBottom = mercatorY(bbox.minLat);
  const ySpan = yTop - yBottom;
  const xSpan = bbox.maxLng - bbox.minLng;
  return (lat: number, lng: number) => {
    const x = ((lng - bbox.minLng) / xSpan) * w;
    const y = ((yTop - mercatorY(lat)) / ySpan) * h;
    return { x, y };
  };
}

export function RouteMap({ data, className }: Props) {
  const [imgError, setImgError] = useState(false);
  const { markers, polyline, bbox, staticMapUrl, mapWidth, mapHeight, isRealPolyline } = data;

  const proj = projector(bbox, mapWidth, mapHeight);
  const polylineD =
    polyline.length === 0
      ? ""
      : polyline
          .map((p, i) => {
            const { x, y } = proj(p.lat, p.lng);
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(" ");

  const showImage = staticMapUrl && !imgError;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100",
        className
      )}
      style={{ aspectRatio: `${mapWidth}/${mapHeight}` }}
    >
      {/* 底圖 */}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={staticMapUrl}
          alt="路線地圖"
          width={mapWidth}
          height={mapHeight}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className="absolute inset-0 bg-[linear-gradient(0deg,transparent_24%,rgba(0,0,0,0.04)_25%,rgba(0,0,0,0.04)_26%,transparent_27%),linear-gradient(90deg,transparent_24%,rgba(0,0,0,0.04)_25%,rgba(0,0,0,0.04)_26%,transparent_27%)] bg-[size:24px_24px]"
        />
      )}

      {/* SVG overlay — 用 viewBox 對齊圖片像素座標 */}
      <svg
        viewBox={`0 0 ${mapWidth} ${mapHeight}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {/* 行車路線：白邊 + 橘色主線 */}
        {polylineD && (
          <>
            <path
              d={polylineD}
              fill="none"
              stroke="#ffffff"
              strokeWidth={7}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
            <path
              d={polylineD}
              fill="none"
              stroke="#ea580c"
              strokeWidth={4}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={isRealPolyline ? undefined : "8 6"}
            />
          </>
        )}

        {/* Markers — 直接畫成 SVG，hover 時換色 */}
        {markers.map((m, i) => {
          const { x, y } = proj(m.lat, m.lng);
          if (m.kind === "depot") {
            return (
              <g key={`m-${i}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
                <rect
                  x={-14} y={-14} width={28} height={28}
                  rx={6}
                  fill="#0f172a"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <text
                  x={0} y={5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill="#ffffff"
                >DC</text>
              </g>
            );
          }
          const color =
            m.status === "completed" ? "#059669"
            : m.status === "failed"   ? "#ef4444"
            : m.status === "skipped"  ? "#a78bfa"
            : "#ea580c";
          return (
            <g key={`m-${i}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
              <circle r={13} fill={color} stroke="#ffffff" strokeWidth={2.5} />
              <text
                x={0} y={4.5}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#ffffff"
              >
                {m.index ?? ""}
              </text>
              <title>{`${m.index ? `${m.index}. ` : ""}${m.label}`}</title>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute top-2 left-2 flex flex-wrap items-center gap-3 rounded-md bg-white/90 backdrop-blur px-2.5 py-1.5 text-[11px] text-slate-700 shadow-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-4 place-items-center rounded bg-slate-900">
            <Warehouse className="size-2.5 text-white" />
          </span>
          物流中心
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-orange-600 ring-1 ring-white" />
          停靠點
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-emerald-600 ring-1 ring-white" />
          已完成
        </span>
        {!isRealPolyline && (
          <span className="text-amber-700">（路線為直線估算，未套到道路）</span>
        )}
      </div>
    </div>
  );
}
