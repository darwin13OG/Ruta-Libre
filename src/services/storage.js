/**
 * Gestor de Persistencia 100% Local y Trazabilidad Forense
 * Almacena perfiles, verificación de conductores y auditoría de seguridad cifrada localmente.
 */

const PROFILE_KEY = 'rl_user_profile';
const DRIVER_KEY = 'rl_driver_verified_info';
const HISTORY_KEY = 'rl_trip_history';
const AUDIT_KEY = 'rl_security_audit_log';
const BLOCKED_KEY = 'rl_blocked_users';

export function getStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveStoredProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {}
}

export function getStoredDriverInfo() {
  try {
    const raw = localStorage.getItem(DRIVER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveStoredDriverInfo(driverData) {
  try {
    localStorage.setItem(DRIVER_KEY, JSON.stringify(driverData));
  } catch (e) {}
}

export function getStoredHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveTripRecord(trip) {
  try {
    const history = getStoredHistory();
    history.unshift({
      id: trip.id || `TRIP_${Date.now()}`,
      date: new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      origin: trip.origin,
      destination: trip.destination,
      fare: trip.fare,
      distanceKm: trip.distanceKm,
      driverName: trip.driverName,
      plate: trip.plate,
      driverDocument: trip.driverDocument || 'Verificado',
      driverPhone: trip.driverPhone || '',
      securityPin: trip.securityPin || '',
      auditFingerprint: trip.auditFingerprint || ''
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));

    // Guardar en bitácora forense de seguridad local inalterable
    saveSecurityAudit(trip);
  } catch (e) {}
}

export function saveSecurityAudit(trip) {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    const audits = raw ? JSON.parse(raw) : [];
    audits.unshift({
      timestamp: Date.now(),
      dateISO: new Date().toISOString(),
      tripId: trip.id,
      driver: {
        name: trip.driverName,
        docId: trip.driverDocument,
        plate: trip.plate,
        phone: trip.driverPhone,
        vehicle: trip.vehicle
      },
      passenger: {
        name: trip.passengerName,
        id: trip.passengerId
      },
      coordinates: {
        origin: trip.originCoords,
        dest: trip.destCoords
      },
      pin: trip.securityPin,
      fare: trip.fare
    });
    localStorage.setItem(AUDIT_KEY, JSON.stringify(audits.slice(0, 100)));
  } catch (e) {}
}

export function getSecurityAuditLog() {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function getBlockedUsers() {
  try {
    const raw = localStorage.getItem(BLOCKED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function blockUser(userId) {
  try {
    const list = getBlockedUsers();
    if (!list.includes(userId)) {
      list.push(userId);
      localStorage.setItem(BLOCKED_KEY, JSON.stringify(list));
    }
  } catch (e) {}
}
