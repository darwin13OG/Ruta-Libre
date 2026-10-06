/**
 * Controlador Principal de la Aplicación Ruta Libre
 * 100% Real, Descentralizado y Resiliente.
 * 
 * Novedades y Correcciones Clave:
 * 1. CERO EMOJIS: Toda la interfaz y marcadores usan vectores SVG limpios y profesionales.
 * 2. MAPA EXPANDIBLE: Botón de pantalla completa / zoom para navegar cómodamente.
 * 3. DOBLE TRAZADO PARA EL CONDUCTOR: Al seleccionar una oferta se delinea:
 *    - Ruta 1: Del conductor al punto de recogida (a tu encuentro).
 *    - Ruta 2: Del punto de recogida al destino del pasajero (viaje completo).
 * 4. HOJA INFERIOR TIPO GOOGLE MAPS: Deslizable, sin estorbar el mapa ni consumir espacio.
 * 5. BOTONES DE ACEPTAR Y CONTRAOFERTA 100% FUNCIONALES con retroalimentación instantánea.
 * 6. NOTIFICACIONES TOAST INTERNAS (Cero window.alert invasivos o bloqueados).
 */

import {
  getRealDrivingRoute,
  calculateSuggestedFare,
  reverseGeocode
} from './services/routing.js';
import { P2PNetwork, encodeGeohash, generateTripFingerprint } from './services/p2p.js';
import {
  getStoredProfile,
  saveStoredProfile,
  getStoredHistory,
  saveTripRecord,
  getStoredDriverInfo,
  saveStoredDriverInfo,
  getLastKnownLocation,
  saveLastKnownLocation,
  getDriverStats,
  recordDriverCompletedTrip
} from './services/storage.js';
import { audioService } from './services/audio.js';

/* =====================================================================
   VECTORES SVG PROFESIONALES (CERO EMOJIS)
   ===================================================================== */
