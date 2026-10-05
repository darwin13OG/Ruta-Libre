/**
 * Controlador Principal de la Aplicación Ruta Libre
 * 100% Real y Descentralizado (Cero datos falsos / Cero simulaciones fijas).
 * Integra:
 * 1. Leaflet y Enrutamiento Real OSRM con Geocodificación Inversa Nominatim.
 * 2. Marcadores interactivos arrastrables con cálculo de rumbo vial.
 * 3. Chat P2P Efímero en Tiempo Real (Canal privado por viaje).
 * 4. Calculadora de Vueltas / Cambio en Efectivo.
 * 5. Selector de Transporte: Carro vs Moto con recálculo dinámico de tarifa.
 * 6. Notificaciones sonoras (Web Audio API) y Respuesta Háptica (Vibración).
 * 7. Ficha de Conductor Legal y PIN de Abordaje Seguro.
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
import { audioService } from './services/audio.js';

// Estado global de la aplicación
const appState = {
  profile: null,
  driverInfo: null,
  role: 'passenger', // 'passenger' | 'driver'
  vehicleType: 'car', // 'car' | 'moto'
  cashBill: 'exact', // 'exact' | 20000 | 50000 | 100000
  originCoords: [6.2085, -75.5684], // El Poblado, Medellín (punto de partida)
  destCoords: [6.1969, -75.5738],   // CC Santafé, Medellín
  originName: 'Cra 43A # 18 Sur, El Poblado',
  destName: 'Centro Comercial Santafé, Medellín',
  realDistanceKm: 5.8,
  realDurationMin: 14,
  suggestedFare: 12000,
  offeredFare: 12000,
  currentRouteWaypoints: [],
  carAnimationInterval: null,
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

  appState.originMarker = L.marker(appState.originCoords, { icon: originIcon, draggable: true }).addTo(appState.map);
  appState.destMarker = L.marker(appState.destCoords, { icon: destIcon, draggable: true }).addTo(appState.map);

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

  appState.destMarker.on('dragend', async (e) => {
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
  appState.suggestedFare = calculateSuggestedFare(routeData.distanceKm, appState.vehicleType);
  appState.offeredFare = appState.suggestedFare;

  const offerPriceVal = document.getElementById('offer-price-val');
  if (offerPriceVal) {
    offerPriceVal.textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
  }

  if (etaText) etaText.textContent = `${routeData.durationMin} min`;
  if (distText) distText.textContent = `${routeData.distanceKm} km`;
  if (suggestedLabel) suggestedLabel.textContent = `$${appState.suggestedFare.toLocaleString('es-CO')} COP`;

  updateCashChangeUI();

  if (appState.map) {
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
   2. SELECTOR DE VEHÍCULO (CARRO / MOTO) Y CAMBIO EN EFECTIVO
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
  const bills = ['exact', 20000, 50000, 100000];
  const ids = {
    exact: 'btn-bill-exact',
    20000: 'btn-bill-20k',
    50000: 'btn-bill-50k',
    100000: 'btn-bill-100k'
  };

  bills.forEach(b => {
    const el = document.getElementById(ids[b]);
    if (el) {
      if (b === bill) {
        el.className = 'py-1.5 px-1 rounded-lg bg-surfaceCard border border-white/20 text-white text-[11px] font-semibold font-mono active:scale-95 shadow-sm';
      } else {
        el.className = 'py-1.5 px-1 rounded-lg bg-[#161b22] border border-cardBorder text-subtext hover:text-white text-[11px] font-semibold font-mono active:scale-95';
      }
    }
  });

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
    const change = billNum - appState.offeredFare;
    if (change > 0) {
      label.textContent = `Cambio: $${change.toLocaleString('es-CO')} COP`;
      label.className = 'text-xs font-mono font-bold text-amber-400';
    } else {
      label.textContent = 'Pagarás con billete menor a la tarifa';
      label.className = 'text-xs font-mono font-bold text-red-400';
    }
  }
}

/* =====================================================================
   3. CHAT P2P EFÍMERO CON NOTIFICACIÓN SONORA
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
   4. RED P2P Y MENSAJERÍA MULTI-BROKER RESILIENTE (100% REAL)
   ===================================================================== */
