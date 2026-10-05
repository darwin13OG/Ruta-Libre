/**
 * Servicio de Sonidos de Notificación y Respuesta Háptica (Vibración)
 * Utiliza Web Audio API (cero dependencias de archivos de audio externos, 100% confiable y sin latencia).
 */

class AudioNotificationService {
  constructor() {
    this.ctx = null;
  }

  _getAudioContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Reproduce un tono sintetizado nítido según el evento
   * @param {'offer' | 'accepted' | 'chat' | 'finish'} type
   */
  playSound(type = 'offer') {
    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      if (type === 'offer') {
        // Timbre ascendente agradable al recibir oferta o contraoferta
        this._playTone(ctx, 523.25, now, 0.12, 'sine'); // C5
        this._playTone(ctx, 659.25, now + 0.1, 0.18, 'sine'); // E5
        this._triggerVibration([80, 50, 80]);
      } else if (type === 'accepted') {
        // Fanfarria de confirmación de viaje y PIN
        this._playTone(ctx, 587.33, now, 0.1, 'triangle'); // D5
        this._playTone(ctx, 783.99, now + 0.1, 0.1, 'triangle'); // G5
        this._playTone(ctx, 1046.50, now + 0.2, 0.25, 'triangle'); // C6
        this._triggerVibration([120, 80, 200]);
      } else if (type === 'chat') {
        // Pop de burbuja para mensaje de chat
        this._playTone(ctx, 740, now, 0.08, 'sine');
        this._playTone(ctx, 880, now + 0.06, 0.12, 'sine');
        this._triggerVibration([60]);
      } else if (type === 'finish') {
        // Tono de llegada y cobro
        this._playTone(ctx, 659.25, now, 0.15, 'sine');
        this._playTone(ctx, 523.25, now + 0.15, 0.25, 'sine');
        this._triggerVibration([100]);
      }
    } catch (e) {
      console.warn('Web Audio no disponible:', e);
    }
  }

  _playTone(ctx, freq, startTime, duration, waveType = 'sine') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  _triggerVibration(pattern) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }
}

export const audioService = new AudioNotificationService();