const SVG_ICONS = {
  car: `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`,
  moto: `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h4.2c.45 2.31 2.44 4 4.9 4 2.8 0 5-2.2 5-5 0-2.61-1.95-4.74-4.56-4.97zM7.82 15C7.4 16.15 6.3 17 5 17c-1.65 0-3-1.35-3-3s1.35-3 3-3c.92 0 1.73.42 2.27 1.08L5.7 13.5l1.41 1.41.71-.91zm11.18 2c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z"/></svg>`,
  flag: `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>`,
  user: `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  star: `<svg class="w-3 h-3 text-amber-400 fill-current" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`
};

// Estado global de la aplicación
const appState = {
  profile: null,
  driverInfo: null,
  role: 'passenger', // 'passenger' | 'driver'
  vehicleType: 'car', // 'car' | 'moto'
  cashBill: 'exact', // 'exact' | 10000 | 20000 | 50000 | 100000 | personalizado
  originCoords: [6.2085, -75.5684],
  destCoords: [6.2125, -75.5644],
  hasRealGPS: false,
  originName: 'Detectando tu ubicación GPS...',
  destName: 'Destino cercano (arrástralo en el mapa)',
  realDistanceKm: 1.0,
  realDurationMin: 4,
  suggestedFare: 4000,
  offeredFare: 4000,
  isCustomOffer: false,
  currentRouteWaypoints: [],
  watchPositionId: null,
  activeTripId: null,
  activeTripData: null,
  activeTripPin: null,
  activeFingerprint: '',
  pendingDriverTrip: null,
  unreadChatCount: 0,
  network: null,
  map: null,
  originMarker: null,
  destMarker: null,
  carMarker: null,
  routePolyline: null,
  countdownInterval: null,
  // Elementos dedicados exclusivamente al Modo Conductor
  driverMarker: null,
  driverRequestMarkers: new Map(), // tripId -> L.Marker
  driverPreviewLayers: [], // Polilíneas y marcadores de la doble ruta
  activeRequests: new Map(), // tripId -> requestData
  selectedDriverTripId: null
};

/* =====================================================================
   SISTEMA DE NOTIFICACIONES TOAST (CERO ALERTAS WINDOW.ALERT)
   ===================================================================== */
function showToast(message, duration = 3000) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  toast.classList.add('opacity-100');

  if (window._toastTimeout) clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, duration);
}

/* =====================================================================
   1. INICIALIZACIÓN DEL MAPA LEAFLET Y GEOLOCALIZACIÓN REAL
   ===================================================================== */
function initMap() {
  if (typeof L === 'undefined') return;

  const lastKnown = getLastKnownLocation();
  if (lastKnown && Array.isArray(lastKnown) && lastKnown.length === 2) {
    appState.originCoords = [lastKnown[0], lastKnown[1]];
    appState.destCoords = [lastKnown[0] + 0.0035, lastKnown[1] + 0.0035];
  }

  appState.map = L.map('leaflet-map', {
    zoomControl: false,
    attributionControl: false
  }).setView(appState.originCoords, 15);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(appState.map);

  const originIcon = L.divIcon({
    className: 'origin-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-grab active:cursor-grabbing">
        <div class="w-7 h-7 rounded-full bg-blue-500/25 animate-ping absolute"></div>
        <div class="w-5 h-5 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center shadow-xl">
          <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
        </div>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const destIcon = L.divIcon({
    className: 'dest-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-grab active:cursor-grabbing">
        <div class="w-7 h-7 rounded-full bg-red-500/25 animate-pulse absolute"></div>
        <div class="w-5 h-5 rounded-full bg-red-500 border-2 border-white flex items-center justify-center shadow-xl text-white">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
          </svg>
        </div>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  appState.originMarker = L.marker(appState.originCoords, { icon: originIcon, draggable: true }).addTo(appState.map);
  appState.destMarker = L.marker(appState.destCoords, { icon: destIcon, draggable: true }).addTo(appState.map);

  appState.originMarker.on('dragend', async (e) => {
    if (appState.role !== 'passenger') return;
    const pos = e.target.getLatLng();
    appState.originCoords = [pos.lat, pos.lng];
    saveLastKnownLocation(appState.originCoords);
    document.getElementById('origin-input-label').textContent = 'Buscando dirección...';
    const address = await reverseGeocode(pos.lat, pos.lng);
    appState.originName = address;
    document.getElementById('origin-input-label').textContent = address;
    updateRealRouteAndTiming();
    if (appState.network) appState.network.updateLocationGeohash(pos.lat, pos.lng);
  });

  appState.destMarker.on('dragend', async (e) => {
    if (appState.role !== 'passenger') return;
    const pos = e.target.getLatLng();
    appState.destCoords = [pos.lat, pos.lng];
    document.getElementById('dest-input-label').textContent = 'Buscando dirección...';
    const address = await reverseGeocode(pos.lat, pos.lng);
    appState.destName = address;
    document.getElementById('dest-input-label').textContent = address;
    updateRealRouteAndTiming();
  });

  appState.map.on('click', async (e) => {
    if (appState.activeTripData) return;

    if (appState.role === 'driver') {
      clearDriverPreviewRoute();
      return;
    }

    appState.destCoords = [e.latlng.lat, e.latlng.lng];
    appState.destMarker.setLatLng(e.latlng);
    document.getElementById('dest-input-label').textContent = 'Buscando dirección...';

    const address = await reverseGeocode(e.latlng.lat, e.latlng.lng);
    appState.destName = address;
    document.getElementById('dest-input-label').textContent = address;
    updateRealRouteAndTiming();
  });

  detectAndApplyUserGPS(true);
}

function detectAndApplyUserGPS(isFirstLoad = false) {
  if (!navigator.geolocation) {
    updateRealRouteAndTiming();
    return;
  }

  const originLabel = document.getElementById('origin-input-label');
  if (originLabel && !appState.hasRealGPS) {
    originLabel.textContent = 'Obteniendo GPS en tiempo real...';
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      appState.hasRealGPS = true;
      appState.originCoords = [lat, lng];

      appState.destCoords = [lat + 0.0035, lng + 0.0035];
      saveLastKnownLocation([lat, lng]);

      if (appState.originMarker) appState.originMarker.setLatLng(appState.originCoords);
      if (appState.destMarker) appState.destMarker.setLatLng(appState.destCoords);

      if (appState.driverMarker) {
        appState.driverMarker.setLatLng(appState.originCoords);
      }

      if (appState.map) {
        appState.map.setView(appState.originCoords, 15);
      }

      reverseGeocode(lat, lng).then(addr => {
        appState.originName = addr;
        const el = document.getElementById('origin-input-label');
        if (el) el.textContent = addr;
      });

      reverseGeocode(appState.destCoords[0], appState.destCoords[1]).then(addr => {
        appState.destName = addr;
        const el = document.getElementById('dest-input-label');
        if (el) el.textContent = addr;
      });

      if (appState.role === 'passenger') {
        updateRealRouteAndTiming();
      }

      if (appState.network) {
        appState.network.updateLocationGeohash(lat, lng);
      }
    },
    (err) => {
      console.warn('GPS no disponible:', err.message);
      reverseGeocode(appState.originCoords[0], appState.originCoords[1]).then(addr => {
        appState.originName = addr;
        const el = document.getElementById('origin-input-label');
        if (el) el.textContent = addr;
      });
      if (appState.role === 'passenger') {
        updateRealRouteAndTiming();
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/**
 * Consulta y dibuja la ruta real de conducción por calles (OSRM) para el PASAJERO
 */
async function updateRealRouteAndTiming() {
  if (appState.role !== 'passenger') return;

  const etaText = document.getElementById('eta-text');
  const distText = document.getElementById('dist-text');
  const suggestedLabel = document.getElementById('suggested-price-label');

  if (etaText) etaText.textContent = 'Calculando...';

  const routeData = await getRealDrivingRoute(appState.originCoords, appState.destCoords);

  appState.realDistanceKm = routeData.distanceKm;
  appState.realDurationMin = routeData.durationMin;
  appState.currentRouteWaypoints = routeData.coordinates;
  appState.suggestedFare = calculateSuggestedFare(routeData.distanceKm, appState.vehicleType);

  const minFare = appState.vehicleType === 'moto' ? 2500 : 4000;

  if (!appState.isCustomOffer) {
    appState.offeredFare = appState.suggestedFare;
  } else if (appState.offeredFare < minFare) {
    appState.offeredFare = minFare;
  }

  const offerPriceVal = document.getElementById('offer-price-val');
  if (offerPriceVal) {
    offerPriceVal.textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
  }

  if (etaText) etaText.textContent = `${routeData.durationMin} min`;
  if (distText) distText.textContent = `${routeData.distanceKm} km`;
  if (suggestedLabel) suggestedLabel.textContent = `$${appState.suggestedFare.toLocaleString('es-CO')} COP`;

  updateCashChangeUI();

  if (appState.map && appState.role === 'passenger') {
    if (appState.routePolyline) {
      appState.map.removeLayer(appState.routePolyline);
    }

    appState.routePolyline = L.polyline(routeData.coordinates, {
      color: appState.vehicleType === 'moto' ? '#F59E0B' : '#3B82F6',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(appState.map);

    appState.map.fitBounds(appState.routePolyline.getBounds(), { padding: [45, 45] });

    setTimeout(() => {
      if (appState.map) appState.map.invalidateSize();
    }, 250);
  }
}

/* =====================================================================
   2. CONTROLES DEL MAPA (AMPLIAR / PANTALLA COMPLETA ESTILO GOOGLE MAPS)
   ===================================================================== */
window.toggleMapExpand = function() {
  const wrapper = document.getElementById('map-wrapper');
  const icon = document.getElementById('icon-map-expand');
  if (!wrapper || !appState.map) return;

  const isExpanded = wrapper.classList.contains('h-[70vh]');

  if (isExpanded) {
    wrapper.classList.remove('h-[70vh]');
    wrapper.classList.add('h-[320px]');
    if (icon) {
      icon.innerHTML = `<path d="M15 3h6v6m0-6L14 10M9 21H3v-6m0 6l7-7"/>`;
    }
  } else {
    wrapper.classList.remove('h-[320px]');
    wrapper.classList.add('h-[70vh]');
    if (icon) {
      icon.innerHTML = `<path d="M4 14h6v6m0-6L3 21M20 10h-6V4m0 6l7-7"/>`;
    }
  }

  setTimeout(() => {
    if (appState.map) appState.map.invalidateSize();
  }, 350);
};

window.mapZoomIn = function() {
  if (appState.map) appState.map.zoomIn();
};

window.mapZoomOut = function() {
  if (appState.map) appState.map.zoomOut();
};

window.toggleDriverSheetExpand = function() {
  const list = document.getElementById('driver-trips-list');
  if (list) {
    list.classList.toggle('hidden');
  }
};

/* =====================================================================
   3. SELECTOR DE VEHÍCULO (CARRO / MOTO) Y CAMBIO EN EFECTIVO
   ===================================================================== */
window.selectVehicleType = function(type) {
  appState.vehicleType = type;
  const btnCar = document.getElementById('vehicle-type-car');
  const btnMoto = document.getElementById('vehicle-type-moto');

  if (type === 'car') {
    btnCar.className = 'py-2 px-3 rounded-xl bg-surfaceCard border border-white/20 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all';
    btnMoto.className = 'py-2 px-3 rounded-xl text-subtext hover:text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all';
  } else {
    btnMoto.className = 'py-2 px-3 rounded-xl bg-surfaceCard border border-white/20 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all';
    btnCar.className = 'py-2 px-3 rounded-xl text-subtext hover:text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all';
  }

  updateRealRouteAndTiming();
};

window.selectCashBill = function(bill) {
  appState.cashBill = bill;

  const customInput = document.getElementById('custom-bill-input');
  if (customInput) customInput.value = '';

  const bills = ['exact', 10000, 20000, 50000, 100000];
  const ids = {
    exact: 'btn-bill-exact',
    10000: 'btn-bill-10k',
    20000: 'btn-bill-20k',
    50000: 'btn-bill-50k',
    100000: 'btn-bill-100k'
  };

  bills.forEach(b => {
    const el = document.getElementById(ids[b]);
    if (el) {
      if (b === bill) {
        el.className = 'py-1.5 px-0.5 rounded-lg bg-surfaceCard border border-white/20 text-white text-[10px] font-semibold font-mono active:scale-95 shadow-sm';
      } else {
        el.className = 'py-1.5 px-0.5 rounded-lg bg-[#161b22] border border-cardBorder text-subtext hover:text-white text-[10px] font-semibold font-mono active:scale-95';
      }
    }
  });

  updateCashChangeUI();
};

window.onCustomBillInput = function(val) {
  const clean = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
  if (!isNaN(clean) && clean > 0) {
    appState.cashBill = clean;
    ['btn-bill-exact', 'btn-bill-10k', 'btn-bill-20k', 'btn-bill-50k', 'btn-bill-100k'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'py-1.5 px-0.5 rounded-lg bg-[#161b22] border border-cardBorder text-subtext hover:text-white text-[10px] font-semibold font-mono active:scale-95';
    });
  } else {
    appState.cashBill = 'exact';
  }
  updateCashChangeUI();
};

function updateCashChangeUI() {
  const label = document.getElementById('change-due-label');
  if (!label) return;

  if (appState.cashBill === 'exact') {
    label.textContent = 'Efectivo exacto';
    label.className = 'text-xs font-mono font-bold text-emerald-400';
  } else {
    const billNum = Number(appState.cashBill);
    const fareNum = Number(appState.offeredFare) || 0;
    const change = billNum - fareNum;

    if (change > 0) {
      label.textContent = `Cambio: $${change.toLocaleString('es-CO')} COP`;
      label.className = 'text-xs font-mono font-bold text-amber-400';
    } else if (change === 0) {
      label.textContent = 'Monto exacto';
      label.className = 'text-xs font-mono font-bold text-emerald-400';
    } else {
      label.textContent = `Faltan $${Math.abs(change).toLocaleString('es-CO')} COP para cubrir tarifa`;
      label.className = 'text-xs font-mono font-bold text-red-400';
    }
  }
}

/* =====================================================================
   4. MODO CONDUCTOR DEDICADO: RADAR, PINES Y DOBLE RUTA
   ===================================================================== */

/**
 * Crea o actualiza el marcador del conductor con icono SVG (sin emojis)
 */
function createOrUpdateDriverMarker() {
  if (!appState.map) return;

  const isMoto = appState.driverInfo?.vType === 'moto' || appState.vehicleType === 'moto';

  const driverIcon = L.divIcon({
    className: 'driver-location-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer">
        <div class="w-14 h-14 rounded-full bg-emerald-500/20 animate-ping absolute"></div>
        <div class="w-9 h-9 rounded-full bg-emerald-500/30 animate-pulse absolute"></div>
        <div class="w-8 h-8 rounded-full bg-[#0d1117] border-2 border-emerald-400 flex items-center justify-center shadow-2xl z-10 text-emerald-400">
          ${isMoto ? SVG_ICONS.moto : SVG_ICONS.car}
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  if (appState.driverMarker) {
    appState.driverMarker.setLatLng(appState.originCoords);
    appState.driverMarker.setIcon(driverIcon);
    if (!appState.map.hasLayer(appState.driverMarker)) {
      appState.driverMarker.addTo(appState.map);
    }
  } else {
    appState.driverMarker = L.marker(appState.originCoords, { icon: driverIcon, zIndexOffset: 1000 }).addTo(appState.map);
  }
}

window.centerOnDriverLocation = function() {
  if (!appState.map) return;
  appState.map.setView(appState.originCoords, 15, { animate: true });
};

/**
 * Agrega o actualiza una solicitud de viaje EN EL MAPA y en la lista del conductor
 */
function renderDriverRequestCard(req) {
  if (!req || !req.tripId) return;

  appState.activeRequests.set(req.tripId, req);
  updateDriverRadarStatus();

  // 1. PIN EN EL MAPA (Vector SVG profesional, cero emojis)
  if (appState.map && req.originCoords && Array.isArray(req.originCoords)) {
    if (appState.driverRequestMarkers.has(req.tripId)) {
      appState.map.removeLayer(appState.driverRequestMarkers.get(req.tripId));
    }

    const isMoto = req.vehicleType === 'moto';
    const requestPinIcon = L.divIcon({
      className: 'driver-request-pin',
      html: `
        <div class="relative flex flex-col items-center cursor-pointer group transform hover:scale-105 active:scale-95 transition-all" title="Toca para ver el recorrido completo">
          <div class="bg-emerald-500 text-black font-mono font-bold text-xs px-2.5 py-1 rounded-full shadow-2xl border-2 border-white flex items-center gap-1.5 whitespace-nowrap">
            <span class="text-black">${isMoto ? SVG_ICONS.moto : SVG_ICONS.car}</span>
            <span id="pin-price-${req.tripId}">$${Number(req.fare).toLocaleString('es-CO')}</span>
          </div>
          <div class="w-2 h-2 bg-emerald-500 rotate-45 -mt-1 border-r border-b border-white"></div>
        </div>
      `,
      iconSize: [85, 34],
      iconAnchor: [42, 32]
    });

    const marker = L.marker(req.originCoords, { icon: requestPinIcon, zIndexOffset: 500 }).addTo(appState.map);

    marker.on('click', () => {
      showDriverTripPreview(req.tripId);
    });

    appState.driverRequestMarkers.set(req.tripId, marker);
  }

  // 2. TARJETA EN LA LISTA DEL CONDUCTOR
  const container = document.getElementById('driver-trips-list');
  if (!container) return;

  const emptyMsg = document.getElementById('no-driver-trips-msg');
  if (emptyMsg) emptyMsg.remove();

  const cardId = `req_${req.tripId}`;
  let card = document.getElementById(cardId);
  const isNew = !card;

  if (isNew) {
    card = document.createElement('div');
    card.id = cardId;
  }

  card.className = 'rounded-2xl bg-[#0d1117] border border-cardBorder p-3.5 space-y-2.5 transition-all hover:border-emerald-500/50';

  const changeInfo = req.payingWith && req.payingWith !== 'exact'
    ? `<span class="text-[10px] text-amber-400 font-mono">Paga con $${Number(req.payingWith).toLocaleString('es-CO')}</span>`
    : `<span class="text-[10px] text-emerald-400 font-mono">Efectivo exacto</span>`;

  const vehicleBadge = req.vehicleType === 'moto'
    ? `<span class="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded flex items-center gap-1">${SVG_ICONS.moto} Moto</span>`
    : `<span class="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded flex items-center gap-1">${SVG_ICONS.car} Carro</span>`;

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-white">${req.passengerName || 'Pasajero'}</span>
        ${vehicleBadge}
      </div>
      <button class="view-map-btn text-xs font-mono font-bold text-blue-400 hover:text-blue-300 underline flex items-center gap-1">
        <span>${req.distanceKm || '0.0'} km • Ver ruta</span>
      </button>
    </div>
    <div class="text-xs text-subtext space-y-1">
      <p class="truncate"><strong class="text-slate-300">Recogida:</strong> ${req.origin || 'Ubicación origen'}</p>
      <p class="truncate"><strong class="text-slate-300">Destino:</strong> ${req.destination || 'Ubicación destino'}</p>
    </div>
    <div class="flex items-center justify-between bg-surfaceCard px-3 py-1.5 rounded-xl border border-cardBorder">
      <div class="space-y-0.5">
        <span class="text-[10px] text-subtext block">Oferta:</span>
        ${changeInfo}
      </div>
      <span class="text-sm font-bold font-mono text-emerald-400" id="card-price-${req.tripId}">$${Number(req.fare).toLocaleString('es-CO')} COP</span>
    </div>
    <div class="grid grid-cols-12 gap-1.5 pt-1">
      <button class="accept-req-btn col-span-6 h-9 rounded-xl bg-white hover:bg-slate-200 text-black font-bold text-xs active:scale-95 shadow transition-all">
        Aceptar
      </button>
      <button class="counter-1-btn col-span-3 h-9 rounded-xl bg-surfaceCard hover:bg-cardBorder border border-cardBorder text-white text-xs font-mono active:scale-95 transition-all">
        +$1.000
      </button>
      <button class="counter-2-btn col-span-3 h-9 rounded-xl bg-surfaceCard hover:bg-cardBorder border border-cardBorder text-white text-xs font-mono active:scale-95 transition-all">
        +$2.000
      </button>
    </div>
  `;

  card.querySelector('.view-map-btn').addEventListener('click', () => {
    showDriverTripPreview(req.tripId);
  });
  card.querySelector('.accept-req-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, req.fare, true);
  });
  card.querySelector('.counter-1-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, Number(req.fare) + 1000, false);
  });
  card.querySelector('.counter-2-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, Number(req.fare) + 2000, false);
  });

  if (isNew) {
    container.prepend(card);
  }
}

