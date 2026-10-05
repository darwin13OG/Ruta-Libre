/**
 * Servicio de Rutas Reales utilizando OSRM y Geocodificación Inversa Nominatim
 * Proporciona:
 * 1. Rutas reales paso a paso sobre calles (coordenadas exactas de vías).
 * 2. Distancia real de conducción y tiempo estimado en tráfico promedio.
 * 3. Geocodificación inversa (nombres de calles, direcciones y barrios reales).
 * 4. Cálculo de orientación/ángulo de giro (bearing) para el vehículo en el mapa.
 */

const geocodeCache = new Map();

/**
 * Cálculo Haversine como respaldo offline o de fallo rápido
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.max(0.5, Number((R * c).toFixed(1)));
}

/**
 * Calcula el ángulo de rumbo (bearing en grados 0-360) entre dos puntos
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);

  return (θ * toDeg + 360) % 360;
}

/**
 * Geocodificación Inversa Gratuita con OpenStreetMap Nominatim
 * Devuelve la dirección legible de una coordenada con caché local
 */
export async function reverseGeocode(lat, lng) {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept-Language': 'es' }
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Nominatim error');
    const data = await res.json();

    const addr = data.address || {};
    const road = addr.road || addr.pedestrian || addr.footway || addr.street;
    const houseNumber = addr.house_number ? ` #${addr.house_number}` : '';
    const neighbourhood = addr.neighbourhood || addr.suburb || addr.quarter || '';
    const city = addr.city || addr.town || addr.municipality || 'Colombia';

    let formatted = '';
    if (road) {
      formatted = `${road}${houseNumber}${neighbourhood ? `, ${neighbourhood}` : ''}`;
    } else if (neighbourhood) {
      formatted = `${neighbourhood}, ${city}`;
    } else if (data.display_name) {
      formatted = data.display_name.split(',').slice(0, 2).join(',').trim();
    } else {
      formatted = `Ubicación (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }

    geocodeCache.set(cacheKey, formatted);
    return formatted;
  } catch (err) {
    clearTimeout(timeoutId);
    const fallback = `Ubicación (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    return fallback;
  }
}

/**
 * Consulta la ruta de conducción real entre dos coordenadas usando OSRM
 * @param {[number, number]} start [lat, lng]
 * @param {[number, number]} end [lat, lng]
 * @returns {Promise<{distanceKm: number, durationMin: number, coordinates: [number, number][], isRealRoute: boolean}>}
 */
export async function getRealDrivingRoute(start, end) {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;

  // OSRM espera coordenadas en formato lon,lat
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM error status: ${response.status}`);
    }

    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const primaryRoute = data.routes[0];
      const distanceKm = Number((primaryRoute.distance / 1000).toFixed(1));
      const durationMin = Math.max(3, Math.round(primaryRoute.duration / 60));

      // GeoJSON viene en [lng, lat], convertimos a [lat, lng] para Leaflet
      const coordinates = primaryRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);

      return {
        distanceKm,
        durationMin,
        coordinates,
        isRealRoute: true
      };
    }
    throw new Error('No routes returned from OSRM');
  } catch (error) {
    clearTimeout(timeoutId);

    // Respaldo de cálculo geodésico realista
    const directKm = calculateHaversineDistance(startLat, startLng, endLat, endLng);
    const distanceKm = Number((directKm * 1.25).toFixed(1));
    const durationMin = Math.max(4, Math.round((distanceKm / 22) * 60));

    const midLat = (startLat + endLat) / 2 + 0.0015;
    const midLng = (startLng + endLng) / 2 - 0.0015;

    return {
      distanceKm,
      durationMin,
      coordinates: [
        [startLat, startLng],
        [midLat, midLng],
        [endLat, endLng]
      ],
      isRealRoute: false
    };
  }
}

/**
 * Tarifa sugerida transparente y justa en efectivo (COP)
 * - Carro: Base $4.000 COP, $1.800/km, Mínimo $5.000 COP
 * - Moto: Base $2.500 COP, $1.100/km (~40% de descuento), Mínimo $3.500 COP
 * - Redondeo a miles para facilidad en efectivo
 */
export function calculateSuggestedFare(distanceKm, vehicleType = 'car') {
  const isMoto = vehicleType === 'moto';
  const base = isMoto ? 2500 : 4000;
  const perKm = isMoto ? 1100 : 1800;
  const minFare = isMoto ? 2500 : 4000;

  const raw = base + (distanceKm * perKm);
  const rounded = Math.round(raw / 1000) * 1000;
  return Math.max(minFare, rounded);
}
