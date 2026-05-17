import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface MapPin { lat: number | null; lng: number | null; label?: string; }

export interface MapPlaceholderProps {
  pins?: MapPin[];
  className?: string;
  /** 之後可改為動態，目前固定中心點為雙北。 */
  height?: number;
}

/**
 * 地圖佔位元件。未來改成 google maps / mapbox 時，把整個元件替換即可。
 */
export function MapPlaceholder({ pins = [], className, height = 280 }: MapPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative rounded-md border border-dashed border-slate-300 bg-slate-50 overflow-hidden",
        className
      )}
      style={{ height }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(0deg,transparent_24%,rgba(0,0,0,0.04)_25%,rgba(0,0,0,0.04)_26%,transparent_27%),linear-gradient(90deg,transparent_24%,rgba(0,0,0,0.04)_25%,rgba(0,0,0,0.04)_26%,transparent_27%)] bg-[size:24px_24px]" />
      <div className="absolute top-2 left-3 text-xs text-slate-500">
        Map placeholder · 未串接 Google Maps
      </div>
      <ul className="absolute inset-0 p-3 flex flex-wrap content-start gap-2 pt-8">
        {pins.length === 0 && (
          <li className="text-xs text-slate-400">尚無位置資料</li>
        )}
        {pins.map((p, i) => (
          <li
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-2 py-1 text-xs shadow border border-slate-200"
            title={p.lat && p.lng ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : "no coord"}
          >
            <MapPin className="h-3.5 w-3.5 text-brand-600" />
            <span>{p.label ?? `Pin #${i + 1}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