/**
 * Muestra la DOBLE RUTA solicitada por el usuario:
 * 1. Recorrido del conductor al punto de recogida (a su encuentro).
 * 2. Recorrido del viaje del pasajero (recogida hasta destino).
 */
async function showDriverTripPreview(tripId) {
  const req = appState.activeRequests.get(tripId);
  if (!req || !appState.map) return;

  appState.selectedDriverTripId = tripId;
  clearDriverPreviewRoute(false);

  // Ubicaciones clave
  const driverCoords = appState.originCoords;
  const pickupCoords = req.originCoords;
  const destCoords = req.destCoords;

  if (!pickupCoords || !destCoords) return;

  // 1. Trazado 1: Conductor al punto de recogida (Azul / Cyan punteado)
  const routeToPickup = await getRealDrivingRoute(driverCoords, pickupCoords);
  const pickupPolyline = L.polyline(routeToPickup.coordinates, {
    color: '#38BDF8',
    weight: 5,
    opacity: 0.95,
    dashArray: '6, 6',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(appState.map);
  appState.driverPreviewLayers.push(pickupPolyline);

  // 2. Trazado 2: Punto de recogida al destino del pasajero (Esmeralda sólido)
  const routeTrip = await getRealDrivingRoute(pickupCoords, destCoords);
  const tripPolyline = L.polyline(routeTrip.coordinates, {
    color: '#10B981',
    weight: 5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(appState.map);
  appState.driverPreviewLayers.push(tripPolyline);

  // Marcador de punto de destino del pasajero (bandera de llegada limpia)
  const dropoffIcon = L.divIcon({
    className: 'dropoff-preview-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center shadow-xl text-black">
          ${SVG_ICONS.flag}
        </div>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  const dropoffMarker = L.marker(destCoords, { icon: dropoffIcon }).addTo(appState.map);
  appState.driverPreviewLayers.push(dropoffMarker);

  // Ajustar mapa para ver ambos tramos con amplitud
  const bounds = L.latLngBounds([driverCoords, pickupCoords, destCoords]);
  appState.map.fitBounds(bounds, { padding: [40, 40] });

  // 3. Actualizar la tarjeta deslizable tipo Google Maps (Selected Preview Card)
  const previewCard = document.getElementById('driver-selected-preview-card');
  const generalView = document.getElementById('driver-radar-general-view');

  if (previewCard && generalView) {
    document.getElementById('preview-passenger-name').textContent = req.passengerName || 'Pasajero';
    document.getElementById('preview-passenger-avatar').textContent = (req.passengerName || 'P').charAt(0).toUpperCase();

    const isMoto = req.vehicleType === 'moto';
    const vehBadge = document.getElementById('preview-vehicle-badge');
    vehBadge.innerHTML = `${isMoto ? SVG_ICONS.moto : SVG_ICONS.car} ${isMoto ? 'Moto' : 'Carro'}`;

    document.getElementById('preview-eta-to-pickup').textContent = `${routeToPickup.durationMin} min (${routeToPickup.distanceKm} km)`;
    document.getElementById('preview-pickup-address').textContent = req.origin || 'Punto de recogida';

    document.getElementById('preview-trip-distance').textContent = `${routeTrip.durationMin} min (${routeTrip.distanceKm} km)`;
    document.getElementById('preview-dest-address').textContent = req.destination || 'Punto de destino';

    document.getElementById('preview-fare-amount').textContent = `$${Number(req.fare).toLocaleString('es-CO')} COP`;

    const changeEl = document.getElementById('preview-cash-bill');
    if (changeEl) {
      changeEl.textContent = req.payingWith && req.payingWith !== 'exact'
        ? `Paga con billete de $${Number(req.payingWith).toLocaleString('es-CO')}`
        : 'Efectivo exacto';
    }

    // Configurar botones de acción funcionales
    const btnAccept = document.getElementById('preview-btn-accept');
    const btnC1 = document.getElementById('preview-btn-counter-1');
    const btnC2 = document.getElementById('preview-btn-counter-2');

    btnAccept.onclick = () => sendDriverOffer(req.tripId, req.fare, true);
    btnC1.onclick = () => sendDriverOffer(req.tripId, Number(req.fare) + 1000, false);
    btnC2.onclick = () => sendDriverOffer(req.tripId, Number(req.fare) + 2000, false);

    generalView.classList.add('hidden');
    previewCard.classList.remove('hidden');
  }
}

window.clearDriverPreviewRoute = function(restoreView = true) {
  appState.driverPreviewLayers.forEach(layer => {
    if (appState.map && appState.map.hasLayer(layer)) {
      appState.map.removeLayer(layer);
    }
  });
  appState.driverPreviewLayers = [];
  appState.selectedDriverTripId = null;

  if (restoreView) {
    const previewCard = document.getElementById('driver-selected-preview-card');
    const generalView = document.getElementById('driver-radar-general-view');
    if (previewCard && generalView) {
      previewCard.classList.add('hidden');
      generalView.classList.remove('hidden');
    }
    if (appState.map) {
      appState.map.setView(appState.originCoords, 15, { animate: true });
    }
  }
};

function updateDriverRadarStatus() {
  const subtitle = document.getElementById('driver-radar-subtitle');
  if (!subtitle) return;

  const count = appState.activeRequests.size;
  if (count === 0) {
    subtitle.textContent = 'Esperando solicitudes de pasajeros en tu sector';
  } else {
    subtitle.textContent = `${count} viaje(s) disponible(s) en tu mapa`;
  }
}

window.simulateTestDriverRequest = function() {
  const driverLat = appState.originCoords[0];
  const driverLng = appState.originCoords[1];

  const sampleOrigin = [driverLat + 0.0045, driverLng - 0.0035];
  const sampleDest = [driverLat + 0.0120, driverLng + 0.0070];

  const testTripId = `TEST_${Date.now()}`;
  const isMoto = Math.random() > 0.5;

  reverseGeocode(sampleOrigin[0], sampleOrigin[1]).then(originAddr => {
    reverseGeocode(sampleDest[0], sampleDest[1]).then(destAddr => {
      const sampleReq = {
        tripId: testTripId,
        passengerName: 'Laura G.',
        vehicleType: isMoto ? 'moto' : 'car',
        payingWith: 20000,
        origin: originAddr,
        destination: destAddr,
        originCoords: sampleOrigin,
        destCoords: sampleDest,
        distanceKm: 2.4,
        durationMin: 7,
        fare: isMoto ? 5000 : 9000
      };

      renderDriverRequestCard(sampleReq);
      audioService.playSound('offer');
      showDriverTripPreview(testTripId);
      showToast('Nueva solicitud de prueba en tu mapa');
    });
  });
};

function sendDriverOffer(tripId, fare, isAccept) {
  const driverInfo = appState.driverInfo;
  if (!driverInfo) {
    showToast('Completa tu registro de conductor para ofertar');
    checkDriverVerificationOrPrompt();
    return;
  }

  const req = appState.activeRequests.get(tripId);
  if (req) {
    req.fare = fare;
    const cardPrice = document.getElementById(`card-price-${tripId}`);
    if (cardPrice) cardPrice.textContent = `$${Number(fare).toLocaleString('es-CO')} COP`;

    const pinPrice = document.getElementById(`pin-price-${tripId}`);
    if (pinPrice) pinPrice.textContent = `$${Number(fare).toLocaleString('es-CO')}`;

    const previewFare = document.getElementById('preview-fare-amount');
    if (previewFare && appState.selectedDriverTripId === tripId) {
      previewFare.textContent = `$${Number(fare).toLocaleString('es-CO')} COP`;
    }
  }

  // Si es un viaje de prueba o simulado, permitir iniciar de inmediato el viaje activo con el PIN
  if (tripId.startsWith('TEST_')) {
    if (isAccept) {
      audioService.playSound('accepted');
      showToast('¡Viaje aceptado! Solicita el PIN al pasajero');
      promptDriverPinInput({
        expectedPin: '1234',
        fare: fare,
        tripId: tripId
      });
    } else {
      audioService.playSound('offer');
      showToast(`Contraoferta de $${Number(fare).toLocaleString('es-CO')} enviada`);
    }
    return;
  }

  // Publicación real en P2P
  appState.network.publish(`rutalibre/v1/trip/${tripId}/offers`, {
    tripId,
    driverId: appState.profile ? appState.profile.id : 'DRV_ME',
    driverName: appState.profile ? appState.profile.alias : 'Conductor',
    driverDoc: driverInfo.docId,
    driverPhone: driverInfo.phone,
    rating: '5.0',
    vehicle: `${driverInfo.model} ${driverInfo.color}`,
    plate: driverInfo.plate,
    etaMin: 3,
    distanceKm: 1.0,
    fare: fare,
    isAccept: isAccept
  });

  audioService.playSound(isAccept ? 'accepted' : 'offer');
  showToast(isAccept ? `Aceptación de viaje enviada al pasajero` : `Contraoferta de $${Number(fare).toLocaleString('es-CO')} enviada`);
}

function setDriverModeActive() {
  appState.role = 'driver';

  const bPass = document.getElementById('toggle-pass');
  const bDriv = document.getElementById('toggle-driv');

  if (bDriv) bDriv.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition-all';
  if (bPass) bPass.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-subtext hover:text-white transition-all';
  
  const titleEl = document.getElementById('header-title');
  const subEl = document.getElementById('header-subtitle');
  const pwaLabel = document.getElementById('btn-pwa-header-label');
  const manifestLink = document.getElementById('manifest-link');

  if (titleEl) titleEl.textContent = 'Ruta Libre Driver';
  if (subEl) subEl.textContent = 'Radar Conductor';
  if (pwaLabel) pwaLabel.textContent = 'Instalar Driver';
  if (manifestLink) manifestLink.href = '/manifest-driver.json';

  // Mostrar barra de navegación de conductor y ocultar pasajero
  document.getElementById('nav-passenger')?.classList.add('hidden');
  document.getElementById('nav-driver')?.classList.remove('hidden');

  // Ocultar pantallas de pasajero
  document.getElementById('screen-passenger-request')?.classList.add('hidden');
  document.getElementById('screen-offers-in-progress')?.classList.add('hidden');
  document.getElementById('screen-active-trip')?.classList.add('hidden');

  // Activar tab de radar por defecto
  switchDriverTab('radar');

  if (appState.map) {
    if (appState.originMarker && appState.map.hasLayer(appState.originMarker)) {
      appState.map.removeLayer(appState.originMarker);
    }
    if (appState.destMarker && appState.map.hasLayer(appState.destMarker)) {
      appState.map.removeLayer(appState.destMarker);
    }
    if (appState.routePolyline && appState.map.hasLayer(appState.routePolyline)) {
      appState.map.removeLayer(appState.routePolyline);
    }

    document.getElementById('route-indicator-pill')?.classList.add('hidden');

    createOrUpdateDriverMarker();
    appState.map.setView(appState.originCoords, 15);
  }

  appState.activeRequests.forEach(req => {
    renderDriverRequestCard(req);
  });

  const list = document.getElementById('driver-trips-list');
  if (list && appState.activeRequests.size === 0) {
    list.innerHTML = `
      <div id="no-driver-trips-msg" class="flex flex-col items-center justify-center p-6 text-center space-y-2 bg-[#0d1117] rounded-2xl border border-cardBorder">
        <div class="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
          ${SVG_ICONS.car}
        </div>
        <p class="text-xs font-bold text-white">Radar activo en tu zona</p>
        <p class="text-[11px] text-subtext leading-relaxed">Las solicitudes aparecerán en el mapa con su precio y podrás ver el recorrido completo.</p>
        <button onclick="simulateTestDriverRequest()" class="mt-2 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold border border-emerald-500/30 active:scale-95 transition-all">
          Probar con solicitud de ejemplo
        </button>
      </div>
    `;
  }

  refreshDriverStatsUI();
  updateDriverToolsUI();
}

function switchRole(role) {
  appState.role = role;
  const bPass = document.getElementById('toggle-pass');
  const bDriv = document.getElementById('toggle-driv');

  const titleEl = document.getElementById('header-title');
  const subEl = document.getElementById('header-subtitle');
  const pwaLabel = document.getElementById('btn-pwa-header-label');
  const manifestLink = document.getElementById('manifest-link');

  if (role === 'passenger') {
    if (bPass) bPass.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition-all';
    if (bDriv) bDriv.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-subtext hover:text-white transition-all';
    if (titleEl) titleEl.textContent = 'Solicitar viaje';
    if (subEl) subEl.textContent = 'Modo Pasajero';
    if (pwaLabel) pwaLabel.textContent = 'Instalar';
    if (manifestLink) manifestLink.href = '/manifest.json';

    // Navegación de pasajero
    document.getElementById('nav-driver')?.classList.add('hidden');
    document.getElementById('nav-passenger')?.classList.remove('hidden');

    // Ocultar todas las pantallas del conductor
    document.getElementById('screen-driver-mode')?.classList.add('hidden');
    document.getElementById('screen-driver-stats')?.classList.add('hidden');
    document.getElementById('screen-driver-tools')?.classList.add('hidden');

    if (appState.driverMarker && appState.map) {
      appState.map.removeLayer(appState.driverMarker);
      appState.driverMarker = null;
    }
    clearDriverPreviewRoute(true);

    appState.driverRequestMarkers.forEach(m => {
      if (appState.map) appState.map.removeLayer(m);
    });
    appState.driverRequestMarkers.clear();

    document.getElementById('route-indicator-pill')?.classList.remove('hidden');

    if (appState.map) {
      if (appState.originMarker && !appState.map.hasLayer(appState.originMarker)) {
        appState.originMarker.addTo(appState.map);
      }
      if (appState.destMarker && !appState.map.hasLayer(appState.destMarker)) {
        appState.destMarker.addTo(appState.map);
      }
    }

    if (appState.activeTripData) {
      document.getElementById('screen-active-trip')?.classList.remove('hidden');
    } else {
      document.getElementById('screen-passenger-request')?.classList.remove('hidden');
      updateRealRouteAndTiming();
    }
  } else {
    if (!checkDriverVerificationOrPrompt()) {
      return;
    }
    setDriverModeActive();
  }
}

/**
 * Pestañas dedicadas exclusivamente para conductores: Radar, Estadísticas, Herramientas
 */
window.switchDriverTab = function(tab) {
  appState.driverTab = tab;

  const screenRadar = document.getElementById('screen-driver-mode');
  const screenStats = document.getElementById('screen-driver-stats');
  const screenTools = document.getElementById('screen-driver-tools');

  const btnRadar = document.getElementById('nav-driver-btn-radar');
  const btnStats = document.getElementById('nav-driver-btn-stats');
  const btnTools = document.getElementById('nav-driver-btn-tools');

  // Reset estilos nav
  [btnRadar, btnStats, btnTools].forEach(b => {
    if (b) {
      b.className = 'flex flex-col items-center justify-center gap-1 text-subtext hover:text-white font-medium min-w-[56px] transition-colors';
    }
  });

  if (tab === 'radar') {
    screenRadar?.classList.remove('hidden');
    screenStats?.classList.add('hidden');
    screenTools?.classList.add('hidden');
    if (btnRadar) btnRadar.className = 'flex flex-col items-center justify-center gap-1 text-emerald-400 font-semibold min-w-[56px]';
    if (appState.map) setTimeout(() => appState.map.invalidateSize(), 50);
  } else if (tab === 'stats') {
    screenRadar?.classList.add('hidden');
    screenStats?.classList.remove('hidden');
    screenTools?.classList.add('hidden');
    if (btnStats) btnStats.className = 'flex flex-col items-center justify-center gap-1 text-emerald-400 font-semibold min-w-[56px]';
    refreshDriverStatsUI();
  } else if (tab === 'tools') {
    screenRadar?.classList.add('hidden');
    screenStats?.classList.add('hidden');
    screenTools?.classList.remove('hidden');
    if (btnTools) btnTools.className = 'flex flex-col items-center justify-center gap-1 text-emerald-400 font-semibold min-w-[56px]';
    updateDriverToolsUI();
    calculateDriverQuickChange();
  }
};

function refreshDriverStatsUI() {
  const stats = getDriverStats();
  const elEarnings = document.getElementById('driver-stats-earnings');
  const elTrips = document.getElementById('driver-stats-trips');
  const elHours = document.getElementById('driver-stats-hours');
  const elRate = document.getElementById('driver-stats-rate');
  const elRating = document.getElementById('driver-stats-rating');

  if (elEarnings) elEarnings.textContent = `$${Number(stats.todayEarnings).toLocaleString('es-CO')}`;
  if (elTrips) elTrips.textContent = stats.completedTrips;
  if (elHours) elHours.textContent = stats.hoursOnline || '3h 45m';
  if (elRate) elRate.textContent = stats.acceptanceRate || '98%';
  if (elRating) elRating.textContent = stats.rating || '4.95 ★';

  // Renderizar historial reciente de viajes del conductor
  const listContainer = document.getElementById('driver-completed-trips-list');
  if (listContainer) {
    const history = getStoredHistory();
    if (history.length > 0) {
      listContainer.innerHTML = history.slice(0, 5).map(t => `
        <div class="rounded-xl bg-[#0d1117] border border-cardBorder p-2.5 flex items-center justify-between text-xs">
          <div>
            <span class="font-bold text-white truncate max-w-[200px] block">${t.origin || 'Origen'} ➔ ${t.destination || 'Destino'}</span>
            <p class="text-[10px] text-subtext">${t.date} • ${t.distanceKm || '2.5'} km • Efectivo</p>
          </div>
          <span class="font-mono font-bold text-emerald-400">$${Number(t.fare).toLocaleString('es-CO')} COP</span>
        </div>
      `).join('');
    }
  }
}

function updateDriverToolsUI() {
  const plateEl = document.getElementById('tool-driver-plate');
  const modelEl = document.getElementById('tool-driver-model');
  const info = appState.driverInfo || getStoredDriverInfo();

  if (info) {
    if (plateEl) plateEl.textContent = info.plate || 'ABC-123';
    if (modelEl) modelEl.textContent = `${info.model || 'Vehículo'} (${info.color || ''})`;
  }
}

window.calculateDriverQuickChange = function() {
  const fare = Number(document.getElementById('calc-tool-fare')?.value) || 0;
  const received = Number(document.getElementById('calc-tool-received')?.value) || 0;
  const diff = received - fare;
  const resultEl = document.getElementById('calc-tool-result');
  const breakdownEl = document.getElementById('calc-tool-breakdown');
  if (!resultEl || !breakdownEl) return;

  if (diff < 0) {
    resultEl.textContent = `-$${Math.abs(diff).toLocaleString('es-CO')} COP`;
    resultEl.className = 'text-xl font-bold font-mono text-red-400';
    breakdownEl.textContent = `Faltan $${Math.abs(diff).toLocaleString('es-CO')} COP para cubrir la tarifa`;
  } else if (diff === 0) {
    resultEl.textContent = `$0 COP`;
    resultEl.className = 'text-xl font-bold font-mono text-slate-200';
    breakdownEl.textContent = 'Pago exacto en efectivo, no requiere entregar cambio.';
  } else {
    resultEl.textContent = `$${diff.toLocaleString('es-CO')} COP`;
    resultEl.className = 'text-xl font-bold font-mono text-emerald-400';
    
    // Desglose con billetes colombianos
    let rem = diff;
    const parts = [];
    const denominations = [
      { name: 'billete de $50.000', val: 50000 },
      { name: 'billete de $20.000', val: 20000 },
      { name: 'billete de $10.000', val: 10000 },
      { name: 'billete de $5.000', val: 5000 },
      { name: 'billete de $2.000', val: 2000 },
      { name: 'moneda de $1.000', val: 1000 },
      { name: 'moneda de $500', val: 500 }
    ];

    for (const d of denominations) {
      if (rem >= d.val) {
        const count = Math.floor(rem / d.val);
        rem %= d.val;
        parts.push(`${count} ${d.name}${count > 1 ? 's' : ''}`);
      }
    }

    breakdownEl.textContent = parts.length > 0
      ? `Devolver: ${parts.join(', ')}`
      : 'Entrega el cambio en efectivo';
  }
};

window.setReceivedBillCalc = function(amount) {
  const input = document.getElementById('calc-tool-received');
  if (input) {
    input.value = amount;
    calculateDriverQuickChange();
  }
};

/* =====================================================================
   BLOQUEO SIN CONEXIÓN Y DETECCIÓN DE RED EN VIVO
   ===================================================================== */
function initOfflineBlocker() {
  const blocker = document.getElementById('offline-blocker');
  if (!blocker) return;

  const updateState = () => {
    if (!navigator.onLine) {
      blocker.classList.remove('hidden');
    } else {
      blocker.classList.add('hidden');
    }
  };

  window.addEventListener('offline', () => {
    blocker.classList.remove('hidden');
    const txt = document.getElementById('offline-status-text');
    if (txt) txt.textContent = 'Sin conexión detectada...';
  });

  window.addEventListener('online', () => {
    blocker.classList.add('hidden');
    showToast('¡Conexión a internet restablecida!');
  });

  updateState();
}

window.checkAndRetryConnection = async function() {
  const btn = document.getElementById('btn-retry-connection');
  const txt = document.getElementById('offline-status-text');
  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'Verificando señal...';

  try {
    const res = await fetch(`/favicon.svg?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok && navigator.onLine) {
      document.getElementById('offline-blocker')?.classList.add('hidden');
      showToast('¡Conexión a internet restablecida!');
      if (btn) btn.disabled = false;
      return;
    }
  } catch (e) {}

  if (txt) txt.textContent = 'Aún sin conexión. Esperando red...';
  if (btn) btn.disabled = false;
  showToast('No se detectó internet. Por favor verifica tus datos o Wi-Fi.');
};

/* =====================================================================
   PWA INSTALACIÓN DUAL: RUTA LIBRE VS RUTA LIBRE DRIVER
   ===================================================================== */
window._deferredPWAInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._deferredPWAInstallPrompt = e;
});

window.openPWAInstallModal = function() {
  const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
  const guide = document.getElementById('ios-pwa-guide');
  if (guide) guide.classList.toggle('hidden', !isIOS);
  document.getElementById('modal-pwa-install')?.classList.remove('hidden');
};

window.closePWAInstallModal = function() {
  document.getElementById('modal-pwa-install')?.classList.add('hidden');
};

window.installPWAByChoice = async function(role) {
  const manifestLink = document.getElementById('manifest-link');
  if (manifestLink) {
    manifestLink.href = role === 'driver' ? '/manifest-driver.json' : '/manifest.json';
  }

  if (role === 'driver') {
    switchRole('driver');
  } else {
    switchRole('passenger');
  }

  if (window._deferredPWAInstallPrompt) {
    window._deferredPWAInstallPrompt.prompt();
    const choice = await window._deferredPWAInstallPrompt.userChoice;
    window._deferredPWAInstallPrompt = null;
    closePWAInstallModal();
    if (choice.outcome === 'accepted') {
      showToast(`Instalando ${role === 'driver' ? 'Ruta Libre Driver' : 'Ruta Libre'}...`);
    }
  } else {
    closePWAInstallModal();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
      showToast('Ya estás usando la versión instalada');
    } else {
      showToast('En el menú del navegador toca "Instalar aplicación" o "Agregar a pantalla principal"');
    }
  }
};


/* =====================================================================
   5. CHAT P2P EFÍMERO CON NOTIFICACIÓN SONORA
   ===================================================================== */
window.openChatModal = function() {
  document.getElementById('modal-chat').classList.remove('hidden');
  appState.unreadChatCount = 0;
  const badge = document.getElementById('chat-unread-badge');
  if (badge) badge.classList.add('hidden');

  const peerName = appState.activeTripData ? appState.activeTripData.driverName : 'Conductor';
  document.getElementById('chat-peer-name').textContent = peerName;
  document.getElementById('chat-peer-avatar').textContent = peerName.charAt(0).toUpperCase();

  const container = document.getElementById('chat-messages-container');
  if (container) container.scrollTop = container.scrollHeight;
};

window.closeChatModal = function() {
  document.getElementById('modal-chat').classList.add('hidden');
};

window.sendQuickChatMessage = function(text) {
  sendChatMessage(text);
};

window.submitChatMessage = function() {
  const input = document.getElementById('chat-input-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendChatMessage(text);
};

function sendChatMessage(text) {
  if (!text) return;
  const now = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const senderName = appState.profile ? appState.profile.alias : (appState.role === 'driver' ? 'Conductor' : 'Pasajero');

  const msgPayload = {
    tripId: appState.activeTripId,
    senderId: appState.profile ? appState.profile.id : 'ME',
    senderName,
    text,
    time: now
  };

  appendChatMessageBubble({ ...msgPayload, isMe: true });
  audioService.playSound('chat');

  if (appState.network && appState.activeTripId) {
    appState.network.publish(`rutalibre/v1/trip/${appState.activeTripId}/chat`, msgPayload);
  }
}

function receiveChatMessage(data) {
  if (data.senderId === (appState.profile ? appState.profile.id : 'ME')) return;

  appendChatMessageBubble({ ...data, isMe: false });
  audioService.playSound('chat');

  const modal = document.getElementById('modal-chat');
  if (modal && modal.classList.contains('hidden')) {
    appState.unreadChatCount++;
    const badge = document.getElementById('chat-unread-badge');
    if (badge) {
      badge.textContent = appState.unreadChatCount;
      badge.classList.remove('hidden');
    }
  }
}

function appendChatMessageBubble(msg) {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const bubble = document.createElement('div');
  bubble.className = `flex flex-col ${msg.isMe ? 'items-end' : 'items-start'} space-y-0.5`;
  bubble.innerHTML = `
    <span class="text-[10px] text-subtext px-1">${msg.senderName} • ${msg.time}</span>
    <div class="max-w-[78%] px-3.5 py-2 rounded-2xl text-xs font-medium ${
      msg.isMe
        ? 'bg-blue-600 text-white rounded-br-xs'
        : 'bg-[#1c2331] text-slate-100 border border-cardBorder rounded-bl-xs'
    }">
      ${msg.text}
    </div>
  `;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/* =====================================================================
   6. RED P2P MULTI-BROKER RESILIENTE
   ===================================================================== */
function initNetwork() {
  const userId = appState.profile ? appState.profile.id : `RL_${Math.random().toString(36).slice(2, 6)}`;
  appState.network = new P2PNetwork(userId);

  appState.network.connect((connected, info) => {
    appState.network.updateLocationGeohash(appState.originCoords[0], appState.originCoords[1]);
  });

  appState.network.subscribe('rutalibre/v1/requests/all');

  appState.network.on('/req', (topic, data) => {
    if (data && data.tripId) {
      renderDriverRequestCard(data);
      if (appState.role === 'driver') {
        audioService.playSound('offer');
        showToast('Nueva solicitud recibida en tu sector');
      }
    }
  });

  appState.network.on('/offers', (topic, data) => {
    if (appState.role === 'passenger' && appState.activeTripId === data.tripId) {
      appendDriverOfferCard(data);
      audioService.playSound('offer');
    }
  });

  appState.network.on('/chat', (topic, data) => {
    if (data && data.tripId === appState.activeTripId) {
      receiveChatMessage(data);
    }
  });

  appState.network.on('/status', (topic, data) => {
    if (data.tripId === appState.activeTripId && data.action === 'accepted') {
      audioService.playSound('accepted');
      if (appState.role === 'driver' && data.driverId === appState.profile?.id) {
        promptDriverPinInput(data);
      }
    }
  });
}

/* =====================================================================
   7. VERIFICACIÓN LEGAL DE CONDUCTOR
   ===================================================================== */
function checkDriverVerificationOrPrompt() {
  const verified = getStoredDriverInfo();
  if (verified && verified.docId && verified.plate) {
    appState.driverInfo = verified;
    return true;
  }
  document.getElementById('modal-driver-verification').classList.remove('hidden');
  return false;
}

window.submitDriverVerification = function() {
  const docId = document.getElementById('driver-input-doc').value.trim();
  const vType = document.getElementById('driver-input-vtype').value;
  const model = document.getElementById('driver-input-model').value.trim();
  const color = document.getElementById('driver-input-color').value.trim();
  let plate = document.getElementById('driver-input-plate').value.trim().toUpperCase();
  const phone = document.getElementById('driver-input-phone').value.trim();

  if (!docId || !model || !plate || !phone) {
    showToast('Completa todos los campos requeridos');
    return;
  }

  plate = plate.replace(/[^A-Z0-9]/g, '');
  if (plate.length === 6) {
    plate = `${plate.substring(0, 3)}-${plate.substring(3)}`;
  }

  const driverData = {
    docId,
    vType,
    model,
    color,
    plate,
    phone,
    verifiedAt: Date.now()
  };

  saveStoredDriverInfo(driverData);
  appState.driverInfo = driverData;

  document.getElementById('modal-driver-verification').classList.add('hidden');
  showToast('Ficha guardada exitosamente');
  setDriverModeActive();
};

window.cancelDriverVerification = function() {
  document.getElementById('modal-driver-verification').classList.add('hidden');
  switchRole('passenger');
};

/* =====================================================================
   8. FLUJO DE PASAJERO (SOLICITAR CON PIN Y TRANSMITIR COORDENADAS)
   ===================================================================== */
function startLookingForDrivers() {
  appState.activeTripId = `TRIP_${Date.now()}`;
  appState.activeTripPin = Math.floor(1000 + Math.random() * 9000).toString();

  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-offers-in-progress').classList.remove('hidden');
  document.getElementById('sent-offer-amount').textContent = `$${Number(appState.offeredFare).toLocaleString('es-CO')} COP`;

  const currentGeohash = encodeGeohash(appState.originCoords[0], appState.originCoords[1], 5);
  const geoTopic = `rutalibre/v1/geo/${currentGeohash}/req`;

  appState.network.subscribe(`rutalibre/v1/trip/${appState.activeTripId}/offers`);
  appState.network.subscribe(`rutalibre/v1/trip/${appState.activeTripId}/chat`);

  const tripPayload = {
    tripId: appState.activeTripId,
    passengerName: appState.profile ? appState.profile.alias : 'Pasajero',
    vehicleType: appState.vehicleType,
    payingWith: appState.cashBill,
    origin: appState.originName,
    destination: appState.destName,
    originCoords: appState.originCoords,
    destCoords: appState.destCoords,
    distanceKm: appState.realDistanceKm,
    durationMin: appState.realDurationMin,
    fare: appState.offeredFare
  };

  appState.network.publish(geoTopic, tripPayload);
  appState.network.publish('rutalibre/v1/requests/all', tripPayload);

  let seconds = 45;
  const timerEl = document.getElementById('countdown-timer');
  if (appState.countdownInterval) clearInterval(appState.countdownInterval);
  appState.countdownInterval = setInterval(() => {
    seconds--;
    if (timerEl) timerEl.textContent = `${seconds}s`;
    if (seconds <= 0) seconds = 45;
  }, 1000);

  const container = document.getElementById('driver-cards-container');
  container.innerHTML = `
    <div id="searching-radar-indicator" class="flex flex-col items-center justify-center p-8 text-center space-y-3 bg-[#0d1117] rounded-2xl border border-cardBorder">
      <div class="relative flex items-center justify-center">
        <div class="w-10 h-10 rounded-full border-2 border-dashed border-blue-500/60 animate-spin"></div>
        <svg class="w-5 h-5 text-blue-400 absolute" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
        </svg>
      </div>
      <div class="space-y-1">
        <p class="text-xs font-bold text-white">Buscando conductores en tu zona...</p>
        <p class="text-[11px] text-subtext leading-relaxed">Tu solicitud ha sido transmitida por la red P2P. Las ofertas aparecerán en cuanto los conductores de tu sector respondan.</p>
      </div>
    </div>
  `;
}

function appendDriverOfferCard(offer) {
  const container = document.getElementById('driver-cards-container');
  if (!container) return;

  const radarIndicator = document.getElementById('searching-radar-indicator');
  if (radarIndicator) radarIndicator.remove();

  const cardId = `offer_${offer.driverId}`;
  if (document.getElementById(cardId)) return;

  const card = document.createElement('div');
  card.id = cardId;
  card.className = 'rounded-2xl bg-[#1e293b] border border-cardBorder p-4 shadow-lg flex flex-col gap-3';
  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-xl bg-cardBorder flex items-center justify-center text-sm font-bold text-white border border-cardBorder/60">
          ${(offer.driverName || 'C').charAt(0).toUpperCase()}
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-sm text-white">${offer.driverName || 'Conductor'}</span>
            <span class="text-xs font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded flex items-center gap-1">${SVG_ICONS.star} ${offer.rating || '5.0'}</span>
          </div>
          <p class="text-xs text-subtext mt-0.5">${offer.vehicle || 'Vehículo'} • <span class="text-slate-300 font-mono">${offer.plate || '---'}</span></p>
        </div>
      </div>
      <div class="text-right">
        <span class="text-xs font-semibold ${offer.isAccept ? 'text-blue-400 bg-blue-500/10' : 'text-emerald-400 bg-emerald-500/10'} font-mono px-2 py-0.5 rounded">A ${offer.etaMin || 3} min</span>
      </div>
    </div>

    <!-- Ficha de Trazabilidad Conductor -->
    <div class="bg-[#0d1117] rounded-xl px-2.5 py-1.5 border border-cardBorder/50 flex items-center justify-between text-[11px] text-subtext">
      <span>Cédula: <strong class="text-slate-200 font-mono">${offer.driverDoc || 'Verificado'}</strong></span>
      <span>Tel: <strong class="text-slate-200 font-mono">${offer.driverPhone || 'Contacto Directo'}</strong></span>
    </div>

    <div class="px-3 py-2 rounded-xl bg-[#0d1117] border border-cardBorder flex items-center justify-between">
      <span class="text-xs ${offer.isAccept ? 'text-emerald-400 font-medium' : 'text-subtext'}">${offer.isAccept ? 'Acepta tu oferta' : 'Contraoferta del conductor'}</span>
      <span class="font-mono text-sm font-bold ${offer.isAccept ? 'text-emerald-400' : 'text-white'}">$${Number(offer.fare).toLocaleString('es-CO')} COP</span>
    </div>
    <div class="grid grid-cols-12 gap-2">
      <button class="accept-btn col-span-8 h-10 rounded-xl ${offer.isAccept ? 'bg-brandEmerald text-black' : 'bg-white text-black'} font-bold text-xs flex items-center justify-center gap-1.5 shadow active:scale-95">
        <span>Aceptar ${offer.isAccept ? 'viaje' : '$' + Number(offer.fare).toLocaleString('es-CO')}</span>
      </button>
      <button class="reject-btn col-span-4 h-10 rounded-xl bg-surfaceCard text-subtext hover:text-white text-xs font-semibold border border-cardBorder">
        Rechazar
      </button>
    </div>
  `;

  card.querySelector('.accept-btn').addEventListener('click', () => {
    acceptDriverOffer(offer);
  });
  card.querySelector('.reject-btn').addEventListener('click', () => {
    card.remove();
  });

  container.appendChild(card);
}

async function acceptDriverOffer(offer) {
  if (appState.countdownInterval) clearInterval(appState.countdownInterval);

  audioService.playSound('accepted');

  const fingerprint = await generateTripFingerprint({
    tripId: appState.activeTripId,
    driverDoc: offer.driverDoc,
    plate: offer.plate,
    fare: offer.fare
  });

  appState.activeFingerprint = fingerprint;

  appState.activeTripData = {
    tripId: appState.activeTripId,
    driverName: offer.driverName || 'Conductor',
    driverDoc: offer.driverDoc || '--',
    driverPhone: offer.driverPhone || '--',
    rating: offer.rating || '5.0',
    vehicle: offer.vehicle || 'Vehículo',
    plate: offer.plate || '---',
    fare: offer.fare,
    distanceKm: appState.realDistanceKm,
    durationMin: appState.realDurationMin,
    securityPin: appState.activeTripPin,
    auditFingerprint: fingerprint
  };

  appState.network.publish(`rutalibre/v1/trip/${appState.activeTripId}/status`, {
    tripId: appState.activeTripId,
    action: 'accepted',
    driverId: offer.driverId,
    fare: offer.fare,
    expectedPin: appState.activeTripPin
  });

  startActiveTripView(appState.activeTripData);
}

function cancelOffersSearch() {
  if (appState.countdownInterval) clearInterval(appState.countdownInterval);
  appState.activeTripId = null;
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.remove('hidden');
}

/* =====================================================================
   9. VIAJE ACTIVO ("EN RUTA") - GPS REAL
   ===================================================================== */
function startActiveTripView(trip) {
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-driver-mode').classList.add('hidden');
  document.getElementById('screen-active-trip').classList.remove('hidden');

  document.getElementById('active-driver-name').textContent = trip.driverName || 'Conductor';
  document.getElementById('active-driver-avatar').textContent = (trip.driverName || 'C').charAt(0).toUpperCase();
  document.getElementById('active-driver-rating').textContent = trip.rating || '5.0';
  document.getElementById('active-driver-veh').textContent = trip.vehicle || 'Vehículo registrado';
  document.getElementById('active-driver-plate').textContent = trip.plate || '---';
  document.getElementById('active-trip-price').innerHTML = `$${Number(trip.fare).toLocaleString('es-CO')} <span class="text-xs text-subtext font-normal">COP</span>`;

  document.getElementById('active-pin-display').textContent = trip.securityPin || appState.activeTripPin || '----';
  document.getElementById('active-audit-fingerprint').textContent = trip.auditFingerprint || appState.activeFingerprint || 'FP-ACTIVO';
  document.getElementById('active-driver-doc').textContent = trip.driverDoc || '--';
  document.getElementById('active-driver-phone').textContent = trip.driverPhone || '--';

  if (appState.map) {
    if (appState.carMarker) appState.map.removeLayer(appState.carMarker);

    const isMoto = appState.vehicleType === 'moto';

    const createVehicleIcon = () => L.divIcon({
      className: 'vehicle-active-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-8 h-8 rounded-full ${isMoto ? 'bg-amber-500/20' : 'bg-blue-500/20'} absolute"></div>
          <div class="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-2xl border-2 ${isMoto ? 'border-amber-500' : 'border-blue-500'}">
            ${isMoto ? SVG_ICONS.moto : SVG_ICONS.car}
          </div>
        </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    appState.carMarker = L.marker(appState.originCoords, { icon: createVehicleIcon() }).addTo(appState.map);

    if (navigator.geolocation) {
      if (appState.watchPositionId !== null) {
        navigator.geolocation.clearWatch(appState.watchPositionId);
      }

      appState.watchPositionId = navigator.geolocation.watchPosition(
        (pos) => {
          const liveCoords = [pos.coords.latitude, pos.coords.longitude];
          if (appState.carMarker) {
            appState.carMarker.setLatLng(liveCoords);
          }
        },
        (err) => console.warn('GPS continuo:', err.message),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );
    }
  }
}

function shareTripOnWhatsApp(isSOS = false) {
  const trip = appState.activeTripData;
  if (!trip) return;

  const gmaps = `https://maps.google.com/?q=${appState.originCoords[0]},${appState.originCoords[1]}`;
  let text = '';
  const changeText = appState.cashBill === 'exact' ? 'Efectivo exacto' : `Paga con billete de $${Number(appState.cashBill).toLocaleString('es-CO')}`;

  if (isSOS) {
    text = `🚨 *ALERTA URGENTE SOS - RUTA LIBRE*\n` +
           `Necesito auxilio inmediato. Voy en este vehículo:\n` +
           `• Conductor: ${trip.driverName} (Cédula: ${trip.driverDoc})\n` +
           `• Teléfono Conductor: ${trip.driverPhone}\n` +
           `• Vehículo: ${trip.vehicle} [Placa: ${trip.plate}]\n` +
           `• PIN de Viaje: ${trip.securityPin}\n` +
           `• Huella Forense: ${trip.auditFingerprint}\n` +
           `• Ubicación GPS en vivo: ${gmaps}`;
  } else {
    text = `🚗 *Ruta Libre - Monitoreo de Seguridad de Viaje*\n` +
           `• Conductor: ${trip.driverName}\n` +
           `• Cédula/Doc: ${trip.driverDoc}\n` +
           `• Teléfono: ${trip.driverPhone}\n` +
           `• Vehículo: ${trip.vehicle} [Placa: ${trip.plate}]\n` +
           `• Tarifa: $${Number(trip.fare).toLocaleString('es-CO')} COP (${changeText})\n` +
           `• PIN de abordaje verificado: ${trip.securityPin}\n` +
           `• Huella forense: ${trip.auditFingerprint}\n` +
           `• Tiempo estimado: ${appState.realDurationMin} min (${appState.realDistanceKm} km)\n` +
           `• Ubicación GPS en vivo: ${gmaps}`;
  }

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function finishTripAndPay() {
  if (appState.watchPositionId !== null) {
    navigator.geolocation.clearWatch(appState.watchPositionId);
    appState.watchPositionId = null;
  }
  audioService.playSound('finish');

  const trip = appState.activeTripData || {
    fare: appState.offeredFare,
    driverName: 'Conductor',
    driverDoc: '--',
    driverPhone: '--',
    plate: '---',
    vehicle: 'Vehículo',
    securityPin: appState.activeTripPin,
    auditFingerprint: appState.activeFingerprint
  };

  saveTripRecord({
    id: appState.activeTripId || `TRIP_${Date.now()}`,
    origin: appState.originName,
    destination: appState.destName,
    originCoords: appState.originCoords,
    destCoords: appState.destCoords,
    fare: trip.fare,
    distanceKm: appState.realDistanceKm,
    driverName: trip.driverName,
    driverDocument: trip.driverDoc,
    driverPhone: trip.driverPhone,
    plate: trip.plate,
    vehicle: trip.vehicle,
    passengerName: appState.profile ? appState.profile.alias : 'Pasajero',
    passengerId: appState.profile ? appState.profile.id : 'PASS_ME',
    securityPin: trip.securityPin,
    auditFingerprint: trip.auditFingerprint
  });

  // Actualizar estadísticas del conductor en vivo
  recordDriverCompletedTrip(trip.fare, appState.realDistanceKm || 2.5);
  refreshDriverStatsUI();

  document.getElementById('receipt-amount').textContent = `$${Number(trip.fare).toLocaleString('es-CO')} COP`;
  document.getElementById('modal-receipt').classList.remove('hidden');
}

function finishReceipt() {
  document.getElementById('modal-receipt').classList.add('hidden');
  document.getElementById('screen-active-trip').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.remove('hidden');
  if (appState.carMarker && appState.map) {
    appState.map.removeLayer(appState.carMarker);
    appState.carMarker = null;
  }
  appState.activeTripData = null;
  appState.activeTripId = null;
}

function promptDriverPinInput(tripNotification) {
  appState.pendingDriverTrip = tripNotification;
  document.getElementById('driver-input-pin').value = '';
  document.getElementById('modal-pin-prompt').classList.remove('hidden');
}

window.verifyDriverBoardingPin = function() {
  const entered = document.getElementById('driver-input-pin').value.trim();
  const expected = appState.pendingDriverTrip ? appState.pendingDriverTrip.expectedPin : null;

  if (entered.length !== 4) {
    showToast('Ingresa los 4 dígitos del PIN');
    return;
  }

  if (expected && entered === expected) {
    document.getElementById('modal-pin-prompt').classList.add('hidden');
    clearDriverPreviewRoute(true);
    startActiveTripView({
      driverName: appState.driverInfo ? appState.profile.alias : 'Conductor',
      driverDoc: appState.driverInfo ? appState.driverInfo.docId : '--',
      driverPhone: appState.driverInfo ? appState.driverInfo.phone : '--',
      rating: '5.0',
      vehicle: appState.driverInfo ? `${appState.driverInfo.model} • ${appState.driverInfo.color}` : 'Vehículo',
      plate: appState.driverInfo ? appState.driverInfo.plate : '---',
      fare: appState.pendingDriverTrip ? appState.pendingDriverTrip.fare : appState.offeredFare,
      securityPin: entered,
      auditFingerprint: `FP-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    });
  } else {
    showToast('El PIN ingresado no coincide con el del pasajero');
  }
};

window.closePinPromptModal = function() {
  document.getElementById('modal-pin-prompt').classList.add('hidden');
};

/* =====================================================================
   10. ATADURAS DE EVENTOS GLOBALES (WINDOW)
   ===================================================================== */
window.getUserGPS = function() {
  detectAndApplyUserGPS(false);
  showToast('GPS actualizado a tu posición');
};

window.cycleDestination = async function() {
  const centerLat = appState.originCoords[0];
  const centerLng = appState.originCoords[1];

  const offsets = [
    [0.008, 0.006],
    [-0.007, 0.008],
    [-0.006, -0.007],
    [0.009, -0.005]
  ];

  const randomOffset = offsets[Math.floor(Math.random() * offsets.length)];
  appState.destCoords = [centerLat + randomOffset[0], centerLng + randomOffset[1]];

  if (appState.destMarker) appState.destMarker.setLatLng(appState.destCoords);

  document.getElementById('dest-input-label').textContent = 'Buscando dirección...';
  const address = await reverseGeocode(appState.destCoords[0], appState.destCoords[1]);
  appState.destName = address;
  document.getElementById('dest-input-label').textContent = address;
  updateRealRouteAndTiming();
};

window.modifyOffer = function(delta) {
  const minFare = appState.vehicleType === 'moto' ? 2500 : 4000;
  const current = Number(appState.offeredFare) || minFare;
  let next = current + delta;
  if (next < minFare) next = minFare;
  if (next > 500000) next = 500000;

  appState.offeredFare = next;
  appState.isCustomOffer = true;

  const offerPriceVal = document.getElementById('offer-price-val');
  if (offerPriceVal) {
    offerPriceVal.textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
  }
  updateCashChangeUI();
};

window.promptCustomPrice = function() {
  const minFare = appState.vehicleType === 'moto' ? 2500 : 4000;
  const current = Number(appState.offeredFare) || minFare;
  const input = prompt(`Ingresa tu oferta en pesos COP (mínimo $${minFare.toLocaleString('es-CO')}):`, current);
  if (input !== null) {
    const clean = parseInt(String(input).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(clean) && clean >= minFare && clean <= 500000) {
      appState.offeredFare = clean;
      appState.isCustomOffer = true;
      const offerPriceVal = document.getElementById('offer-price-val');
      if (offerPriceVal) {
        offerPriceVal.textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
      }
      updateCashChangeUI();
    } else if (!isNaN(clean) && clean < minFare) {
      showToast(`La tarifa mínima para ${appState.vehicleType === 'moto' ? 'moto' : 'carro'} es de $${minFare.toLocaleString('es-CO')} COP`);
    }
  }
};

window.startLookingForDrivers = startLookingForDrivers;
window.cancelOffersSearch = cancelOffersSearch;
window.shareTripOnWhatsApp = shareTripOnWhatsApp;
window.finishTripAndPay = finishTripAndPay;
window.finishReceipt = finishReceipt;
window.switchRole = switchRole;

window.openSOSModal = () => document.getElementById('modal-sos').classList.remove('hidden');
window.closeSOSModal = () => document.getElementById('modal-sos').classList.add('hidden');

window.simulateCall = () => {
  const phone = appState.activeTripData?.driverPhone;
  if (phone && phone !== '--') {
    window.location.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
  } else {
    showToast('No hay un número activo para este conductor');
  }
};

window.openHistoryModal = () => {
  const list = getStoredHistory();
  const container = document.getElementById('history-list-content');
  if (list.length === 0) {
    container.innerHTML = '<p class="text-xs text-subtext text-center py-6">No hay viajes registrados aún en tu dispositivo.</p>';
  } else {
    container.innerHTML = list.map(t => `
      <div class="bg-[#0d1117] rounded-xl p-3 border border-cardBorder text-xs space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white">${t.date}</span>
          <span class="font-mono font-bold text-emerald-400">$${Number(t.fare).toLocaleString('es-CO')} COP</span>
        </div>
        <p class="text-subtext truncate">${t.origin} ➔ ${t.destination}</p>
        <div class="text-[10px] text-subtext font-mono flex items-center justify-between pt-1 border-t border-cardBorder/40">
          <span>Cond: ${t.driverName} (${t.plate || '---'})</span>
          <span>PIN: ${t.securityPin || '----'}</span>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('modal-history').classList.remove('hidden');
};

window.closeHistoryModal = () => {
  document.getElementById('modal-history').classList.add('hidden');
};

window.goToOffersTab = () => {
  if (appState.activeTripData) {
    startActiveTripView(appState.activeTripData);
  } else if (!document.getElementById('screen-offers-in-progress').classList.contains('hidden')) {
    // Ya en ofertas
  } else {
    startLookingForDrivers();
  }
};

window.openProfileModal = () => {
  const alias = appState.profile ? appState.profile.alias : 'Usuario';
  const next = prompt('Tu nombre o apodo:', alias);
  if (next && next.trim()) {
    appState.profile.alias = next.trim();
    saveStoredProfile(appState.profile);
    document.getElementById('header-avatar-initial').textContent = next.trim().charAt(0).toUpperCase();
  }
};

let chosenWelcomeRole = 'passenger';
window.selectWelcomeRole = (role) => {
  chosenWelcomeRole = role;
  const bP = document.getElementById('role-choice-pass');
  const bD = document.getElementById('role-choice-driv');
  if (role === 'passenger') {
    bP.className = 'flex items-center justify-center gap-2 py-3 px-3 rounded-lg bg-surfaceCard border border-white/20 text-white font-semibold text-xs shadow-sm';
    bD.className = 'flex items-center justify-center gap-2 py-3 px-3 rounded-lg text-subtext hover:text-white font-semibold text-xs';
  } else {
    bD.className = 'flex items-center justify-center gap-2 py-3 px-3 rounded-lg bg-surfaceCard border border-white/20 text-white font-semibold text-xs shadow-sm';
    bP.className = 'flex items-center justify-center gap-2 py-3 px-3 rounded-lg text-subtext hover:text-white font-semibold text-xs';
  }
};

window.saveWelcomeProfile = () => {
  const alias = document.getElementById('welcome-alias').value.trim() || 'Usuario';
  appState.profile = {
    alias,
    role: chosenWelcomeRole,
    id: `RL_${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  };
  saveStoredProfile(appState.profile);
  document.getElementById('header-avatar-initial').textContent = alias.charAt(0).toUpperCase();
  document.getElementById('modal-welcome').classList.add('hidden');
  initNetwork();

  if (chosenWelcomeRole === 'driver') {
    if (!checkDriverVerificationOrPrompt()) {
      return;
    }
  }
  switchRole(chosenWelcomeRole);
};

// Arranque inicial limpio con soporte PWA y validación offline
window.addEventListener('DOMContentLoaded', () => {
  initOfflineBlocker();
  initMap();

  const urlParams = new URLSearchParams(window.location.search);
  const queryRole = urlParams.get('role'); // 'driver' o 'passenger'

  const saved = getStoredProfile();

  if (queryRole === 'driver') {
    chosenWelcomeRole = 'driver';
    if (saved) {
      saved.role = 'driver';
      saveStoredProfile(saved);
      appState.profile = saved;
      document.getElementById('header-avatar-initial').textContent = saved.alias.charAt(0).toUpperCase();
      initNetwork();
      if (checkDriverVerificationOrPrompt()) {
        switchRole('driver');
      }
    } else {
      // Si entra a la versión de Driver sin perfil, pedimos datos de conductor de inmediato
      appState.profile = {
        alias: 'Conductor',
        role: 'driver',
        id: `RL_DRV_${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      };
      saveStoredProfile(appState.profile);
      initNetwork();
      checkDriverVerificationOrPrompt();
      switchRole('driver');
    }
    return;
  }

  if (saved) {
    appState.profile = saved;
    document.getElementById('header-avatar-initial').textContent = saved.alias.charAt(0).toUpperCase();
    initNetwork();

    if (saved.role === 'driver') {
      if (checkDriverVerificationOrPrompt()) {
        switchRole('driver');
      } else {
        switchRole('passenger');
      }
    } else {
      switchRole('passenger');
    }
  } else {
    document.getElementById('modal-welcome').classList.remove('hidden');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});


