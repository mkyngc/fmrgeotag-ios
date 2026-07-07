/**
 * survey50.js
 * Implements "50 Meter Segment Mode": the surveyor walks in 50m
 * increments (4 segments = 200m total), capturing a geotagged photo at
 * each 50m mark. Distance is accumulated from cumulative GPS deltas
 * (not straight-line start-to-current) so it tracks the real walked
 * distance along a winding road.
 */
(function (global) {
  'use strict';

  const SEGMENT_LENGTH_M = 50;
  const TOTAL_SEGMENTS = 4;

  const state = {
    project: null,
    projectDir: null,
    segmentDirs: {},
    watchHandle: null,
    lastPoint: null,
    distanceSinceSegmentStart: 0,
    currentSegment: 1,
    awaitingCapture: false,
    mapBundle: null,
    lastFix: null,
  };

  function resetState() {
    state.project = null;
    state.projectDir = null;
    state.segmentDirs = {};
    state.watchHandle = null;
    state.lastPoint = null;
    state.distanceSinceSegmentStart = 0;
    state.currentSegment = 1;
    state.awaitingCapture = false;
    state.mapBundle = null;
    state.lastFix = null;
  }

  /* ---------------------------------------------------------------
   * Setup -> Start
   * ------------------------------------------------------------- */
  function handleSetupSubmit(formData) {
    FMRUtils.showLoading('Checking for duplicates...');
    return FMRDb.findPossibleDuplicate(formData.projectName, formData.roadName)
      .then((dup) => {
        if (dup) {
          FMRUtils.hideLoading();
          return Promise.reject(new Error(
            `A survey for "${formData.projectName}" on "${formData.roadName}" was already started today. Please confirm this isn't a duplicate before proceeding.`
          ));
        }
        return startSurvey(formData);
      });
  }

  function startSurvey(formData) {
    FMRUtils.showLoading('Creating project folder...');
    const folderName = FMRUtils.buildProjectFolderName(formData.projectName);

    return FMRFolderManager.createProjectFolder(folderName)
      .then((dirEntry) => {
        state.projectDir = dirEntry;
        return FMRDb.createProject({
          type: 'segment',
          projectName: formData.projectName,
          barangay: formData.barangay,
          municipality: formData.municipality,
          province: formData.province,
          roadName: formData.roadName,
          surveyorName: formData.surveyorName,
          remarks: formData.remarks,
          folderName,
          folderPath: FMRFolderManager.getFullPath(dirEntry),
        });
      })
      .then((project) => {
        state.project = project;
        resetProgressUI();
        return FMRGps.getCurrentPosition();
      })
      .then((pos) => {
        state.lastPoint = pos;
        state.lastFix = pos;
        state.mapBundle = FMRMap.initMap('map-container-50', { center: [pos.latitude, pos.longitude], zoom: 18 });
        FMRMap.updateCurrentLocation(state.mapBundle, pos.latitude, pos.longitude, pos.accuracy);
        return FMRGps.watch(onPositionUpdate, onPositionError);
      })
      .then((watchHandle) => {
        state.watchHandle = watchHandle;
        FMRUtils.hideLoading();
        FMRUtils.toast('Survey started. Walk toward Segment 1.', null);
      })
      .catch((err) => {
        FMRUtils.hideLoading();
        FMRUtils.toast(err.message || 'Could not start survey.', 'error', 4000);
        throw err;
      });
  }

  /* ---------------------------------------------------------------
   * Live GPS handling
   * ------------------------------------------------------------- */
  function onPositionUpdate(pos) {
    state.lastFix = pos;
    updateGpsHud(pos);

    if (state.mapBundle) {
      FMRMap.updateCurrentLocation(state.mapBundle, pos.latitude, pos.longitude, pos.accuracy);
      FMRMap.appendPathPoint(state.mapBundle, pos.latitude, pos.longitude);
    }

    if (state.awaitingCapture) return; // holding at the mark until photo captured

    if (state.lastPoint) {
      const delta = FMRUtils.haversineDistance(state.lastPoint, pos);
      // Ignore GPS noise jitter under ~1m to avoid inflating distance while stationary.
      if (delta > 1) {
        state.distanceSinceSegmentStart += delta;
        state.lastPoint = pos;
      }
    } else {
      state.lastPoint = pos;
    }

    updateDistanceUI();

    if (state.distanceSinceSegmentStart >= SEGMENT_LENGTH_M) {
      state.awaitingCapture = true;
      FMRUtils.vibrate(200);
      FMRUtils.toast(`Segment ${state.currentSegment} reached. Capture a photo.`, 'warn', 4000);
      document.getElementById('current-segment-hint').textContent = 'Target reached — capture photo now.';
    }
  }

  function onPositionError(err) {
    document.getElementById('gps-status-text-50').textContent = err.message;
    document.getElementById('gps-dot-50').className = 'gps-signal-dot poor';
  }

  function updateGpsHud(pos) {
    const dot = document.getElementById('gps-dot-50');
    const statusText = document.getElementById('gps-status-text-50');
    const accBadge = document.getElementById('accuracy-badge-50');
    const cls = FMRUtils.accuracyClass(pos.accuracy);
    if (dot) dot.className = `gps-signal-dot ${cls}`;
    if (statusText) statusText.textContent = cls === 'good' ? 'GPS Locked' : cls === 'fair' ? 'GPS Fair' : 'GPS Weak';
    if (accBadge) {
      accBadge.textContent = `±${(pos.accuracy || 0).toFixed(1)} m`;
      accBadge.className = `badge badge-accuracy-${cls}`;
    }
    const elev = document.getElementById('hud-elevation-50');
    if (elev) elev.textContent = pos.altitude != null ? pos.altitude.toFixed(1) : '--';
  }

  function updateDistanceUI() {
    const distEl = document.getElementById('hud-distance-50');
    const remEl = document.getElementById('hud-remaining-50');
    if (distEl) distEl.textContent = state.distanceSinceSegmentStart.toFixed(1);
    if (remEl) remEl.textContent = Math.max(0, SEGMENT_LENGTH_M - state.distanceSinceSegmentStart).toFixed(1);
  }

  function resetProgressUI() {
    document.querySelectorAll('#segment-progress-bar .seg-pill').forEach((el, idx) => {
      el.className = 'seg-pill' + (idx === 0 ? ' active' : '');
    });
    document.getElementById('current-segment-label').textContent = `Segment 1 of ${TOTAL_SEGMENTS}`;
    document.getElementById('current-segment-hint').textContent = 'Walk 50 meters, then capture a photo.';
    document.getElementById('segment-photo-preview').innerHTML = '';
    document.getElementById('hud-distance-50').textContent = '0.0';
    document.getElementById('hud-remaining-50').textContent = '50.0';
  }

  /* ---------------------------------------------------------------
   * Capture flow
   * ------------------------------------------------------------- */
  function captureCurrentSegment() {
    if (!state.awaitingCapture) {
      FMRUtils.toast('Keep walking — you have not reached the 50m mark yet.', 'warn');
      return Promise.resolve();
    }

    FMRUtils.showLoading('Capturing photo...');
    let photoBase64;
    let qualitySetting;

    return FMRDb.getSetting('photoQuality', 70)
      .then((q) => { qualitySetting = q; return FMRCamera.capturePhoto(q); })
      .then((base64) => {
        photoBase64 = base64;
        return FMRFolderManager.createSegmentFolder(state.projectDir, state.currentSegment);
      })
      .then((segDir) => {
        state.segmentDirs[state.currentSegment] = segDir;
        return FMRFolderManager.writeBase64File(segDir, 'photo.jpg', photoBase64, 'image/jpeg')
          .then(() => {
            const fix = state.lastFix;
            const gpsData = {
              latitude: fix.latitude,
              longitude: fix.longitude,
              elevation: fix.altitude,
              accuracy: fix.accuracy,
              timestamp: fix.timestamp,
              segment: state.currentSegment,
            };
            const metadata = {
              projectName: state.project.projectName,
              barangay: state.project.barangay,
              municipality: state.project.municipality,
              province: state.project.province,
              roadName: state.project.roadName,
              surveyorName: state.project.surveyorName,
              remarks: state.project.remarks,
              segmentNumber: state.currentSegment,
              segmentLengthMeters: SEGMENT_LENGTH_M,
              capturedAt: fix.timestamp,
            };
            return Promise.all([
              FMRFolderManager.writeJSONFile(segDir, 'gps.json', gpsData),
              FMRFolderManager.writeJSONFile(segDir, 'metadata.json', metadata),
            ]).then(() => gpsData);
          });
      })
      .then((gpsData) => FMRDb.insertSegment({
        projectId: state.project.id,
        segmentNumber: state.currentSegment,
        latitude: gpsData.latitude,
        longitude: gpsData.longitude,
        elevation: gpsData.elevation,
        accuracy: gpsData.accuracy,
        timestamp: gpsData.timestamp,
        photoPath: `Segment_${state.currentSegment}/photo.jpg`,
        photoFileName: 'photo.jpg',
      }).then(() => FMRDb.insertPhoto({
        projectId: state.project.id,
        segmentId: null,
        filePath: `Segment_${state.currentSegment}/photo.jpg`,
        fileName: 'photo.jpg',
        latitude: gpsData.latitude,
        longitude: gpsData.longitude,
        timestamp: gpsData.timestamp,
      })))
      .then(() => {
        if (state.mapBundle) FMRMap.addSegmentMarker(state.mapBundle, state.lastFix.latitude, state.lastFix.longitude, state.currentSegment);
        appendPhotoThumb('segment-photo-preview', photoBase64);
        markSegmentDone(state.currentSegment);
        FMRUtils.vibrate(120);
        FMRUtils.hideLoading();

        if (state.currentSegment >= TOTAL_SEGMENTS) {
          return completeSurvey();
        }
        advanceToNextSegment();
      })
      .catch((err) => {
        FMRUtils.hideLoading();
        FMRUtils.toast(err.message || 'Could not capture segment photo.', 'error', 4000);
      });
  }

  function advanceToNextSegment() {
    state.currentSegment += 1;
    state.distanceSinceSegmentStart = 0;
    state.awaitingCapture = false;
    state.lastPoint = state.lastFix;

    document.getElementById('current-segment-label').textContent = `Segment ${state.currentSegment} of ${TOTAL_SEGMENTS}`;
    document.getElementById('current-segment-hint').textContent = 'Walk 50 meters, then capture a photo.';
    updateDistanceUI();

    document.querySelectorAll('#segment-progress-bar .seg-pill').forEach((el) => {
      const segNum = Number(el.dataset.seg);
      el.classList.toggle('active', segNum === state.currentSegment);
    });

    FMRUtils.toast(`Continue to Segment ${state.currentSegment}.`, null);
  }

  function markSegmentDone(segNum) {
    const pill = document.querySelector(`#segment-progress-bar .seg-pill[data-seg="${segNum}"]`);
    if (pill) { pill.classList.remove('active'); pill.classList.add('done'); }
  }

  function appendPhotoThumb(containerId, base64) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64}`;
    container.appendChild(img);
  }

  function completeSurvey() {
    FMRUtils.showLoading('Finishing survey...');
    const summary = {
      projectName: state.project.projectName,
      folderName: state.project.folderName,
      totalSegments: TOTAL_SEGMENTS,
      totalDistanceMeters: TOTAL_SEGMENTS * SEGMENT_LENGTH_M,
      completedAt: new Date().toISOString(),
    };
    return FMRFolderManager.writeJSONFile(state.projectDir, 'metadata.json', summary)
      .then(() => FMRDb.updateProjectStatus(state.project.id, 'completed', TOTAL_SEGMENTS * SEGMENT_LENGTH_M))
      .then(() => {
        stopSurvey();
        FMRUtils.hideLoading();
        FMRUtils.toast('Survey complete! All 4 segments recorded.', null, 3500);
        global.FMRApp.navigate('dashboard');
      });
  }

  function abortSurvey() {
    stopSurvey();
    FMRUtils.toast('Survey aborted.', 'warn');
    global.FMRApp.navigate('dashboard');
  }

  function stopSurvey() {
    if (state.watchHandle !== null) FMRGps.clearWatch();
    if (state.mapBundle) FMRMap.destroyMap('map-container-50');
    resetState();
  }

  global.FMRSurvey50 = {
    handleSetupSubmit,
    captureCurrentSegment,
    abortSurvey,
    SEGMENT_LENGTH_M,
    TOTAL_SEGMENTS,
  };
})(window);
