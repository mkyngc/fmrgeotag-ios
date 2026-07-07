/**
 * gps.js
 * High-accuracy GPS service used by both survey modes.
 *
 * Foreground tracking uses the standard `cordova-plugin-geolocation`
 * (navigator.geolocation), which also works in a plain browser for
 * development/testing.
 *
 * Background tracking (so recording continues when the phone is locked
 * or the app is minimized in Pathway Mode) uses
 * `cordova-background-geolocation-lt` - a free, MIT-licensed background
 * geolocation plugin. It is initialized lazily and only engaged while a
 * pathway survey is actively running, to conserve battery per the
 * "battery optimization" requirement.
 */
(function (global) {
  'use strict';

  const accuracyProfiles = {
    high: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    balanced: { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 },
    low: { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 },
  };

  let currentWatchId = null;
  let bgConfigured = false;

  function getAccuracyProfile() {
    return FMRDb.getSetting('gpsAccuracy', 'high').then((mode) => accuracyProfiles[mode] || accuracyProfiles.high);
  }

  function normalizePosition(pos) {
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitude: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      altitudeAccuracy: pos.coords.altitudeAccuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: new Date(pos.timestamp).toISOString(),
    };
  }

  /** One-shot high-accuracy fix. Resolves a normalized position object. */
  function getCurrentPosition() {
    return getAccuracyProfile().then((opts) => new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not available on this device.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(normalizePosition(pos)),
        (err) => reject(new Error(mapGeoError(err))),
        opts
      );
    }));
  }

  /**
   * Starts a continuous foreground watch. `onUpdate` is called with a
   * normalized position on every fix; `onError` on failures (e.g. signal
   * lost). Returns the watch handle so the caller can `clearWatch` it.
   */
  function watch(onUpdate, onError) {
    return getAccuracyProfile().then((opts) => {
      if (currentWatchId !== null) clearWatch();
      currentWatchId = navigator.geolocation.watchPosition(
        (pos) => onUpdate(normalizePosition(pos)),
        (err) => onError && onError(new Error(mapGeoError(err))),
        opts
      );
      return currentWatchId;
    });
  }

  function clearWatch() {
    if (currentWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(currentWatchId);
      currentWatchId = null;
    }
  }

  function mapGeoError(err) {
    switch (err.code) {
      case 1: return 'Location permission denied. Please enable GPS/location permission in Settings.';
      case 2: return 'Location unavailable. Move to an open area and try again.';
      case 3: return 'GPS fix timed out. Waiting for stronger signal.';
      default: return err.message || 'Unknown GPS error.';
    }
  }

  /* ---------------------------------------------------------------
   * Background tracking (Pathway Mode)
   * ------------------------------------------------------------- */

  function backgroundPluginAvailable() {
    return !!(global.BackgroundGeolocation);
  }

  /**
   * Starts background-capable tracking. `onLocation` receives a
   * normalized position for every recorded point, including points
   * captured while the screen is off or the app is backgrounded.
   * Falls back to the foreground `watch()` when the native background
   * plugin isn't present (e.g. browser preview).
   */
  function startBackgroundTracking(distanceFilterMeters, onLocation, onError) {
    if (!backgroundPluginAvailable()) {
      return watch(onLocation, onError);
    }

    const BG = global.BackgroundGeolocation;
    if (!bgConfigured) {
      BG.ready({
        desiredAccuracy: BG.DESIRED_ACCURACY_HIGH,
        distanceFilter: distanceFilterMeters || 5,
        stopOnTerminate: false,
        startOnBoot: false,
        debug: false,
        foregroundService: true,
        notification: {
          title: 'FMR Geotag',
          text: 'Recording pathway survey in the background',
        },
      }, () => { bgConfigured = true; });
    } else {
      BG.setConfig({ distanceFilter: distanceFilterMeters || 5 });
    }

    BG.onLocation((location) => {
      onLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        altitude: location.coords.altitude,
        accuracy: location.coords.accuracy,
        heading: location.coords.heading,
        speed: location.coords.speed,
        timestamp: new Date(location.timestamp).toISOString(),
      });
    }, (err) => onError && onError(err));

    BG.start();
    return Promise.resolve('background');
  }

  function stopBackgroundTracking() {
    if (backgroundPluginAvailable()) {
      global.BackgroundGeolocation.stop();
    } else {
      clearWatch();
    }
  }

  function pauseBackgroundTracking() {
    if (backgroundPluginAvailable()) {
      global.BackgroundGeolocation.stop();
    } else {
      clearWatch();
    }
  }

  global.FMRGps = {
    getCurrentPosition,
    watch,
    clearWatch,
    startBackgroundTracking,
    stopBackgroundTracking,
    pauseBackgroundTracking,
    backgroundPluginAvailable,
  };
})(window);
