/**
 * settings.js
 * Loads persisted settings into the Settings screen controls and saves
 * changes back to SQLite immediately (no explicit "Save" button - each
 * control commits on change, which is friendlier for field use).
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    gpsAccuracy: 'high',
    photoQuality: 70,
    distanceInterval: 5,
    timeInterval: 5,
    darkMode: false,
  };

  function loadIntoUI() {
    return FMRDb.getAllSettings().then((saved) => {
      const s = Object.assign({}, DEFAULTS, saved);
      document.getElementById('setting-gps-accuracy').value = s.gpsAccuracy;
      document.getElementById('setting-photo-quality').value = String(s.photoQuality);
      document.getElementById('setting-distance-interval').value = s.distanceInterval;
      document.getElementById('setting-time-interval').value = s.timeInterval;
      document.getElementById('setting-dark-mode').checked = !!s.darkMode;
      applyDarkMode(!!s.darkMode);
      return s;
    });
  }

  function bindHandlers() {
    document.getElementById('setting-gps-accuracy').addEventListener('change', (e) => {
      FMRDb.setSetting('gpsAccuracy', e.target.value);
      FMRUtils.toast('GPS accuracy updated.');
    });
    document.getElementById('setting-photo-quality').addEventListener('change', (e) => {
      FMRDb.setSetting('photoQuality', Number(e.target.value));
      FMRUtils.toast('Photo quality updated.');
    });
    document.getElementById('setting-distance-interval').addEventListener('change', (e) => {
      const v = Math.max(1, Number(e.target.value) || 5);
      e.target.value = v;
      FMRDb.setSetting('distanceInterval', v);
      FMRUtils.toast('Distance interval updated.');
    });
    document.getElementById('setting-time-interval').addEventListener('change', (e) => {
      const v = Math.max(1, Number(e.target.value) || 5);
      e.target.value = v;
      FMRDb.setSetting('timeInterval', v);
      FMRUtils.toast('Time interval updated.');
    });
    document.getElementById('setting-dark-mode').addEventListener('change', (e) => {
      FMRDb.setSetting('darkMode', e.target.checked);
      applyDarkMode(e.target.checked);
    });
    document.getElementById('btn-reset-app').addEventListener('click', confirmResetApp);
  }

  function applyDarkMode(enabled) {
    document.body.classList.toggle('dark-mode', !!enabled);
  }

  function confirmResetApp() {
    const doReset = () => {
      FMRUtils.showLoading('Resetting app data...');
      FMRDb.getAllProjects()
        .then((projects) => Promise.all(projects.map((p) => FMRDb.deleteProject(p.id))))
        .then(() => {
          FMRUtils.hideLoading();
          FMRUtils.toast('All survey data has been cleared.');
          global.FMRApp.navigate('dashboard');
        })
        .catch((err) => {
          FMRUtils.hideLoading();
          FMRUtils.toast(err.message || 'Reset failed.', 'error');
        });
    };

    if (global.navigator && navigator.notification && navigator.notification.confirm) {
      navigator.notification.confirm(
        'This will permanently delete all projects, segments, tracks, and photo records from the app database. Files already written to storage will remain on disk. Continue?',
        (buttonIndex) => { if (buttonIndex === 1) doReset(); },
        'Reset All Data',
        ['Delete Everything', 'Cancel']
      );
    } else if (global.confirm(
      'This will permanently delete all projects, segments, tracks, and photo records from the app database. Continue?'
    )) {
      doReset();
    }
  }

  global.FMRSettings = { loadIntoUI, bindHandlers, applyDarkMode, DEFAULTS };
})(window);
