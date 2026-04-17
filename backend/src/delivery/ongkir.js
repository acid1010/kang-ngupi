/**
 * Ongkir Calculator — Go Ngupi delivery fee based on distance zones
 * 
 * Zona 1 (0-2 KM): Rp8.000 - Rp10.000 (flat Rp8.000)
 * Zona 2 (2-5 KM): Rp10.000 + Rp2.000/KM (extra km beyond 2)
 * Zona 3 (>5 KM):  Rp16.000 + Rp3.000/KM (extra km beyond 5)
 */

// Kedai Ngupi-Ngupi coordinates
const KEDAI_LAT = parseFloat(process.env.KEDAI_LAT || '-6.5519552');
const KEDAI_LNG = parseFloat(process.env.KEDAI_LNG || '107.4451273');

/**
 * Calculate distance between two points using Haversine formula
 * @returns distance in kilometers
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate delivery fee based on distance
 * @param {number} distanceKm - distance in kilometers
 * @returns {{ zone: number, distanceKm: number, fee: number, label: string }}
 */
export function calculateDeliveryFee(distanceKm) {
  const km = Math.round(distanceKm * 10) / 10; // round to 1 decimal

  if (km <= 2) {
    return {
      zone: 1,
      distanceKm: km,
      fee: 8000,
      label: `Zona 1 (${km} km) — Rp8.000`
    };
  } else if (km <= 5) {
    const extraKm = Math.ceil(km - 2);
    const fee = 10000 + (extraKm * 2000);
    return {
      zone: 2,
      distanceKm: km,
      fee,
      label: `Zona 2 (${km} km) — Rp${fee.toLocaleString('id-ID')}`
    };
  } else {
    const extraKm = Math.ceil(km - 5);
    const fee = 16000 + (extraKm * 3000);
    return {
      zone: 3,
      distanceKm: km,
      fee,
      label: `Zona 3 (${km} km) — Rp${fee.toLocaleString('id-ID')}`
    };
  }
}

/**
 * Calculate delivery fee from customer location to kedai
 * @param {number} customerLat
 * @param {number} customerLng
 * @returns {{ zone: number, distanceKm: number, fee: number, label: string }}
 */
const MAX_DELIVERY_KM = parseFloat(process.env.MAX_DELIVERY_KM || '8');

export function calculateOngkir(customerLat, customerLng) {
  const distance = haversineDistance(KEDAI_LAT, KEDAI_LNG, customerLat, customerLng);
  const km = Math.round(distance * 10) / 10;
  
  if (km > MAX_DELIVERY_KM) {
    return {
      ok: false,
      outOfRange: true,
      distanceKm: km,
      maxKm: MAX_DELIVERY_KM,
      fee: 0,
      label: `Maaf kak, lokasi ${km} km dari kedai. Delivery maksimal ${MAX_DELIVERY_KM} km ya 🙏`
    };
  }
  
  return calculateDeliveryFee(distance);
}

/**
 * Format ongkir for WhatsApp display
 */
export function formatOngkirMessage(ongkir) {
  return `🛵 Ongkir: ${ongkir.label}`;
}


