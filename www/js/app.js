/**
 * app.js
 * Application shell: screen router, header management, dashboard stats,
 * form bindings, network status indicator, and startup sequence
 * (including crash-recovery detection for surveys left "in_progress").
 */
(function (global) {
  'use strict';

  const SCREENS = {
    dashboard: { title: 'FMR Geotag', sub: 'Offline Road Survey Tool', showBack: false },
    'survey50-setup': { title: 'New 50m Survey', sub: '4 segments x 50 meters', showBack: true, back: 'dashboard' },
    'survey50-active': { title: 'Recording Segments', sub: '', showBack: true, back: 'confirm-abort-50', hideBackDuringRecording: true },
    'pathway-setup': { title: 'New Pathway Survey', sub: 'Continuous GPS track', showBack: true, back: 'dashboard' },
    'pathway-active': { title: 'Recording Pathway', sub: '', showBack: true, back: 'confirm-stop-pathway' },
    history: { title: 'Previous Surveys', sub: '', showBack: true, back: 'dashboard' },
    'history-detail': { title: 'Survey Details', sub: '', showBack: true, back: 'history' },
    export: { title: 'Export Data', sub: 'ZIP / JSON / CSV / GPX / GeoJSON', showBack: true, back: 'dashboard' },
    settings: { title: 'Settings', sub: '', showBack: true, back: 'dashboard' },
    about: { title: 'About', sub: '', showBack: true, back: 'dashboard' },
  };

  let currentScreen = 'dashboard';
  let currentParams = {};

  /* ---------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------- */
  function navigate(screenId, params) {
    params = params || {};

    // Guard: leaving an active recording screen without using its own
    // Stop/Abort control should still be possible via header back button,
    // but we route it through the same abort/stop handlers for safety.
    if (currentScreen === 'survey50-active' && screenId !== 'survey50-active') {
      FMRSurvey50.abortSurvey();
      return; // abortSurvey() itself calls navigate('dashboard')
    }
    if (currentScreen === 'pathway-active' && screenId !== 'pathway-active') {
      const proceed = global.confirm('Stop and save the current pathway recording?');
      if (!proceed) return;
      FMRPathway.stopPathway();
      return;
    }

    document.querySelectorAll('.screen').forEach((el) => el.classList.add('d-none'));
    const target = document.getElementById(`screen-${screenId}`);
    if (!target) { console.error('Unknown screen', screenId); return; }
    target.classList.remove('d-none');

    const meta = SCREENS[screenId] || { title: 'FMR Geotag', sub: '', showBack: false };
    document.getElementById('header-title').textContent = meta.title;
    document.getElementById('header-sub').textContent = meta.sub || '';
    document.getElementById('btn-back').classList.toggle('d-none', !meta.showBack);

    currentScreen = screenId;
    currentParams = params;

    runScreenEnterHook(screenId, params);
  }

  function runScreenEnterHook(screenId, params) {
    switch (screenId) {
      case 'dashboard':
        refreshDashboardStats();
        break;
      case 'history':
        FMRHistory.renderHistoryList();
        break;
      case 'history-detail':
        FMRHistory.renderHistoryDetail(params.projectId);
        break;
      case 'export':
        FMRHistory.renderExportProjectList();
        break;
      case 'settings':
        FMRSettings.loadIntoUI();
        break;
      default:
        break;
    }
  }

  function goBack() {
    const meta = SCREENS[currentScreen];
    navigate((meta && meta.back) || 'dashboard');
  }

  /* ---------------------------------------------------------------
   * Dashboard
   * ------------------------------------------------------------- */
  function refreshDashboardStats() {
    FMRDb.getDashboardStats().then((stats) => {
      document.getElementById('stat-projects').textContent = stats.projects;
      document.getElementById('stat-segments').textContent = stats.segments;
      document.getElementById('stat-tracks').textContent = stats.tracks;
    });
    estimateStorageUsed().then((bytes) => {
      document.getElementById('stat-storage').textContent = FMRUtils.formatBytes(bytes);
    });
  }

  function estimateStorageUsed() {
    // Rough estimate: count of photos * average compressed size. A precise
    // on-disk size would require walking every project folder; this keeps
    // the dashboard responsive while still giving the surveyor a useful signal.
    return FMRDb.getAllProjects().then((projects) => {
      const totalSegments = projects.reduce((sum) => sum, 0);
      return Promise.all(projects.map((p) => FMRDb.getPhotosForProject(p.id))).then((photoLists) => {
        const totalPhotos = photoLists.reduce((sum, list) => sum + list.length, 0);
        return totalPhotos * 350 * 1024; // ~350KB average compressed JPEG
      });
    });
  }

  /* ---------------------------------------------------------------
   * Form bindings
   * ------------------------------------------------------------- */
  function bindForms() {
    document.getElementById('form-survey50-setup').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      FMRSurvey50.handleSetupSubmit(data).then(() => navigate('survey50-active')).catch(() => {});
    });

    document.getElementById('form-pathway-setup').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      FMRPathway.handleSetupSubmit(data).then(() => navigate('pathway-active')).catch(() => {});
    });

    document.getElementById('btn-capture-segment').addEventListener('click', () => FMRSurvey50.captureCurrentSegment());
    document.getElementById('btn-abort-survey50').addEventListener('click', () => {
      if (global.confirm('Abort this survey? Segments already captured will be kept, but the survey will be marked incomplete.')) {
        FMRSurvey50.abortSurvey();
      }
    });

    document.getElementById('btn-pathway-pause').addEventListener('click', () => FMRPathway.togglePause());
    document.getElementById('btn-pathway-photo').addEventListener('click', () => FMRPathway.capturePhoto());
    document.getElementById('btn-pathway-stop').addEventListener('click', () => {
      if (global.confirm('Stop recording and save this pathway survey?')) {
        FMRPathway.stopPathway();
      }
    });
  }

  function bindDashboardCards() {
    document.querySelectorAll('[data-nav]').forEach((card) => {
      card.addEventListener('click', () => navigate(card.dataset.nav));
    });
  }

  function bindHeader() {
    document.getElementById('btn-back').addEventListener('click', goBack);
    document.getElementById('btn-network-indicator').addEventListener('click', () => {
      FMRUtils.toast('FMR Geotag works fully offline. Network is not required.', null, 3000);
    });
  }

  /* ---------------------------------------------------------------
   * Network status indicator (informational only - app never requires it)
   * ------------------------------------------------------------- */
  function initNetworkIndicator() {
    const icon = document.querySelector('#btn-network-indicator i');
    const update = () => {
      const online = navigator.onLine;
      if (icon) icon.className = online ? 'bi bi-wifi' : 'bi bi-wifi-off';
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ---------------------------------------------------------------
   * Crash recovery: detect projects left "in_progress" from a prior session
   * ------------------------------------------------------------- */
  function checkForUnfinishedSurveys() {
    return FMRDb.getAllProjects().then((projects) => {
      const unfinished = projects.filter((p) => p.status === 'in_progress');
      if (unfinished.length) {
        FMRUtils.toast(
          `${unfinished.length} survey(s) were left in progress. Data captured so far is safely stored - view them under Previous Surveys.`,
          'warn', 5000
        );
      }
    });
  }

  /* ---------------------------------------------------------------
   * Startup
   * ------------------------------------------------------------- */
  function init() {
    // Native chrome (no-ops harmlessly when running outside Cordova).
    if (global.StatusBar) {
      StatusBar.styleLightContent();
      StatusBar.backgroundColorByHexString('#1b5e20');
    }

    FMRUtils.showLoading('Starting FMR Geotag...');

    FMRDb.init()
      .then(() => FMRSettings.loadIntoUI())
      .then(() => {
        FMRSettings.bindHandlers();
        bindForms();
        bindDashboardCards();
        bindHeader();
        initNetworkIndicator();
        navigate('dashboard');
        return checkForUnfinishedSurveys();
      })
      .then(() => {
        FMRUtils.hideLoading();
        if (global.navigator.splashscreen) {
          navigator.splashscreen.hide();
        }
      })
      .catch((err) => {
        FMRUtils.hideLoading();
        console.error('[FMR Init Error]', err);
        FMRUtils.toast('Startup error: ' + (err.message || err), 'error', 6000);
      });
  }

  global.FMRApp = { navigate, goBack };

  FMRUtils.onReady(init);
})(window);
