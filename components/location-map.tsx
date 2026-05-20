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

  useEffect(() => {
    let mounted = true;

    void (async () => {
      if (!rootRef.current || mapRef.current) {
        return;
      }
      const L = await import("leaflet");
      if (!mounted || !rootRef.current) {
        return;
      }
      leafletRef.current = L;
      const map = L.map(rootRef.current, {
        center: [center.lat, center.lng],
        zoom,
        zoomControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      if (mode === "picker") {
        map.on("click", (event: any) => {
          onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng });
        });
      }
      mapRef.current = map;
    })();

    return () => {
      mounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      layerRef.current = null;
    };
  }, [center.lat, center.lng, mode, onPick, zoom]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }
    mapRef.current.setView([center.lat, center.lng], mapRef.current.getZoom(), { animate: false });
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
      const marker = L.circleMarker([selectedPoint.lat, selectedPoint.lng], {
        radius: 8,
        color: "#b21f2d",
        fillColor: "#f04657",
        fillOpacity: 0.85,
        weight: 2,
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
        marker.on("click", () => onSelectPoint?.(point.id));
        marker.addTo(layer);
      }
    }
  }, [mode, onSelectPoint, points, selectedPoint]);

  return <div ref={rootRef} className="bird-map-leaflet" />;
}
