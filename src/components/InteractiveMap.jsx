import { useEffect, useRef } from "react";
import L from "leaflet";

function pinIcon(color, size) {
  return L.divIcon({
    className: "custom-pin-wrapper",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,0.45);"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function movedKm(from, to) {
  if (!from || !to) return Infinity;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function InteractiveMap({
  startCoords,
  endCoords,
  geometry = null,
  startLabel = "Yard",
  endLabel = "Destination",
  height = 300,
  mapId = "delivery-map",
  onEndChange,
}) {
  const onEndChangeRef = useRef(onEndChange);
  onEndChangeRef.current = onEndChange;
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const fittedEndRef = useRef(null);
  const ignoreClickRef = useRef(false);

  const startLat = Number(startCoords?.[0]);
  const startLon = Number(startCoords?.[1]);
  const endLat = Number(endCoords?.[0]);
  const endLon = Number(endCoords?.[1]);
  const hasStart = Number.isFinite(startLat) && Number.isFinite(startLon);
  const hasEnd = Number.isFinite(endLat) && Number.isFinite(endLon);

  useEffect(() => {
    const map = L.map(mapId, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView([49.2, -85.3], 5);

    L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (event) => {
      if (ignoreClickRef.current) return;
      onEndChangeRef.current?.(event.latlng.lat, event.latlng.lng);
    });

    mapRef.current = map;
    const resizeTimer = setTimeout(() => map.invalidateSize(), 120);
    return () => {
      clearTimeout(resizeTimer);
      layersRef.current = [];
      map.remove();
      mapRef.current = null;
      fittedEndRef.current = null;
    };
  }, [mapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    for (const layer of layersRef.current) layer.remove();
    layersRef.current = [];

    if (hasStart) {
      const startMarker = L.marker([startLat, startLon], { icon: pinIcon("#d62828", 18) })
        .addTo(map)
        .bindPopup(startLabel);
      layersRef.current.push(startMarker);
    }

    if (hasEnd) {
      const endMarker = L.marker([endLat, endLon], {
        icon: pinIcon("#1d4ed8", 36),
        draggable: true,
        autoPan: true,
        bubblingMouseEvents: false,
        zIndexOffset: 600,
      }).addTo(map).bindPopup(endLabel);
      endMarker.on("dragstart", () => {
        ignoreClickRef.current = true;
      });
      endMarker.on("dragend", () => {
        const spot = endMarker.getLatLng();
        onEndChangeRef.current?.(spot.lat, spot.lng);
        setTimeout(() => {
          ignoreClickRef.current = false;
        }, 400);
      });
      layersRef.current.push(endMarker);
    }

    if (geometry?.coordinates?.length) {
      const latLngs = geometry.coordinates
        .map(([lon, lat]) => [Number(lat), Number(lon)])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
      if (latLngs.length) {
        const routeLine = L.polyline(latLngs, { color: "#f2c200", weight: 4 }).addTo(map);
        layersRef.current.push(routeLine);
      }
    }

    const end = hasEnd ? { lat: endLat, lon: endLon } : null;
    if (end && movedKm(fittedEndRef.current, end) > 1) {
      map.setView([end.lat, end.lon], 14);
      fittedEndRef.current = end;
    } else if (!end && hasStart && !fittedEndRef.current) {
      map.setView([startLat, startLon], 8);
      fittedEndRef.current = { lat: startLat, lon: startLon };
    }

    const resizeTimer = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(resizeTimer);
  }, [hasStart, startLat, startLon, hasEnd, endLat, endLon, startLabel, endLabel, geometry]);

  return (
    <div className="delivery-map-wrap">
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
      <p className="address-hint">Tap the map or drag the blue pin if the spot is wrong. The red pin is the yard.</p>
    </div>
  );
}
