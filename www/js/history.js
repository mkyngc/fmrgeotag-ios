/**
 * history.js
 * Renders the "Previous Surveys" list + detail screens, and the project
 * picker used on the "Export Data" screen. Pure DOM rendering - no
 * business logic beyond reading from FMRDb and wiring up navigation.
 */
(function (global) {
  'use strict';

  function renderHistoryList() {
    const container = document.getElementById('history-list-container');
    container.innerHTML = '';
    return FMRDb.getAllProjects().then((projects) => {
      if (!projects.length) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="bi bi-inboxes"></i>
            <p>No surveys yet. Start a 50m or Pathway survey from the dashboard.</p>
          </div>`;
        return;
      }
      projects.forEach((p) => container.appendChild(buildSurveyListItem(p)));
    });
  }

  function buildSurveyListItem(project) {
    const div = document.createElement('div');
    div.className = 'survey-list-item';
    div.innerHTML = `
      <div>
        <span class="type-badge ${project.type}">${project.type === 'segment' ? '50m' : 'Pathway'}</span>
        <div class="title mt-1">${escapeHtml(project.projectName)}</div>
        <div class="meta">${escapeHtml(project.roadName)} • ${escapeHtml(project.barangay)}</div>
        <div class="meta">${FMRUtils.formatDateTime(project.createdAt)} • ${project.status === 'completed' ? 'Completed' : 'In progress'} • ${FMRUtils.formatMeters(project.totalDistance)}</div>
      </div>
      <i class="bi bi-chevron-right chev"></i>`;
    div.addEventListener('click', () => global.FMRApp.navigate('history-detail', { projectId: project.id }));
    return div;
  }

  function renderHistoryDetail(projectId) {
    const container = document.getElementById('history-detail-container');
    container.innerHTML = '<div class="text-center text-fmr-muted mt-4">Loading...</div>';
    return FMRExportManager.assembleProjectData(projectId).then(({ project, segments, tracks, photos }) => {
      const isSegment = project.type === 'segment';
      container.innerHTML = `
        <div class="gps-hud mb-3">
          <h5 class="mb-1">${escapeHtml(project.projectName)}</h5>
          <div class="text-fmr-muted mb-2">${escapeHtml(project.roadName)}, ${escapeHtml(project.barangay)}, ${escapeHtml(project.municipality)}, ${escapeHtml(project.province)}</div>
          <div class="hud-grid">
            <div class="hud-item"><div class="value">${FMRUtils.formatMeters(project.totalDistance)}</div><div class="unit">DISTANCE</div></div>
            <div class="hud-item"><div class="value">${isSegment ? segments.length : tracks.length}</div><div class="unit">${isSegment ? 'SEGMENTS' : 'GPS PTS'}</div></div>
            <div class="hud-item"><div class="value">${photos.length}</div><div class="unit">PHOTOS</div></div>
          </div>
        </div>
        <p class="text-fmr-muted mb-1"><strong>Surveyor:</strong> ${escapeHtml(project.surveyorName)}</p>
        <p class="text-fmr-muted mb-1"><strong>Started:</strong> ${FMRUtils.formatDateTime(project.createdAt)}</p>
        <p class="text-fmr-muted mb-3"><strong>Status:</strong> ${project.status === 'completed' ? 'Completed' : 'In progress'}</p>
        ${project.remarks ? `<p class="text-fmr-muted mb-3"><strong>Remarks:</strong> ${escapeHtml(project.remarks)}</p>` : ''}
        <div class="fmr-section-title">Photos</div>
        <div class="photo-thumb-grid" id="detail-photo-grid"></div>
        <button class="btn-fmr-outline mt-4" id="btn-export-this-project"><i class="bi bi-file-earmark-zip"></i> Export This Survey</button>
        <button class="btn-fmr-danger mt-2" id="btn-delete-this-project"><i class="bi bi-trash3"></i> Delete Survey</button>
      `;

      const photoGrid = document.getElementById('detail-photo-grid');
      if (!photos.length) {
        photoGrid.innerHTML = '<p class="text-fmr-muted">No photos captured.</p>';
      } else {
        photos.forEach((photo) => {
          const img = document.createElement('div');
          img.className = 'photo-placeholder';
          img.innerHTML = `<div class="settings-row"><div><div class="row-label">${escapeHtml(photo.fileName)}</div><div class="row-sub">${FMRUtils.formatDateTime(photo.timestamp)}</div></div></div>`;
          photoGrid.appendChild(img);
        });
      }

      document.getElementById('btn-export-this-project').addEventListener('click', () => {
        FMRUtils.showLoading('Building ZIP export...');
        FMRExportManager.exportZip(project.id)
          .then(() => { FMRUtils.hideLoading(); FMRUtils.toast('Exported to FMR_Geotag/exports/'); })
          .catch((err) => { FMRUtils.hideLoading(); FMRUtils.toast(err.message || 'Export failed.', 'error'); });
      });

      document.getElementById('btn-delete-this-project').addEventListener('click', () => {
        const proceed = global.confirm(`Delete "${project.projectName}"? This removes it from the app database (files on disk are kept).`);
        if (!proceed) return;
        FMRDb.deleteProject(project.id).then(() => {
          FMRUtils.toast('Survey deleted.');
          global.FMRApp.navigate('history');
        });
      });
    });
  }

  function renderExportProjectList() {
    const container = document.getElementById('export-project-list');
    container.innerHTML = '';
    return FMRDb.getAllProjects().then((projects) => {
      if (!projects.length) {
        container.innerHTML = `
          <div class="empty-state">
            <i class="bi bi-file-earmark-zip"></i>
            <p>No surveys available to export yet.</p>
          </div>`;
        return;
      }
      projects.forEach((p) => container.appendChild(buildExportListItem(p)));
    });
  }

  function buildExportListItem(project) {
    const div = document.createElement('div');
    div.className = 'survey-list-item';
    div.style.flexWrap = 'wrap';
    div.innerHTML = `
      <div style="flex:1 0 100%">
        <span class="type-badge ${project.type}">${project.type === 'segment' ? '50m' : 'Pathway'}</span>
        <div class="title mt-1">${escapeHtml(project.projectName)}</div>
        <div class="meta">${escapeHtml(project.roadName)} • ${FMRUtils.formatDateTime(project.createdAt)}</div>
      </div>
      <div class="d-flex gap-2 mt-2" style="flex:1 0 100%">
        <button class="btn btn-sm btn-fmr-outline flex-fill" data-fmt="zip">ZIP</button>
        <button class="btn btn-sm btn-fmr-outline flex-fill" data-fmt="json">JSON</button>
        <button class="btn btn-sm btn-fmr-outline flex-fill" data-fmt="csv">CSV</button>
        <button class="btn btn-sm btn-fmr-outline flex-fill" data-fmt="gpx">GPX</button>
        <button class="btn btn-sm btn-fmr-outline flex-fill" data-fmt="geojson">GeoJSON</button>
      </div>`;

    div.querySelectorAll('button[data-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => runExport(project.id, btn.dataset.fmt));
    });
    return div;
  }

  function runExport(projectId, format) {
    const exporters = {
      zip: FMRExportManager.exportZip,
      json: FMRExportManager.exportJSON,
      csv: FMRExportManager.exportCSV,
      gpx: FMRExportManager.exportGPX,
      geojson: FMRExportManager.exportGeoJSON,
    };
    FMRUtils.showLoading(`Exporting ${format.toUpperCase()}...`);
    exporters[format](projectId)
      .then(() => { FMRUtils.hideLoading(); FMRUtils.toast(`${format.toUpperCase()} saved to FMR_Geotag/exports/`); })
      .catch((err) => { FMRUtils.hideLoading(); FMRUtils.toast(err.message || 'Export failed.', 'error', 4000); });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  global.FMRHistory = { renderHistoryList, renderHistoryDetail, renderExportProjectList };
})(window);
