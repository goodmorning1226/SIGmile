"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteMapData } from "@/lib/services/route-map-service";

/**
 * InteractiveRouteMap — 可拖曳 / 縮放的 TomTom Web SDK 地圖
 *  - SDK 用 CDN <script> 動態載入（避免額外 npm 依賴）
 *  - 在地圖上加 markers (DC + 編號 stops) + polyline（沿路真實路線）
 *  - SDK 載入失敗時不渲染（外層會 fallback 顯示靜態 RouteMap）
 *
 * 需要 apiKey（由 server-side 把 TOMTOM_API_KEY 透過 prop 傳入）。
 * Key 會出現在瀏覽器 HTML，請在 TomTom Dashboard 把它限制到正式網域。
 */

interface Props {
  data: RouteMapData;
  apiKey: string;
  className?: string;
  height?: number;
}

declare global {
  interface Window {
    tt?: TomTomNS;
  }
}

type TomTomNS = {
  map: (opts: TomTomMapOptions) => TomTomMap;
  Marker: new (opts?: { element?: HTMLElement; anchor?: string }) => TomTomMarker;
  Popup: new (opts?: { offset?: number; closeButton?: boolean }) => TomTomPopup;
  LngLatBounds: new () => TomTomBounds;
};

interface TomTomMapOptions {
  key: string;
  container: HTMLElement;
  center?: [number, number];
  zoom?: number;
  style?: string;
}

interface TomTomMap {
  on: (evt: string, cb: () => void) => void;
  addSource: (id: string, src: object) => void;
  addLayer: (layer: object) => void;
  fitBounds: (b: TomTomBounds | [[number, number], [number, number]], opts?: { padding?: number; maxZoom?: number; duration?: number }) => void;
  remove: () => void;
  resize: () => void;
}

interface TomTomMarker {
  setLngLat: (c: [number, number]) => TomTomMarker;
  setPopup: (p: TomTomPopup) => TomTomMarker;
  addTo: (map: TomTomMap) => TomTomMarker;
  remove: () => void;
}

interface TomTomPopup {
  setHTML: (h: string) => TomTomPopup;
}

interface TomTomBounds {
  extend: (c: [number, number]) => TomTomBounds;
}

let sdkLoadingPromise: Promise<TomTomNS | null> | null = null;

function loadTomTomSdk(): Promise<TomTomNS | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.tt) return Promise.resolve(window.tt);
  if (sdkLoadingPromise) return sdkLoadingPromise;

  sdkLoadingPromise = new Promise((resolve) => {
    // CSS
    if (!document.querySelector('link[data-tomtom-sdk]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css";
      link.setAttribute("data-tomtom-sdk", "1");
      document.head.appendChild(link);
    }
    // JS
    const existing = document.querySelector('script[data-tomtom-sdk]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(window.tt ?? null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js";
    script.async = true;
    script.setAttribute("data-tomtom-sdk", "1");
    script.onload = () => resolve(window.tt ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return sdkLoadingPromise;
}

export function InteractiveRouteMap({ data, apiKey, className, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMap | null>(null);
  const markersRef = useRef<TomTomMarker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadTomTomSdk().then((tt) => {
      if (cancelled) return;
      if (!tt || !containerRef.current) {
        setError("無法載入 TomTom 地圖 SDK");
        return;
      }
      try {
        // 初始中心：bbox 中點
        const centerLng = (data.bbox.minLng + data.bbox.maxLng) / 2;
        const centerLat = (data.bbox.minLat + data.bbox.maxLat) / 2;
        const map = tt.map({
          key: apiKey,
          container: containerRef.current,
          center: [centerLng, centerLat],
          zoom: 11
        });
        mapRef.current = map;

        map.on("load", () => {
          if (cancelled) return;

          // Polyline source + layer
          if (data.polyline.length >= 2) {
            map.addSource("route", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: data.polyline.map((p) => [p.lng, p.lat])
                }
              }
            });
            map.addLayer({
              id: "route-bg",
              type: "line",
              source: "route",
              paint: {
                "line-color": "#ffffff",
                "line-width": 7,
                "line-opacity": 0.9
              }
            });
            map.addLayer({
              id: "route-fg",
              type: "line",
              source: "route",
              paint: {
                "line-color": "#ea580c",
                "line-width": 4
              }
            });
          }

          // Markers
          for (const m of data.markers) {
            const el = document.createElement("div");
            if (m.kind === "depot") {
              el.innerHTML = `
                <div style="background:#0f172a;color:#fff;width:32px;height:32px;border-radius:8px;
                  display:grid;place-items:center;font-weight:700;font-size:12px;
                  border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25)">DC</div>
              `;
            } else {
              const color =
                m.status === "completed" ? "#059669"
                : m.status === "failed"   ? "#ef4444"
                : m.status === "skipped"  ? "#a78bfa"
                : "#ea580c";
              el.innerHTML = `
                <div style="background:${color};color:#fff;width:30px;height:30px;border-radius:50%;
                  display:grid;place-items:center;font-weight:700;font-size:12px;
                  border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${m.index ?? ""}</div>
              `;
            }
            const popupHtml = `
              <div style="font-size:12px;line-height:1.4">
                <div style="font-weight:600;color:#0f172a">${
                  m.index ? `${m.index}. ` : ""
                }${escapeHtml(m.label)}</div>
                ${m.status ? `<div style="color:#64748b;margin-top:2px">狀態：${escapeHtml(m.status)}</div>` : ""}
              </div>
            `;
            const popup = new tt.Popup({ offset: 18, closeButton: true }).setHTML(popupHtml);
            const marker = new tt.Marker({ element: el, anchor: "center" })
              .setLngLat([m.lng, m.lat])
              .setPopup(popup)
              .addTo(map);
            markersRef.current.push(marker);
          }

          // Fit bounds 包到所有 markers
          if (data.markers.length > 0) {
            const bounds = new tt.LngLatBounds();
            for (const m of data.markers) bounds.extend([m.lng, m.lat]);
            map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
          }

          setReady(true);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "地圖初始化失敗");
      }
    });

    return () => {
      cancelled = true;
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        style={{ height }}
      />
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-500">
          地圖載入中…
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-red-700">
          {error}
        </div>
      )}
      {/* 圖例 */}
      <div className="absolute top-2 left-2 flex flex-wrap items-center gap-3 rounded-md bg-white/90 backdrop-blur px-2.5 py-1.5 text-[11px] text-slate-700 shadow-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="grid size-4 place-items-center rounded bg-slate-900 text-white text-[8px] font-bold">DC</span>
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
        {!data.isRealPolyline && (
          <span className="text-amber-700">（直線估算）</span>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
