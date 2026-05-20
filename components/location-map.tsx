"use client";

import { useEffect, useRef } from "react";

type LatLng = {
  lat: number;
  lng: number;
};

type MapViewerEntry = {
  id: string;
  dateLabel: string;
  count: number;
  speciesName: string;
};

export type MapViewerPoint = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  imageSrc: string;
  selected?: boolean;
  entries: MapViewerEntry[];
};

type LocationMapProps = {
  center: LatLng;
  zoom?: number;
  mode: "picker" | "viewer";
  theme?: "default" | "warm";
  /** viewer: 지도 중심을 props 변경에 따라 강제 이동하지 않음 */
  lockView?: boolean;
  selectedPoint?: LatLng | null;
  points?: MapViewerPoint[];
  fitToPoints?: boolean;
  onPick?: (point: LatLng) => void;
  onSelectPoint?: (id: string) => void;
  onSelectEntry?: (pointId: string, entryId: string) => void;
};

const PICKER_PIN_HTML = `<span class="bird-map-picker-pin" aria-hidden="true"></span>`;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildSightPinHtml = (imageSrc: string, count: number, selected: boolean) => {
  const safeSrc = escapeHtml(imageSrc);
  const selectedClass = selected ? " bird-map-sight-pin--selected" : "";
  return `<div class="bird-map-sight-pin${selectedClass}" aria-hidden="true">
    <div class="bird-map-sight-pin-badge">
      <span class="bird-map-sight-pin-photo">
        <img src="${safeSrc}" alt="" class="bird-map-sight-pin-img" />
      </span>
      <span class="bird-map-sight-pin-count">${count}</span>
    </div>
    <span class="bird-map-sight-pin-tip"></span>
  </div>`;
};

const buildPopupHtml = (entries: MapViewerEntry[]) => {
  if (entries.length === 0) {
    return `<div class="bird-map-popup"><p class="bird-map-popup-empty">기록 없음</p></div>`;
  }
  const rows = entries
    .map(
      (entry) =>
        `<button type="button" class="bird-map-popup-row" data-entry-id="${escapeHtml(entry.id)}">
          <span class="bird-map-popup-date">${escapeHtml(entry.dateLabel)}</span>
          <span class="bird-map-popup-meta">${entry.count}마리 · ${escapeHtml(entry.speciesName)}</span>
        </button>`
    )
    .join("");
  return `<div class="bird-map-popup"><div class="bird-map-popup-list">${rows}</div></div>`;
};

export function LocationMap({
  center,
  zoom = 16,
  mode,
  theme = "default",
  lockView = false,
  selectedPoint = null,
  points = [],
  fitToPoints = false,
  onPick,
  onSelectPoint,
  onSelectEntry,
}: LocationMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const hasFittedRef = useRef(false);
  const onPickRef = useRef(onPick);
  const onSelectPointRef = useRef(onSelectPoint);
  const onSelectEntryRef = useRef(onSelectEntry);
  const modeRef = useRef(mode);

  onPickRef.current = onPick;
  onSelectPointRef.current = onSelectPoint;
  onSelectEntryRef.current = onSelectEntry;
  modeRef.current = mode;

  useEffect(() => {
    let mounted = true;
    let map: any = null;

    const placePin = (lat: number, lng: number) => {
      if (modeRef.current !== "picker") {
        return;
      }
      onPickRef.current?.({ lat, lng });
    };

    const handleMapPointer = (event: { latlng: { lat: number; lng: number } }) => {
      placePin(event.latlng.lat, event.latlng.lng);
    };

    void (async () => {
      if (!rootRef.current || mapRef.current) {
        return;
      }
      const L = await import("leaflet");
      if (!mounted || !rootRef.current) {
        return;
      }

      leafletRef.current = L;
      map = L.map(rootRef.current, {
        center: [center.lat, center.lng],
        zoom,
        zoomControl: true,
        tap: false,
      });

      const tileUrl =
        theme === "warm"
          ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: theme === "warm" ? "&copy; OpenStreetMap · CARTO" : "&copy; OpenStreetMap contributors",
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      if (modeRef.current === "picker") {
        map.on("click", handleMapPointer);
      }

      mapRef.current = map;
      requestAnimationFrame(() => {
        map?.invalidateSize();
      });
    })();

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.off("click", handleMapPointer);
        mapRef.current.remove();
        mapRef.current = null;
      }
      layerRef.current = null;
      hasFittedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || lockView) {
      return;
    }
    map.setView([center.lat, center.lng], map.getZoom(), { animate: false });
  }, [center.lat, center.lng, lockView]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) {
      return;
    }

    layer.clearLayers();

    if (mode === "picker" && selectedPoint) {
      const marker = L.marker([selectedPoint.lat, selectedPoint.lng], {
        icon: L.divIcon({
          className: "bird-map-picker-pin-wrap",
          html: PICKER_PIN_HTML,
          iconSize: [34, 46],
          iconAnchor: [17, 42],
        }),
        interactive: false,
      });
      marker.addTo(layer);
      return;
    }

    if (mode === "viewer") {
      for (const point of points) {
        const marker = L.marker([point.lat, point.lng], {
          icon: L.divIcon({
            className: "bird-map-sight-pin-wrap",
            html: buildSightPinHtml(point.imageSrc, point.count, !!point.selected),
            iconSize: [58, 82],
            iconAnchor: [29, 82],
          }),
        });

        marker.bindPopup(buildPopupHtml(point.entries), {
          className: "bird-map-leaflet-popup",
          closeButton: true,
          maxWidth: 240,
        });

        marker.on("click", () => {
          onSelectPointRef.current?.(point.id);
        });

        marker.on("popupopen", () => {
          onSelectPointRef.current?.(point.id);
          const popupEl = marker.getPopup()?.getElement();
          if (!popupEl) {
            return;
          }
          popupEl.querySelectorAll<HTMLButtonElement>("[data-entry-id]").forEach((button) => {
            button.onclick = (event) => {
              event.preventDefault();
              event.stopPropagation();
              const entryId = button.getAttribute("data-entry-id");
              if (entryId) {
                onSelectEntryRef.current?.(point.id, entryId);
              }
            };
          });
        });

        marker.addTo(layer);
      }

      if (fitToPoints && points.length > 0 && !hasFittedRef.current) {
        if (points.length === 1) {
          map.setView([points[0].lat, points[0].lng], 15, { animate: false });
        } else {
          const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
          map.fitBounds(bounds.pad(0.2), { animate: false });
        }
        hasFittedRef.current = true;
      }
    }
  }, [fitToPoints, mode, points, selectedPoint]);

  const themeClass = theme === "warm" ? " bird-map-leaflet--warm" : "";

  return <div ref={rootRef} className={`bird-map-leaflet${themeClass}`} />;
}
