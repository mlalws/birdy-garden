"use client";

import { useEffect, useRef } from "react";

type LatLng = {
  lat: number;
  lng: number;
};

type MarkerPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  selected?: boolean;
};

type LocationMapProps = {
  center: LatLng;
  zoom?: number;
  mode: "picker" | "viewer";
  selectedPoint?: LatLng | null;
  points?: MarkerPoint[];
  onPick?: (point: LatLng) => void;
  onSelectPoint?: (id: string) => void;
};

const PICKER_PIN_HTML = `<span class="bird-map-picker-pin" aria-hidden="true"></span>`;

export function LocationMap({
  center,
  zoom = 16,
  mode,
  selectedPoint = null,
  points = [],
  onPick,
  onSelectPoint,
}: LocationMapProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const onPickRef = useRef(onPick);
  const onSelectPointRef = useRef(onSelectPoint);
  const modeRef = useRef(mode);

  onPickRef.current = onPick;
  onSelectPointRef.current = onSelectPoint;
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

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      map.on("click", handleMapPointer);

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
    };
    // 지도 인스턴스는 마운트 시 1회만 생성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.setView([center.lat, center.lng], map.getZoom(), { animate: false });
  }, [center.lat, center.lng]);

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
            className: "bird-map-pin-wrap",
            html: `<button class="bird-map-pin${point.selected ? " bird-map-pin--selected" : ""}" type="button"><span class="bird-map-pin-label">${point.label}</span></button>`,
            iconSize: [42, 42],
            iconAnchor: [21, 38],
            popupAnchor: [0, -36],
          }),
        });
        marker.on("click", () => onSelectPointRef.current?.(point.id));
        marker.addTo(layer);
      }
    }
  }, [mode, points, selectedPoint]);

  return <div ref={rootRef} className="bird-map-leaflet" />;
}
