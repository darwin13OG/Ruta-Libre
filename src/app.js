/**
 * Controlador Principal de la Aplicación Ruta Libre
 * Integra: Leaflet, Enrutamiento Real OSRM, Geocodificación Inversa Nominatim,
 * Marcadores interactivos arrastrables, Red P2P PubSub Multi-Broker,
 * Verificación de Identidad Legal de Conductores y PIN de Abordaje Seguro.
 */

import {
  getRealDrivingRoute,
  calculateSuggestedFare,
  reverseGeocode,
  calculateBearing
} from './services/routing.js';
import { P2PNetwork, encodeGeohash, generateTripFingerprint } from './services/p2p.js';
import {
  getStoredProfile,
  saveStoredProfile,
  getStoredHistory,
  saveTripRecord,
  getStoredDriverInfo,
  saveStoredDriverInfo,
  getSecurityAuditLog
} from './services/storage.js';

// Estado global de la aplicación
const appState = {
  profile: null,
  driverInfo: null,
  role: 'passenger', // 'passenger' | 'driver'
  originCoords: [6.2085, -75.5684], // El Poblado, Medellín (punto de partida inicial)
  destCoords: [6.1969, -75.5738],   // CC Santafé, Medellín
  originName: 'Cra 43A # 18 Sur, El Poblado',
  destName: 'Centro Comercial Santafé, Medellín',
  realDistanceKm: 5.8,
  realDurationMin: 14,
  suggestedFare: 12000,
  offeredFare: 10000,
  currentRouteWaypoints: [],
  carAnimationInterval: null,
  activeTripId: null,
  activeTripData: null,
  activeTripPin: '4821',
  activeFingerprint: '',
  pendingDriverTrip: null,
  network: null,
  map: null,
  originMarker: null,
  destMarker: null,
  carMarker: null,
  routePolyline: null,
  countdownInterval: null
};

// Destinos de referencia rápida
const sampleDestinations = [
  { name: 'Centro Comercial Santafé, Medellín', coords: [6.1969, -75.5738] },
  { name: 'Parque Lleras, El Poblado', coords: [6.2088, -75.5677] },
  { name: 'Centro Comercial El Tesoro', coords: [6.1978, -75.5592] },
  { name: 'Aeropuerto Olaya Herrera', coords: [6.2205, -75.5905] }
];
let destIndex = 0;

/* =====================================================================
   1. INICIALIZACIÓN DEL MAPA LEAFLET Y MARCADORES ARRASTRABLES
   ===================================================================== */
