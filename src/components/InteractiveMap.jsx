import { useEffect } from "react";
import L from "leaflet";
import { getRoute } from "../utils/routing";

function pinIcon(color) {
  return L.divIcon({
    className: "custom-pin-wrapper",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,0.35);"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function InteractiveMap({
  startCoords,
  endCoords,
  startLabel = "Start",
  endLabel = "Destination",
  height = 300,
  mapId = "delivery-map",
}) {
  useEffect(() => {
    const map = L.map(mapId, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView([50.2, -85.3], 5);

    // Dark tile layer
    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    let startMarker = null;
    let endMarker = null;
    const fitToLayer = (layer) => {
      if (!layer) return;
      const bounds = layer.getBounds?.();
      if (!bounds || !bounds.isValid()) return;
      map.fitBounds(bounds, {
        padding: [42, 42],
        maxZoom: 12,
      });
    };

    if (startCoords) {
      startMarker = L.marker(startCoords, { icon: pinIcon("#d62828") })
        .addTo(map)
        .bindPopup(startLabel);
      map.setView(startCoords, 6);
    }
    if (endCoords) {
      endMarker = L.marker(endCoords, { icon: pinIcon("#1d4ed8") })
        .addTo(map)
        .bindPopup(endLabel);
    }

    const drawRoute = async () => {
      if (!startCoords || !endCoords) {
        if (startMarker) {
          map.setView(startCoords, 6);
        }
        return;
      }

      // Immediate fit so users see a zoomed route area even before route geometry returns.
      if (startMarker && endMarker) {
        const markerGroup = L.featureGroup([startMarker, endMarker]);
        fitToLayer(markerGroup);
      }

      const route = await getRoute(
        { lat: startCoords[0], lon: startCoords[1] },
        { lat: endCoords[0], lon: endCoords[1] }
      );

      if (route?.geometry?.coordinates?.length) {
        const latLngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        const routeLine = L.polyline(latLngs, {
          color: "#f2c200",
          weight: 4,
        }).addTo(map);
        fitToLayer(routeLine);
      } else {
        // Fallback if routing API is unavailable: fit both markers directly.
        if (startMarker && endMarker) {
          const group = L.featureGroup([startMarker, endMarker]);
          fitToLayer(group);
        }
      }
    };

    drawRoute();
    // Ensure Leaflet recalculates dimensions after layout settles.
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
      if (startMarker && endMarker) {
        const group = L.featureGroup([startMarker, endMarker]);
        fitToLayer(group);
      }
    }, 80);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
    };
  }, [startCoords, endCoords, startLabel, endLabel, mapId]);

  return (
    <div
      id={mapId}
      style={{
        width: "100%",
        height: `${height}px`,
        borderRadius: "8px",
        border: "2px solid #333",
        marginTop: "15px",
      }}
    />
  );
}
