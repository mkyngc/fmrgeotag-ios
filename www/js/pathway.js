/**
 * pathway.js
 * Implements "Pathway Mode": continuous GPS track recording, similar to
 * Strava. Points are recorded whenever either the configured distance
 * interval OR time interval has elapsed since the last recorded point
 * (whichever comes first), so fast movement is captured densely while
 * slow/stationary periods don't flood storage.
 */
(function (global) {
  'use strict';

  const state = {
    project: null,
    projectDir: null,
    watchHandle: null,
    mapBundle: null,
    points: [],       // recorded (persisted) track points
    photos: [],
    lastRecordedPoint: null,
    lastRecordedTime: null,
    startTime: null,
    pausedAccum: 0,   // ms spent paused, excluded from elapsed time
    pauseStartedAt: null,
    isPaused: false,
    isRunning: false,
    distanceIntervalM: 5,
    timeIntervalS: 5,
    totalDistance: 0,
    timerHandle: null,
    seq: 0,
  };

  function resetState() {
    Object.assign(state, {
      project: null, projectDir: null, watchHandle: null, mapBundle: null,
      points: [], photos: [], lastRecordedPoint: null, lastRecordedTime: null,
      startTime: null, pausedAccum: 0, pauseStartedAt: null, isPaused: false,
      isRunning: false, totalDistance: 0, seq: 0,
    });
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  /* ---------------------------------------------------------------
   * Setup -> Start
   * ------------------------------------------------------------- */
  function handleSetupSubmit(formData) {
    return FMRDb.findPossibleDuplicate(formData.projectName, formData.roadName)
      .then((dup) => {
        if (dup) {
          return Promise.reject(new Error(
            `A survey for "${formData.projectName}" on "${formData.roadName}" was already started today. Please confirm this isn't a duplicate before proceeding.`
          ));
        }
        return startPathway(formData);
      });
  }

  function startPathway(formData) {
    FMRUtils.showLoading('Creating project folder...');
    const folderName = FMRUtils.buildProjectFolderName(formData.projectName);

    return Promise.all([
      FMRDb.getSetting('distanceInterval', 5),
      FMRDb.getSetting('timeInterval', 5),
    ]).then(([distInt, timeInt]) => {
      state.distanceIntervalM = Number(distInt) || 5;
      state.timeIntervalS = Number(timeInt) || 5;
      return FMRFolderManager.createProjectFolder(folderName);
    }).then((dirEntry) => {
      state.projectDir = dirEntry;
      return FMRDb.createProject({
        type: 'pathway',
        projectName: formData.projectName,
        barangay: formData.barangay,
        municipality: formData.municipality,
        province: formData.province,
        roadName: formData.roadName,
        surveyorName: formData.surveyorName,
        remarks: formData.remarks || '',
        folderName,
        folderPath: FMRFolderManager.getFullPath(dirEntry),
      });
    }).then((project) => {
      state.project = project;
      resetPathwayUI();
      return FMRGps.getCurrentPosition();
    }).then((pos) => {
      state.mapBundle = FMRMap.initMap('map-container-pw', { center: [pos.latitude, pos.longitude], zoom: 17 });
      FMRMap.updateCurrentLocation(state.mapBundle, pos.latitude, pos.longitude, pos.accuracy);
      recordPoint(pos, true);
      state.startTime = Date.now();
      state.isRunning = true;
      state.timerHandle = setInterval(updateElapsedUI, 1000);
      return FMRGps.startBackgroundTracking(state.distanceIntervalM, onPositionUpdate, onPositionError);
    }).then((handle) => {
      state.watchHandle = handle;
      FMRUtils.hideLoading();
      FMRUtils.toast('Pathway recording started.', null);
    }).catch((err) => {
      FMRUtils.hideLoading();
      FMRUtils.toast(err.message || 'Could not start pathway survey.', 'error', 4000);
      throw err;
    });
  }

  function resetPathwayUI() {
    document.getElementById('hud-distance-pw').textContent = '0.0';
    document.getElementById('hud-time-pw').textContent = '00:00:00';
    document.getElementById('hud-speed-pw').textContent = '0.0';
    document.getElementById('hud-elevation-pw').textContent = '--';
    document.getElementById('hud-heading-pw').textContent = '--';
    document.getElementById('hud-points-pw').textContent = '0';
    document.getElementById('pathway-photo-preview').innerHTML = '';
    setPauseButtonIcon(false);
  }

  /* ---------------------------------------------------------------
   * Live GPS handling
   * ------------------------------------------------------------- */
  function onPositionUpdate(pos) {
    if (state.isPaused) return;
    updateGpsHud(pos);

    if (state.mapBundle) FMRMap.updateCurrentLocation(state.mapBundle, pos.latitude, pos.longitude, pos.accuracy);

    const now = Date.now();
    const last = state.lastRecordedPoint;
    const distFromLast = last ? FMRUtils.haversineDistance(last, pos) : Infinity;
    const timeSinceLast = state.lastRecordedTime ? (now - state.lastRecordedTime) / 1000 : Infinity;

    const shouldRecord = !last ||
      distFromLast >= state.distanceIntervalM ||
      timeSinceLast >= state.timeIntervalS;

    if (shouldRecord) {
      if (last) state.totalDistance += distFromLast;
      recordPoint(pos, false);
    }
  }

  function onPositionError(err) {
    document.getElementById('gps-status-text-pw').textContent = err.message || 'GPS error';
    document.getElementById('gps-dot-pw').className = 'gps-signal-dot poor';
  }

  function recordPoint(pos, isFirst) {
    state.seq += 1;
    const point = {
      projectId: state.project.id,
      seq: state.seq,
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitude: pos.altitude,
      accuracy: pos.accuracy,
      speed: pos.speed,
      heading: pos.heading,
      timestamp: pos.timestamp,
    };
    state.points.push(point);
    state.lastRecordedPoint = pos;
    state.lastRecordedTime = Date.now();

    FMRDb.insertTrackPoint(point);
    if (state.mapBundle) FMRMap.appendPathPoint(state.mapBundle, pos.latitude, pos.longitude);

    document.getElementById('hud-points-pw').textContent = String(state.points.length);
    document.getElementById('hud-distance-pw').textContent = state.totalDistance.toFixed(1);
    updateGpsHud(pos);
  }

  function updateGpsHud(pos) {
    const dot = document.getElementById('gps-dot-pw');
    const statusText = document.getElementById('gps-status-text-pw');
    const accBadge = document.getElementById('accuracy-badge-pw');
    const cls = FMRUtils.accuracyClass(pos.accuracy);
    if (dot) dot.className = `gps-signal-dot ${cls}`;
    if (statusText) statusText.textContent = cls === 'good' ? 'GPS Locked' : cls === 'fair' ? 'GPS Fair' : 'GPS Weak';
    if (accBadge) {
      accBadge.textContent = `±${(pos.accuracy || 0).toFixed(1)} m`;
      accBadge.className = `badge badge-accuracy-${cls}`;
    }
    const speedKmh = pos.speed != null && pos.speed >= 0 ? (pos.speed * 3.6) : 0;
    document.getElementById('hud-speed-pw').textContent = speedKmh.toFixed(1);
    document.getElementById('hud-elevation-pw').textContent = pos.altitude != null ? pos.altitude.toFixed(1) : '--';
    document.getElementById('hud-heading-pw').textContent = pos.heading != null && !isNaN(pos.heading) ? `${Math.round(pos.heading)}°` : '--';
  }

  function updateElapsedUI() {
    if (!state.startTime) return;
    const elapsed = Date.now() - state.startTime - state.pausedAccum - (state.isPaused ? (Date.now() - state.pauseStartedAt) : 0);
    document.getElementById('hud-time-pw').textContent = FMRUtils.formatDuration(Math.max(0, elapsed));
  }

  /* ---------------------------------------------------------------
   * Pause / Resume / Photo / Stop
   * ------------------------------------------------------------- */
  function togglePause() {
    if (!state.isRunning) return;
    if (!state.isPaused) {
      state.isPaused = true;
      state.pauseStartedAt = Date.now();
      FMRGps.pauseBackgroundTracking();
      FMRUtils.toast('Recording paused.', 'warn');
    } else {
      state.isPaused = false;
      state.pausedAccum += Date.now() - state.pauseStartedAt;
      state.pauseStartedAt = null;
      FMRGps.startBackgroundTracking(state.distanceIntervalM, onPositionUpdate, onPositionError);
      FMRUtils.toast('Recording resumed.', null);
    }
    setPauseButtonIcon(state.isPaused);
  }

  function setPauseButtonIcon(paused) {
    const btn = document.getElementById('btn-pathway-pause');
    if (!btn) return;
    btn.innerHTML = paused ? '<i class="bi bi-play-fill"></i>' : '<i class="bi bi-pause-fill"></i>';
  }

  function capturePhoto() {
    if (!state.isRunning) return Promise.resolve();
    FMRUtils.showLoading('Capturing photo...');
    let base64;
    return FMRDb.getSetting('photoQuality', 70)
      .then((q) => FMRCamera.capturePhoto(q))
      .then((data) => {
        base64 = data;
        return FMRFolderManager.getDirectory(state.projectDir, 'photos', true);
      })
      .then((photosDir) => FMRCamera.nextFileName(state.project.id).then((fileName) =>
        FMRFolderManager.writeBase64File(photosDir, fileName, base64, 'image/jpeg').then(() => fileName)
      ))
      .then((fileName) => {
        const fix = state.lastRecordedPoint || {};
        return FMRDb.insertPhoto({
          projectId: state.project.id,
          trackId: null,
          filePath: `photos/${fileName}`,
          fileName,
          latitude: fix.latitude,
          longitude: fix.longitude,
          timestamp: new Date().toISOString(),
        });
      })
      .then(() => {
        appendPhotoThumb(base64);
        FMRUtils.vibrate(120);
        FMRUtils.hideLoading();
      })
      .catch((err) => {
        FMRUtils.hideLoading();
        FMRUtils.toast(err.message || 'Could not capture photo.', 'error');
      });
  }

  function appendPhotoThumb(base64) {
    const container = document.getElementById('pathway-photo-preview');
    if (!container) return;
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64}`;
    container.appendChild(img);
  }

  function stopPathway() {
    if (!state.isRunning) return Promise.resolve();
    FMRUtils.showLoading('Saving track...');
    FMRGps.stopBackgroundTracking();
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.isRunning = false;

    const elapsedMs = Date.now() - state.startTime - state.pausedAccum;
    const points = state.points;

    return FMRFolderManager.getDirectory(state.projectDir, 'Track', true)
      .then((trackDir) => {
        const geojson = FMRExportManager.pointsToGeoJSON(points, { projectName: state.project.projectName });
        const gpx = FMRExportManager.pointsToGPX(points, state.project.projectName);
        return Promise.all([
          FMRFolderManager.writeJSONFile(trackDir, 'track.json', points),
          FMRFolderManager.writeTextFile(trackDir, 'track.geojson', JSON.stringify(geojson, null, 2)),
          FMRFolderManager.writeTextFile(trackDir, 'track.gpx', gpx),
        ]);
      })
      .then(() => {
        const snapshotBase64 = FMRMap.generatePathSnapshotBase64(points);
        return FMRFolderManager.writeBase64File(state.projectDir, 'map_snapshot.png', snapshotBase64, 'image/png');
      })
      .then(() => {
        const summary = {
          projectName: state.project.projectName,
          folderName: state.project.folderName,
          totalDistanceMeters: Math.round(state.totalDistance),
          totalPoints: points.length,
          durationMs: elapsedMs,
          durationFormatted: FMRUtils.formatDuration(elapsedMs),
          startedAt: new Date(state.startTime).toISOString(),
          completedAt: new Date().toISOString(),
        };
        return FMRFolderManager.writeJSONFile(state.projectDir, 'summary.json', summary);
      })
      .then(() => FMRDb.updateProjectStatus(state.project.id, 'completed', Math.round(state.totalDistance)))
      .then(() => {
        if (state.mapBundle) FMRMap.destroyMap('map-container-pw');
        resetState();
        FMRUtils.hideLoading();
        FMRUtils.toast('Pathway survey saved.', null, 3500);
        global.FMRApp.navigate('dashboard');
      })
      .catch((err) => {
        FMRUtils.hideLoading();
        FMRUtils.toast(err.message || 'Could not save track.', 'error', 4000);
      });
  }

  global.FMRPathway = {
    handleSetupSubmit,
    togglePause,
    capturePhoto,
    stopPathway,
  };
})(window);
