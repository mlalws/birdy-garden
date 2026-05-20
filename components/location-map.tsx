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
  /** viewer: 현위치 표시 */
  userLocation?: LatLng | null;
  selectedPoint?: LatLng | null;
  points?: MapViewerPoint[];
  fitToPoints?: boolean;
  onPick?: (point: LatLng) => void;
  onSelectPoint?: (id: string) => void;
  onSelectEntry?: (pointId: string, entryId: string) => void;
  onEditPoint?: (pointId: string, entryId?: string) => void;
};

const PICKER_PIN_HTML = `<span class="bird-map-picker-pin" aria-hidden="true"></span>`;
const USER_DOT_HTML = `<span class="bird-map-user-dot" aria-hidden="true"></span>`;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildSightPinHtml = (imageSrc: string, selected: boolean) => {
  const safeSrc = escapeHtml(imageSrc);
  const selectedClass = selected ? " bird-map-sight-pin--selected" : "";
  return `<div class="bird-map-sight-pin${selectedClass}" aria-hidden="true">
    <span class="bird-map-sight-pin-head">
      <span class="bird-map-sight-pin-photo">
        <img src="${safeSrc}" alt="" class="bird-map-sight-pin-img" />
      </span>
    </span>
    <span class="bird-map-sight-pin-tip"></span>
  </div>`;
};

const buildPopupHtml = (entries: MapViewerEntry[], totalCount: number) => {
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
  return `<div class="bird-map-popup">
    <p class="bird-map-popup-summary">이 위치 · 총 ${totalCount}마리 · ${entries.length}회 관찰</p>
    <div class="bird-map-popup-list">${rows}</div>
    <button type="button" class="bird-map-popup-edit" data-action="edit-location">위치 수정</button>
  </div>`;
};

export function LocationMap({
  center,
  zoom = 16,
  mode,
  theme = "default",
  lockView = false,
  userLocation = null,
  selectedPoint = null,
  points = [],
  fitToPoints = false,
  onPick,
  onSelectPoint,
  onSelectEntry,
  onEditPoint,
}: LocationMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const hasFittedRef = useRef(false);
  const lastCenterKeyRef = useRef<string | null>(null);
  const onPickRef = useRef(onPick);
  const onSelectPointRef = useRef(onSelectPoint);
  const onSelectEntryRef = useRef(onSelectEntry);
  const onEditPointRef = useRef(onEditPoint);
  const modeRef = useRef(mode);

  onPickRef.current = onPick;
  onSelectPointRef.current = onSelectPoint;
  onSelectEntryRef.current = onSelectEntry;
  onEditPointRef.current = onEditPoint;
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

      const tileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap · CARTO",
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      if (modeRef.current === "picker") {
        map.on("click", handleMapPointer);
      }

      mapRef.current = map;
      lastCenterKeyRef.current = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
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
      lastCenterKeyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (fitToPoints && points.length > 0) {
      return;
    }
    const centerKey = `${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
    if (lockView && lastCenterKeyRef.current === centerKey) {
      return;
    }
    map.setView([center.lat, center.lng], map.getZoom() || zoom, { animate: false });
    lastCenterKeyRef.current = centerKey;
  }, [center.lat, center.lng, fitToPoints, lockView, points.length, zoom]);

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
      if (userLocation) {
        const userMarker = L.marker([userLocation.lat, userLocation.lng], {
          icon: L.divIcon({
            className: "bird-map-user-dot-wrap",
            html: USER_DOT_HTML,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          interactive: false,
          zIndexOffset: 400,
        });
        userMarker.addTo(layer);
      }

      for (const point of points) {
        const marker = L.marker([point.lat, point.lng], {
          icon: L.divIcon({
            className: "bird-map-sight-pin-wrap",
            html: buildSightPinHtml(point.imageSrc, !!point.selected),
            iconSize: [52, 72],
            iconAnchor: [26, 72],
          }),
        });

        marker.bindPopup(buildPopupHtml(point.entries, point.count), {
          className: "bird-map-leaflet-popup",
          closeButton: true,
          maxWidth: 260,
        });

        marker.on("click", () => {
          onSelectPointRef.current?.(point.id);
          marker.openPopup();
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
          const editBtn = popupEl.querySelector<HTMLButtonElement>('[data-action="edit-location"]');
          if (editBtn) {
            editBtn.onclick = (event) => {
              event.preventDefault();
              event.stopPropagation();
              const firstEntryId = point.entries[0]?.id;
              onEditPointRef.current?.(point.id, firstEntryId);
            };
          }
        });

        marker.addTo(layer);
      }

      if (fitToPoints && points.length > 0 && !hasFittedRef.current) {
        const latLngs: [number, number][] = points.map((point) => [point.lat, point.lng]);
        if (userLocation) {
          latLngs.push([userLocation.lat, userLocation.lng]);
        }
        if (latLngs.length === 1) {
          map.setView(latLngs[0], 15, { animate: false });
        } else {
          const bounds = L.latLngBounds(latLngs);
          map.fitBounds(bounds.pad(0.22), { animate: false });
        }
        hasFittedRef.current = true;
      }
    }
  }, [fitToPoints, mode, points, selectedPoint, userLocation?.lat, userLocation?.lng]);

  const themeClass = theme === "warm" ? " bird-map-leaflet--warm" : "";

  return <div ref={rootRef} className={`bird-map-leaflet${themeClass}`} />;
}