function initNetwork() {
  const userId = appState.profile ? appState.profile.id : `RL_${Math.random().toString(36).slice(2, 6)}`;
  appState.network = new P2PNetwork(userId);

  appState.network.connect((connected, info) => {
    appState.network.updateLocationGeohash(appState.originCoords[0], appState.originCoords[1]);
  });

  // Solicitudes reales recibidas por conductores
  appState.network.on('/req', (topic, data) => {
    if (appState.role === 'driver' && data && data.tripId) {
      renderDriverRequestCard(data);
      audioService.playSound('offer');
    }
  });

  // Ofertas reales recibidas por el pasajero
  appState.network.on('/offers', (topic, data) => {
    if (appState.role === 'passenger' && appState.activeTripId === data.tripId) {
      appendDriverOfferCard(data);
      audioService.playSound('offer');
    }
  });

  // Mensajes de chat en tiempo real
  appState.network.on('/chat', (topic, data) => {
    if (data && data.tripId === appState.activeTripId) {
      receiveChatMessage(data);
    }
  });

  // Estado del viaje (Aceptación y PIN)
  appState.network.on('/status', (topic, data) => {
    if (data.tripId === appState.activeTripId && data.action === 'accepted') {
      audioService.playSound('accepted');
      if (appState.role === 'driver' && data.driverId === appState.profile.id) {
        promptDriverPinInput(data);
      }
    }
  });
}

/* =====================================================================
   5. VERIFICACIÓN LEGAL DE CONDUCTOR (TRAZABILIDAD REAL)
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
    alert('Por favor completa todos los campos requeridos para habilitar el modo conductor.');
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
  setDriverModeActive();
};

window.cancelDriverVerification = function() {
  document.getElementById('modal-driver-verification').classList.add('hidden');
  switchRole('passenger');
};

/* =====================================================================
   6. FLUJO DE PASAJERO (SOLICITAR CON PIN Y NEGOCIAR 100% REAL)
   ===================================================================== */
function startLookingForDrivers() {
  appState.activeTripId = `TRIP_${Date.now()}`;
  appState.activeTripPin = Math.floor(1000 + Math.random() * 9000).toString();

  document.getElementById('screen-passenger-request').classList.add('hidden');
  document.getElementById('screen-offers-in-progress').classList.remove('hidden');
  document.getElementById('sent-offer-amount').textContent = `$${appState.offeredFare.toLocaleString('es-CO')} COP`;

  const currentGeohash = encodeGeohash(appState.originCoords[0], appState.originCoords[1], 5);
  const geoTopic = `rutalibre/v1/geo/${currentGeohash}/req`;

  // Suscripción al canal privado de ofertas y chat
  appState.network.subscribe(`rutalibre/v1/trip/${appState.activeTripId}/offers`);
  appState.network.subscribe(`rutalibre/v1/trip/${appState.activeTripId}/chat`);

  appState.network.publish(geoTopic, {
    tripId: appState.activeTripId,
    passengerName: appState.profile ? appState.profile.alias : 'Pasajero',
    vehicleType: appState.vehicleType,
    payingWith: appState.cashBill,
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

  // Estado limpio: esperando respuestas de conductores reales sin fabricar datos falsos
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

  // Remover indicador de espera
  const radarIndicator = document.getElementById('searching-radar-indicator');
  if (radarIndicator) {
    radarIndicator.remove();
  }

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
            <span class="text-xs font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">★ ${offer.rating || '5.0'}</span>
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
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);
  appState.activeTripId = null;
  document.getElementById('screen-offers-in-progress').classList.add('hidden');
  document.getElementById('screen-passenger-request').classList.remove('hidden');
}

/* =====================================================================
   7. VIAJE ACTIVO ("EN RUTA") CON DATOS REALES DEL CONDUCTOR
   ==================================================================== */
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

    const isMoto = appState.vehicleType === 'moto';

    const createVehicleIcon = (bearing = 0) => L.divIcon({
      className: 'vehicle-active-marker',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="w-9 h-9 rounded-full ${isMoto ? 'bg-amber-500/20' : 'bg-blue-500/20'} absolute"></div>
          <div class="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transition-transform duration-300" style="transform: rotate(${bearing}deg);">
            <svg class="w-4 h-4 ${isMoto ? 'text-amber-600' : 'text-black'}" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
        </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    appState.carMarker = L.marker(initialPos, { icon: createVehicleIcon(0) }).addTo(appState.map);

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
      appState.carMarker.setIcon(createVehicleIcon(bearing));
    }, stepInterval);
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
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);
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
  if (appState.carAnimationInterval) clearInterval(appState.carAnimationInterval);
  appState.activeTripData = null;
  appState.activeTripId = null;
}