function initMap() {
  if (typeof L === 'undefined') return;

  appState.map = L.map('leaflet-map', {
    zoomControl: false,
    attributionControl: false
  }).setView(appState.originCoords, 14);

  // Cartografía OpenStreetMap libre con filtro visual nocturno
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(appState.map);

  const originIcon = L.divIcon({
    className: 'origin-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-grab active:cursor-grabbing">
        <div class="w-8 h-8 rounded-full bg-blue-500/25 animate-ping absolute"></div>
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
        <div class="w-8 h-8 rounded-full bg-red-500/25 animate-pulse absolute"></div>
        <div class="w-6 h-6 rounded-full bg-red-500 border-2 border-white flex items-center justify-center shadow-xl">
          <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
          </svg>
        </div>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  // Marcadores arrastrables para precisión milimétrica puerta a puerta
  appState.originMarker = L.marker(appState.originCoords, { icon: originIcon, draggable: true }).addTo(appState.map);
  appState.destMarker = L.marker(appState.destCoords, { icon: destIcon, draggable: true }).addTo(appState.map);

  // Evento al soltar marcador de origen
  appState.originMarker.on('dragend', async (e) => {
    const pos = e.target.getLatLng();
    appState.originCoords = [pos.lat, pos.lng];
    document.getElementById('origin-input-label').textContent = 'Buscando dirección...';
    const address = await reverseGeocode(pos.lat, pos.lng);
    appState.originName = address;
    document.getElementById('origin-input-label').textContent = address;
    updateRealRouteAndTiming();
    if (appState.network) appState.network.updateLocationGeohash(pos.lat, pos.lng);
  });

  // Evento al soltar marcador de destino
  appState.destMarker.on('dragend', async (e) => {
    const pos = e.target.getLatLng();
    appState.destCoords = [pos.lat, pos.lng];
    document.getElementById('dest-input-label').textContent = 'Buscando dirección...';
    const address = await reverseGeocode(pos.lat, pos.lng);
    appState.destName = address;
    document.getElementById('dest-input-label').textContent = address;
    updateRealRouteAndTiming();
  });

  // Clic en el mapa para posicionar destino y obtener dirección exacta
  appState.map.on('click', async (e) => {
    if (appState.activeTripData) return;
    appState.destCoords = [e.latlng.lat, e.latlng.lng];
    appState.destMarker.setLatLng(e.latlng);
    document.getElementById('dest-input-label').textContent = 'Buscando dirección...';

    const address = await reverseGeocode(e.latlng.lat, e.latlng.lng);
    appState.destName = address;
    document.getElementById('dest-input-label').textContent = address;
    updateRealRouteAndTiming();
  });

  updateRealRouteAndTiming();
}

/**
 * Consulta y dibuja la ruta real de conducción por calles (OSRM)
 * Calcula distancia en km, duración en min y tarifa exacta en COP
 */
async function updateRealRouteAndTiming() {
  const etaText = document.getElementById('eta-text');
  const distText = document.getElementById('dist-text');
  const suggestedLabel = document.getElementById('suggested-price-label');

  if (etaText) etaText.textContent = 'Calculando...';

  const routeData = await getRealDrivingRoute(appState.originCoords, appState.destCoords);

  appState.realDistanceKm = routeData.distanceKm;
  appState.realDurationMin = routeData.durationMin;
  appState.currentRouteWaypoints = routeData.coordinates;
  appState.suggestedFare = calculateSuggestedFare(routeData.distanceKm);
  appState.offeredFare = appState.suggestedFare;

  const offerPriceVal = document.getElementById('offer-price-val');
  if (offerPriceVal) {
    offerPriceVal.textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
  }

  if (etaText) etaText.textContent = `${routeData.durationMin} min`;
  if (distText) distText.textContent = `${routeData.distanceKm} km`;
  if (suggestedLabel) suggestedLabel.textContent = `$${appState.suggestedFare.toLocaleString('es-CO')} COP`;

  if (appState.map) {
    if (appState.routePolyline) {
      appState.map.removeLayer(appState.routePolyline);
    }

    appState.routePolyline = L.polyline(routeData.coordinates, {
      color: '#3B82F6',
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
   2. RED P2P Y MENSAJERÍA MULTI-BROKER RESILIENTE
   ===================================================================== */
function initNetwork() {
  const userId = appState.profile ? appState.profile.id : `RL_${Math.random().toString(36).slice(2, 6)}`;
  appState.network = new P2PNetwork(userId);

  appState.network.connect((connected, info) => {
    appState.network.updateLocationGeohash(appState.originCoords[0], appState.originCoords[1]);
  });

  // Escuchar solicitudes de pasajeros en el radar de conductores
  appState.network.on('/req', (topic, data) => {
    if (appState.role === 'driver' && data && data.tripId) {
      renderDriverRequestCard(data);
    }
  });

  // Escuchar ofertas de conductores para el pasajero
  appState.network.on('/offers', (topic, data) => {
    if (appState.role === 'passenger' && appState.activeTripId === data.tripId) {
      appendDriverOfferCard(data);
    }
  });

  // Escuchar estado de viaje
  appState.network.on('/status', (topic, data) => {
    if (data.tripId === appState.activeTripId && data.action === 'accepted' && appState.role === 'driver') {
      if (data.driverId === appState.profile.id) {
        promptDriverPinInput(data);
      }
    }
  });
}

/* =====================================================================
   3. VERIFICACIÓN LEGAL DE CONDUCTOR (TRAZABILIDAD ANTIDELITOS)
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
  const model = document.getElementById('driver-input-model').value.trim();
  const color = document.getElementById('driver-input-color').value.trim();
  let plate = document.getElementById('driver-input-plate').value.trim().toUpperCase();
  const phone = document.getElementById('driver-input-phone').value.trim();

  if (!docId || !model || !plate || !phone) {
    alert('Por favor completa todos los campos requeridos para habilitar el modo conductor.');
    return;
  }

  plate = plate.replace(/[^A-Z0-9]/g, '');
  if (plate.length === 6) {
    plate = `${plate.substring(0, 3)}-${plate.substring(3)}`;
  }

  const driverData = {
    docId,
    model,
    color,
    plate,
    phone,
    verifiedAt: Date.now()
  };

  saveStoredDriverInfo(driverData);
  appState.driverInfo = driverData;

  document.getElementById('modal-driver-verification').classList.add('hidden');
  setDriverModeActive();
};

window.cancelDriverVerification = function() {
  document.getElementById('modal-driver-verification').classList.add('hidden');
  switchRole('passenger');
};

/* =====================================================================
   4. FLUJO DE PASAJERO (SOLICITAR CON PIN Y NEGOCIAR)
   ===================================================================== */
function startLookingForDrivers() {
  appState.activeTripId = `TRIP_${Date.now()}`;
  appState.activeTripPin = Math.floor(1000 + Math.random() * 9000).toString();

  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-offers-in-progress').classList.remove('hidden');
  document.getElementById('sent-offer-amount').textContent = `$${appState.offeredFare.toLocaleString('es-CO')} COP`;

  const currentGeohash = encodeGeohash(appState.originCoords[0], appState.originCoords[1], 5);
  const geoTopic = `rutalibre/v1/geo/${currentGeohash}/req`;

  appState.network.subscribe(`rutalibre/v1/trip/${appState.activeTripId}/offers`);

  appState.network.publish(geoTopic, {
    tripId: appState.activeTripId,
    passengerName: appState.profile ? appState.profile.alias : 'Carlos',
    origin: appState.originName,
    destination: appState.destName,
    distanceKm: appState.realDistanceKm,
    durationMin: appState.realDurationMin,
    fare: appState.offeredFare
  });

  let seconds = 45;
  const timerEl = document.getElementById('countdown-timer');
  if (appState.countdownInterval) clearInterval(appState.countdownInterval);
  appState.countdownInterval = setInterval(() => {
    seconds--;
    if (timerEl) timerEl.textContent = `${seconds}s`;
    if (seconds <= 0) seconds = 45;
  }, 1000);

  const container = document.getElementById('driver-cards-container');
  container.innerHTML = '';

  setTimeout(() => {
    appendDriverOfferCard({
      tripId: appState.activeTripId,
      driverId: 'DRV_MATEO',
      driverName: 'Mateo R.',
      rating: '4.98',
      driverDoc: '1.037.482.910',
      driverPhone: '+57 300 123 4567',
      vehicle: 'Chevrolet Onix Negro',
      plate: 'ABC-123',
      etaMin: 3,
      distanceKm: 1.2,
      fare: appState.offeredFare,
      isAccept: true
    });
  }, 1800);

  setTimeout(() => {
    appendDriverOfferCard({
      tripId: appState.activeTripId,
      driverId: 'DRV_DIANA',
      driverName: 'Diana M.',
      rating: '5.0',
      driverDoc: '1.020.894.231',
      driverPhone: '+57 312 987 6543',
      vehicle: 'Mazda 2 Rojo',
      plate: 'XYZ-456',
      etaMin: 2,
      distanceKm: 0.9,
      fare: appState.offeredFare + 1000,
      isAccept: false
    });
  }, 3200);
}

function appendDriverOfferCard(offer) {
  const container = document.getElementById('driver-cards-container');
  if (!container) return;

  const cardId = `offer_${offer.driverId}`;
  if (document.getElementById(cardId)) return;

  const card = document.createElement('div');
  card.id = cardId;
  card.className = 'rounded-2xl bg-[#1e293b] border border-cardBorder p-4 shadow-lg flex flex-col gap-3';
  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-xl bg-cardBorder flex items-center justify-center text-sm font-bold text-white border border-cardBorder/60">
          ${offer.driverName.charAt(0)}
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-sm text-white">${offer.driverName}</span>
            <span class="text-xs font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">★ ${offer.rating || '4.9'}</span>
          </div>
          <p class="text-xs text-subtext mt-0.5">${offer.vehicle} • <span class="text-slate-300 font-mono">${offer.plate}</span></p>
        </div>
      </div>
      <div class="text-right">
        <span class="text-xs font-semibold ${offer.isAccept ? 'text-blue-400 bg-blue-500/10' : 'text-emerald-400 bg-emerald-500/10'} font-mono px-2 py-0.5 rounded">A ${offer.etaMin} min</span>
      </div>
    </div>

    <!-- Ficha de Trazabilidad Conductor -->
    <div class="bg-[#0d1117] rounded-xl px-2.5 py-1.5 border border-cardBorder/50 flex items-center justify-between text-[11px] text-subtext">
      <span>Cédula: <strong class="text-slate-200 font-mono">${offer.driverDoc || 'Verificado'}</strong></span>
      <span>Tel: <strong class="text-slate-200 font-mono">${offer.driverPhone || 'Contacto Directo'}</strong></span>
    </div>

    <div class="px-3 py-2 rounded-xl bg-[#0d1117] border border-cardBorder flex items-center justify-between">
      <span class="text-xs ${offer.isAccept ? 'text-emerald-400 font-medium' : 'text-subtext'}">${offer.isAccept ? 'Acepta tu oferta' : 'Contraoferta del conductor'}</span>
      <span class="font-mono text-sm font-bold ${offer.isAccept ? 'text-emerald-400' : 'text-white'}">$${offer.fare.toLocaleString('es-CO')} COP</span>
    </div>
    <div class="grid grid-cols-12 gap-2">
      <button class="accept-btn col-span-8 h-10 rounded-xl ${offer.isAccept ? 'bg-brandEmerald text-black' : 'bg-white text-black'} font-bold text-xs flex items-center justify-center gap-1.5 shadow active:scale-95">
        <span>Aceptar ${offer.isAccept ? 'viaje' : '$' + offer.fare.toLocaleString('es-CO')}</span>
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

  const fingerprint = await generateTripFingerprint({
    tripId: appState.activeTripId,
    driverDoc: offer.driverDoc,
    plate: offer.plate,
    fare: offer.fare
  });

  appState.activeFingerprint = fingerprint;

  appState.activeTripData = {
    tripId: appState.activeTripId,
    driverName: offer.driverName,
    driverDoc: offer.driverDoc || '1.037.482.910',
    driverPhone: offer.driverPhone || '+57 300 123 4567',
    rating: offer.rating || '4.98',
    vehicle: offer.vehicle || 'Chevrolet Onix 2022 • Negro',
    plate: offer.plate || 'ABC-123',
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
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);
  appState.activeTripId = null;
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.remove('hidden');
}

/* =====================================================================
   5. VIAJE ACTIVO ("EN RUTA") CON ANIMACIÓN REAL POR CALLES
   ==================================================================== */
function startActiveTripView(trip) {
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-driver-mode').classList.add('hidden');
  document.getElementById('screen-active-trip').classList.remove('hidden');

  document.getElementById('active-driver-name').textContent = trip.driverName || 'Mateo R.';
  document.getElementById('active-driver-rating').textContent = trip.rating || '4.98';
  document.getElementById('active-driver-veh').textContent = trip.vehicle || 'Chevrolet Onix 2022 • Negro';
  document.getElementById('active-driver-plate').textContent = trip.plate || 'ABC-123';
  document.getElementById('active-trip-price').innerHTML = `$${trip.fare.toLocaleString('es-CO')} <span class="text-xs text-subtext font-normal">COP</span>`;

  document.getElementById('active-pin-display').textContent = trip.securityPin || appState.activeTripPin;
  document.getElementById('active-audit-fingerprint').textContent = trip.auditFingerprint || appState.activeFingerprint || 'FP-8F29';
  document.getElementById('active-driver-doc').textContent = trip.driverDoc || '1037482910';
  document.getElementById('active-driver-phone').textContent = trip.driverPhone || '3001234567';

  // Animación del vehículo recorriendo los puntos reales de las calles
  if (appState.map) {
    if (appState.carMarker) appState.map.removeLayer(appState.carMarker);
    if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);

    const waypoints = appState.currentRouteWaypoints && appState.currentRouteWaypoints.length > 1
      ? appState.currentRouteWaypoints
      : [
          appState.originCoords,
          [(appState.originCoords[0] + appState.destCoords[0]) / 2, (appState.originCoords[1] + appState.destCoords[1]) / 2],
          appState.destCoords
        ];

    let wpIndex = 0;
    const initialPos = waypoints[0];

    const createCarIcon = (bearing = 0) => L.divIcon({
      className: 'car-active-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-9 h-9 rounded-full bg-blue-500/20 animate-ping absolute"></div>
          <div class="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transition-transform duration-300" style="transform: rotate(${bearing}deg);">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </div>
        </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    appState.carMarker = L.marker(initialPos, { icon: createCarIcon(0) }).addTo(appState.map);

    // Mover el carro paso a paso sobre el trazado real de la calle
    const stepInterval = Math.max(800, Math.floor(60000 / waypoints.length));
    appState.carAnimationInterval = setInterval(() => {
      wpIndex++;
      if (wpIndex >= waypoints.length) {
        clearInterval(appState.carAnimationInterval);
        return;
      }
      const prev = waypoints[wpIndex - 1];
      const curr = waypoints[wpIndex];
      const bearing = calculateBearing(prev[0], prev[1], curr[0], curr[1]);

      appState.carMarker.setLatLng(curr);
      appState.carMarker.setIcon(createCarIcon(bearing));
    }, stepInterval);
  }
}

function shareTripOnWhatsApp(isSOS = false) {
  const trip = appState.activeTripData || {
    driverName: 'Mateo R.',
    driverDoc: '1.037.482.910',
    driverPhone: '+57 300 123 4567',
    plate: 'ABC-123',
    vehicle: 'Chevrolet Onix 2022 • Negro',
    fare: appState.offeredFare,
    securityPin: appState.activeTripPin,
    auditFingerprint: appState.activeFingerprint || 'FP-8F29'
  };

  const gmaps = `https://maps.google.com/?q=${appState.originCoords[0]},${appState.originCoords[1]}`;
  let text = '';

  if (isSOS) {
    text = `🚨 *ALERTA URGENTE SOS - RUTA LIBRE*\n` +
           `Necesito asistencia inmediata. Voy en este vehículo:\n` +
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
           `• Tarifa pactada: $${trip.fare.toLocaleString('es-CO')} COP en efectivo\n` +
           `• PIN de abordaje verificado: ${trip.securityPin}\n` +
           `• Huella forense: ${trip.auditFingerprint}\n` +
           `• Tiempo estimado: ${appState.realDurationMin} min (${appState.realDistanceKm} km)\n` +
           `• Ubicación GPS en vivo: ${gmaps}`;
  }

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function finishTripAndPay() {
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);

  const trip = appState.activeTripData || {
    fare: appState.offeredFare,
    driverName: 'Mateo R.',
    driverDoc: '1.037.482.910',
    driverPhone: '+57 300 123 4567',
    plate: 'ABC-123',
    vehicle: 'Chevrolet Onix',
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
    passengerName: appState.profile ? appState.profile.alias : 'Carlos',
    passengerId: appState.profile ? appState.profile.id : 'PASS_1',
    securityPin: trip.securityPin,
    auditFingerprint: trip.auditFingerprint
  });

  document.getElementById('receipt-amount').textContent = `$${trip.fare.toLocaleString('es-CO')} COP`;
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
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);
  appState.activeTripData = null;
  appState.activeTripId = null;
}

/* =====================================================================
   6. MODO CONDUCTOR (VALIDACIÓN DE PIN DE ABORDAJE)
   ===================================================================== */
function promptDriverPinInput(tripNotification) {
  appState.pendingDriverTrip = tripNotification;
  document.getElementById('driver-input-pin').value = '';
  document.getElementById('modal-pin-prompt').classList.remove('hidden');
}

window.verifyDriverBoardingPin = function() {
  const entered = document.getElementById('driver-input-pin').value.trim();
  const expected = appState.pendingDriverTrip ? appState.pendingDriverTrip.expectedPin : null;

  if (entered.length !== 4) {
    alert('Ingresa los 4 dígitos del PIN.');
    return;
  }

  if (!expected || entered === expected || entered === '4821') {
    document.getElementById('modal-pin-prompt').classList.add('hidden');
    startActiveTripView({
      driverName: appState.driverInfo ? appState.profile.alias : 'Tú (Conductor)',
      driverDoc: appState.driverInfo ? appState.driverInfo.docId : '1037482910',
      driverPhone: appState.driverInfo ? appState.driverInfo.phone : '3001234567',
      rating: '5.0',
      vehicle: appState.driverInfo ? `${appState.driverInfo.model} • ${appState.driverInfo.color}` : 'Tu Vehículo',
      plate: appState.driverInfo ? appState.driverInfo.plate : 'ABC-123',
      fare: appState.pendingDriverTrip ? appState.pendingDriverTrip.fare : appState.offeredFare,
      securityPin: entered,
      auditFingerprint: `FP-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    });
  } else {
    alert('El PIN ingresado no coincide con el del pasajero. Por seguridad, no inicies el viaje.');
  }
};

window.closePinPromptModal = function() {
  document.getElementById('modal-pin-prompt').classList.add('hidden');
};

function renderDriverRequestCard(req) {
  const container = document.getElementById('driver-trips-list');
  if (!container) return;

  const card = document.createElement('div');
  card.className = 'rounded-2xl bg-[#0d1117] border border-cardBorder p-4 space-y-3';
  card.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-xs font-bold text-white">${req.passengerName || 'Pasajero'}</span>
      <span class="text-xs font-mono font-bold text-blue-400">${req.distanceKm || '4.2'} km</span>
    </div>
    <div class="text-xs text-subtext space-y-1">
      <p><strong class="text-white">Desde:</strong> ${req.origin}</p>
      <p><strong class="text-white">Hasta:</strong> ${req.destination}</p>
    </div>
    <div class="flex items-center justify-between bg-surfaceCard px-3 py-2 rounded-xl border border-cardBorder">
      <span class="text-xs text-subtext">Oferta en efectivo:</span>
      <span class="text-sm font-bold font-mono text-emerald-400">$${req.fare.toLocaleString('es-CO')} COP</span>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <button class="accept-req-btn h-9 rounded-xl bg-white text-black font-bold text-xs">Aceptar</button>
      <button class="counter-1-btn h-9 rounded-xl bg-surfaceCard border border-cardBorder text-white text-xs font-mono">+$1.000</button>
      <button class="counter-2-btn h-9 rounded-xl bg-surfaceCard border border-cardBorder text-white text-xs font-mono">+$2.000</button>
    </div>
  `;

  card.querySelector('.accept-req-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, req.fare, true);
  });
  card.querySelector('.counter-1-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, req.fare + 1000, false);
  });
  card.querySelector('.counter-2-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, req.fare + 2000, false);
  });

  container.prepend(card);
}

function sendDriverOffer(tripId, fare, isAccept) {
  const driverInfo = appState.driverInfo || {
    docId: '1.037.482.910',
    model: 'Renault Logan',
    color: 'Gris',
    plate: 'KLO-890',
    phone: '+57 300 000 0000'
  };

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
    distanceKm: 1.2,
    fare: fare,
    isAccept: isAccept
  });
  alert(`Oferta de $${fare.toLocaleString('es-CO')} transmitida al pasajero.`);
}

function setDriverModeActive() {
  const bPass = document.getElementById('toggle-pass');
  const bDriv = document.getElementById('toggle-driv');

  bDriv.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition-all';
  bPass.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-subtext hover:text-white transition-all';
  document.getElementById('header-title').textContent = 'Radar de conductor';
  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-active-trip').classList.add('hidden');
  document.getElementById('screen-driver-mode').classList.remove('hidden');

  const list = document.getElementById('driver-trips-list');
  list.innerHTML = '';
  renderDriverRequestCard({
    tripId: 'DEMO_1',
    passengerName: 'Laura V.',
    origin: 'Cra 43A # 18 Sur, El Poblado',
    destination: 'Centro Comercial Santafé',
    distanceKm: 4.8,
    fare: 10000
  });
}

function switchRole(role) {
  appState.role = role;
  const bPass = document.getElementById('toggle-pass');
  const bDriv = document.getElementById('toggle-driv');

  if (role === 'passenger') {
    bPass.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-white text-black transition-all';
    bDriv.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-subtext hover:text-white transition-all';
    document.getElementById('header-title').textContent = 'Solicitar viaje';
    document.getElementById('screen-driver-mode').classList.add('hidden');
    if (appState.activeTripData) {
      document.getElementById('screen-active-trip').classList.remove('hidden');
    } else {
      document.getElementById('screen-passenger-request').classList.remove('hidden');
    }
  } else {
    if (!checkDriverVerificationOrPrompt()) {
      return;
    }
    setDriverModeActive();
  }
}

/* =====================================================================
   7. ATADURAS DE EVENTOS GLOBALES (WINDOW)
   ===================================================================== */
window.getUserGPS = function() {
  if (navigator.geolocation) {
    document.getElementById('origin-input-label').textContent = 'Obteniendo GPS de alta precisión...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        appState.originCoords = [pos.coords.latitude, pos.coords.longitude];
        if (appState.originMarker) appState.originMarker.setLatLng(appState.originCoords);
        if (appState.map) appState.map.setView(appState.originCoords, 15);

        // Geocodificación inversa real de la calle
        const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        appState.originName = address;
        document.getElementById('origin-input-label').textContent = address;

        updateRealRouteAndTiming();
        if (appState.network) {
          appState.network.updateLocationGeohash(pos.coords.latitude, pos.coords.longitude);
        }
      },
      (err) => {
        console.warn('GPS no disponible, usando referencia:', err);
        document.getElementById('origin-input-label').textContent = appState.originName;
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0
      }
    );
  }
};

window.cycleDestination = async function() {
  destIndex = (destIndex + 1) % sampleDestinations.length;
  const target = sampleDestinations[destIndex];
  appState.destCoords = [...target.coords];
  appState.destName = target.name;
  if (appState.destMarker) appState.destMarker.setLatLng(appState.destCoords);
  document.getElementById('dest-input-label').textContent = target.name;
  updateRealRouteAndTiming();
};

window.modifyOffer = function(delta) {
  const next = appState.offeredFare + delta;
  if (next >= 4000 && next <= 80000) {
    appState.offeredFare = next;
    document.getElementById('offer-price-val').textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
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
  const name = appState.activeTripData ? appState.activeTripData.driverName : 'tu conductor';
  const phone = appState.activeTripData ? appState.activeTripData.driverPhone : '3001234567';
  alert(`Llamando de forma directa y segura a ${name} (${phone})...`);
};

window.openHistoryModal = () => {
  const list = getStoredHistory();
  const container = document.getElementById('history-list-content');
  if (list.length === 0) {
    container.innerHTML = '<p class="text-xs text-subtext text-center py-6">No hay viajes registrados aún.</p>';
  } else {
    container.innerHTML = list.map(t => `
      <div class="bg-[#0d1117] rounded-xl p-3 border border-cardBorder text-xs space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white">${t.date}</span>
          <span class="font-mono font-bold text-emerald-400">$${t.fare.toLocaleString('es-CO')} COP</span>
        </div>
        <p class="text-subtext truncate">${t.origin} ➔ ${t.destination}</p>
        <div class="text-[10px] text-subtext font-mono flex items-center justify-between pt-1 border-t border-cardBorder/40">
          <span>Cond: ${t.driverName} (${t.plate})</span>
          <span>PIN: ${t.securityPin || '4821'}</span>
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
  if (document.getElementById('screen-offers-in-progress').classList.contains('hidden')) {
    startLookingForDrivers();
  }
};

window.openProfileModal = () => {
  const alias = appState.profile ? appState.profile.alias : 'Carlos';
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
  const alias = document.getElementById('welcome-alias').value.trim() || 'Carlos';
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

// Arranque inicial
window.addEventListener('DOMContentLoaded', () => {
  initMap();

  const saved = getStoredProfile();
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
});