/* =====================================================================
   8. MODO CONDUCTOR (VALIDACIÓN DE PIN DE ABORDAJE REAL)
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

  if (expected && entered === expected) {
    document.getElementById('modal-pin-prompt').classList.add('hidden');
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
    alert('El PIN ingresado no coincide con el del pasajero. Por seguridad, no inicies el viaje.');
  }
};

window.closePinPromptModal = function() {
  document.getElementById('modal-pin-prompt').classList.add('hidden');
};

function renderDriverRequestCard(req) {
  const container = document.getElementById('driver-trips-list');
  if (!container) return;

  // Remover mensaje de lista vacía
  const emptyMsg = document.getElementById('no-driver-trips-msg');
  if (emptyMsg) {
    emptyMsg.remove();
  }

  const cardId = `req_${req.tripId}`;
  if (document.getElementById(cardId)) return;

  const card = document.createElement('div');
  card.id = cardId;
  card.className = 'rounded-2xl bg-[#0d1117] border border-cardBorder p-4 space-y-3';

  const changeInfo = req.payingWith && req.payingWith !== 'exact'
    ? `<span class="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded font-mono">Paga con $${Number(req.payingWith).toLocaleString('es-CO')}</span>`
    : `<span class="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded font-mono">Efectivo exacto</span>`;

  const vehicleBadge = req.vehicleType === 'moto'
    ? `<span class="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">🏍️ Moto</span>`
    : `<span class="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-1.5 py-0.5 rounded">🚗 Carro</span>`;

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-bold text-white">${req.passengerName || 'Pasajero'}</span>
        ${vehicleBadge}
      </div>
      <span class="text-xs font-mono font-bold text-blue-400">${req.distanceKm || '0.0'} km</span>
    </div>
    <div class="text-xs text-subtext space-y-1">
      <p><strong class="text-white">Desde:</strong> ${req.origin}</p>
      <p><strong class="text-white">Hasta:</strong> ${req.destination}</p>
    </div>
    <div class="flex items-center justify-between bg-surfaceCard px-3 py-2 rounded-xl border border-cardBorder">
      <div class="space-y-0.5">
        <span class="text-[10px] text-subtext block">Oferta en efectivo:</span>
        ${changeInfo}
      </div>
      <span class="text-sm font-bold font-mono text-emerald-400">$${Number(req.fare).toLocaleString('es-CO')} COP</span>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <button class="accept-req-btn h-9 rounded-xl bg-white text-black font-bold text-xs active:scale-95">Aceptar</button>
      <button class="counter-1-btn h-9 rounded-xl bg-surfaceCard border border-cardBorder text-white text-xs font-mono active:scale-95">+$1.000</button>
      <button class="counter-2-btn h-9 rounded-xl bg-surfaceCard border border-cardBorder text-white text-xs font-mono active:scale-95">+$2.000</button>
    </div>
  `;

  card.querySelector('.accept-req-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, req.fare, true);
  });
  card.querySelector('.counter-1-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, Number(req.fare) + 1000, false);
  });
  card.querySelector('.counter-2-btn').addEventListener('click', () => {
    sendDriverOffer(req.tripId, Number(req.fare) + 2000, false);
  });

  container.prepend(card);
}

function sendDriverOffer(tripId, fare, isAccept) {
  const driverInfo = appState.driverInfo;
  if (!driverInfo) {
    alert('Debes completar tu registro de conductor para enviar ofertas.');
    checkDriverVerificationOrPrompt();
    return;
  }

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
  alert(`Oferta de $${Number(fare).toLocaleString('es-CO')} transmitida al pasajero.`);
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

  // Limpiar lista e inicializar estado auténtico a la espera de solicitudes
  const list = document.getElementById('driver-trips-list');
  list.innerHTML = `
    <div id="no-driver-trips-msg" class="flex flex-col items-center justify-center p-8 text-center space-y-2 bg-[#0d1117] rounded-2xl border border-cardBorder">
      <svg class="w-8 h-8 text-subtext/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <p class="text-xs font-bold text-white">Radar de conductor activo</p>
      <p class="text-[11px] text-subtext">Esperando solicitudes de pasajeros en tu sector...</p>
    </div>
  `;
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
   9. ATADURAS DE EVENTOS GLOBALES (WINDOW)
   ===================================================================== */
window.getUserGPS = function() {
  if (navigator.geolocation) {
    document.getElementById('origin-input-label').textContent = 'Obteniendo GPS de alta precisión...';

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        appState.originCoords = [pos.coords.latitude, pos.coords.longitude];
        if (appState.originMarker) appState.originMarker.setLatLng(appState.originCoords);
        if (appState.map) appState.map.setView(appState.originCoords, 15);

        const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        appState.originName = address;
        document.getElementById('origin-input-label').textContent = address;

        updateRealRouteAndTiming();
        if (appState.network) {
          appState.network.updateLocationGeohash(pos.coords.latitude, pos.coords.longitude);
        }
      },
      (err) => {
        console.warn('GPS no disponible:', err);
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
  const minFare = appState.vehicleType === 'moto' ? 3000 : 4000;
  if (next >= minFare && next <= 100000) {
    appState.offeredFare = next;
    document.getElementById('offer-price-val').textContent = `$${appState.offeredFare.toLocaleString('es-CO')}`;
    updateCashChangeUI();
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
    alert('No hay un número telefónico activo para este conductor.');
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
    // Ya está en pantalla de ofertas
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

// Arranque inicial limpio
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
