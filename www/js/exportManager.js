/**
 * exportManager.js
 * Builds shareable exports of survey data: ZIP archive, JSON, CSV, GPX,
 * and GeoJSON. ZIP creation uses the bundled JSZip library rather than
 * `cordova-plugin-zip`, because that Cordova plugin only implements
 * *unzip* (extraction) - there is no maintained Cordova plugin that
 * performs on-device ZIP *creation*. JSZip is a pure-JS library with no
 * network dependency, so the "fully offline" requirement still holds;
 * `cordova-plugin-zip` remains installed/available for any future
 * on-device extraction needs (e.g. importing offline map tile packs).
 *
 * The resulting .zip / .csv / .gpx / .geojson / .json files are written
 * into FMR_Geotag/exports/ on the device using folderCreator.js, so
 * they are visible via any file manager app or USB file transfer.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
   * Format converters (pure functions, reusable, no I/O)
   * ------------------------------------------------------------- */

  function pointsToGeoJSON(points, properties) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: properties || {},
          geometry: {
            type: 'LineString',
            coordinates: points.map((p) => [p.longitude, p.latitude, p.altitude || 0]),
          },
        },
        ...points.map((p, i) => ({
          type: 'Feature',
          properties: { seq: p.seq != null ? p.seq : i, timestamp: p.timestamp, speed: p.speed, heading: p.heading, accuracy: p.accuracy },
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude, p.altitude || 0] },
        })),
      ],
    };
  }

  function pointsToGPX(points, trackName) {
    const trkpts = points.map((p) => {
      const ele = p.altitude != null ? `<ele>${p.altitude}</ele>` : '';
      const time = p.timestamp ? `<time>${p.timestamp}</time>` : '';
      return `      <trkpt lat="${p.latitude}" lon="${p.longitude}">${ele}${time}</trkpt>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FMR Geotag" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(trackName || 'FMR Track')}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
  }

  function segmentsToGeoJSON(segments, project) {
    return {
      type: 'FeatureCollection',
      features: segments.map((s) => ({
        type: 'Feature',
        properties: {
          segmentNumber: s.segmentNumber,
          projectName: project.projectName,
          roadName: project.roadName,
          accuracy: s.accuracy,
          elevation: s.elevation,
          timestamp: s.timestamp,
        },
        geometry: { type: 'Point', coordinates: [s.longitude, s.latitude, s.elevation || 0] },
      })),
    };
  }

  function segmentsToGPX(segments, project) {
    const wpts = segments.map((s) => {
      const ele = s.elevation != null ? `<ele>${s.elevation}</ele>` : '';
      const time = s.timestamp ? `<time>${s.timestamp}</time>` : '';
      return `  <wpt lat="${s.latitude}" lon="${s.longitude}">${ele}${time}<name>Segment ${s.segmentNumber}</name></wpt>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FMR Geotag" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
  }

  function toCSV(headers, rows) {
    const escapeCell = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach((row) => lines.push(headers.map((h) => escapeCell(row[h])).join(',')));
    return lines.join('\n');
  }

  function escapeXml(str) {
    return String(str || '').replace(/[<>&'"]/g, (c) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[c]));
  }

  /* ---------------------------------------------------------------
   * Data assembly per project (from SQLite - authoritative source)
   * ------------------------------------------------------------- */

  function assembleProjectData(projectId) {
    return Promise.all([
      FMRDb.getProject(projectId),
      FMRDb.getSegmentsForProject(projectId),
      FMRDb.getTrackPointsForProject(projectId),
      FMRDb.getPhotosForProject(projectId),
    ]).then(([project, segments, tracks, photos]) => ({ project, segments, tracks, photos }));
  }

  /* ---------------------------------------------------------------
   * Individual-format exports (write a single file to exports/)
   * ------------------------------------------------------------- */

  function getExportsDir() {
    return FMRFolderManager.resolveRoot().then((root) => FMRFolderManager.getDirectory(root, 'exports', true));
  }

  function exportJSON(projectId) {
    return assembleProjectData(projectId).then((data) => getExportsDir().then((dir) =>
      FMRFolderManager.writeJSONFile(dir, `${data.project.folderName}.json`, data).then(() => data)
    ));
  }

  function exportCSV(projectId) {
    return assembleProjectData(projectId).then(({ project, segments, tracks }) => {
      let headers, rows;
      if (project.type === 'segment') {
        headers = ['segmentNumber', 'latitude', 'longitude', 'elevation', 'accuracy', 'timestamp'];
        rows = segments;
      } else {
        headers = ['seq', 'latitude', 'longitude', 'altitude', 'accuracy', 'speed', 'heading', 'timestamp'];
        rows = tracks;
      }
      const csv = toCSV(headers, rows);
      return getExportsDir().then((dir) => FMRFolderManager.writeTextFile(dir, `${project.folderName}.csv`, csv));
    });
  }

  function exportGPX(projectId) {
    return assembleProjectData(projectId).then(({ project, segments, tracks }) => {
      const gpx = project.type === 'segment'
        ? segmentsToGPX(segments, project)
        : pointsToGPX(tracks, project.projectName);
      return getExportsDir().then((dir) => FMRFolderManager.writeTextFile(dir, `${project.folderName}.gpx`, gpx));
    });
  }

  function exportGeoJSON(projectId) {
    return assembleProjectData(projectId).then(({ project, segments, tracks }) => {
      const geojson = project.type === 'segment'
        ? segmentsToGeoJSON(segments, project)
        : pointsToGeoJSON(tracks, { projectName: project.projectName });
      return getExportsDir().then((dir) =>
        FMRFolderManager.writeTextFile(dir, `${project.folderName}.geojson`, JSON.stringify(geojson, null, 2)));
    });
  }

  /* ---------------------------------------------------------------
   * Full ZIP export (photos + gps + metadata + json + csv + folders)
   * ------------------------------------------------------------- */

  function exportZip(projectId) {
    const zip = new JSZip();
    let assembled;

    return assembleProjectData(projectId)
      .then((data) => {
        assembled = data;
        const { project, segments, tracks, photos } = data;
        const root = zip.folder(project.folderName);

        // Top-level JSON / CSV summaries
        root.file('data.json', JSON.stringify(data, null, 2));
        if (project.type === 'segment') {
          root.file('segments.csv', toCSV(
            ['segmentNumber', 'latitude', 'longitude', 'elevation', 'accuracy', 'timestamp'], segments));
          root.file('segments.geojson', JSON.stringify(segmentsToGeoJSON(segments, project), null, 2));
          root.file('segments.gpx', segmentsToGPX(segments, project));
        } else {
          root.file('track.csv', toCSV(
            ['seq', 'latitude', 'longitude', 'altitude', 'accuracy', 'speed', 'heading', 'timestamp'], tracks));
          root.file('track.geojson', JSON.stringify(pointsToGeoJSON(tracks, { projectName: project.projectName }), null, 2));
          root.file('track.gpx', pointsToGPX(tracks, project.projectName));
        }

        // Recreate the on-disk folder structure (Segment_N/ or Track+photos/)
        // by reading files back from the actual project directory.
        return FMRFolderManager.resolveRoot();
      })
      .then((rootDir) => FMRFolderManager.getDirectory(rootDir, assembled.project.folderName, false))
      .then((projectDir) => addDirToZip(zip.folder(assembled.project.folderName), projectDir))
      .catch((err) => {
        // If the physical folder can't be read for some reason, the ZIP
        // still contains the authoritative DB-derived JSON/CSV/GPX above.
        console.warn('[Export] Could not fully read project folder from disk:', err);
      })
      .then(() => zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
      .then((blob) => blobToBase64(blob))
      .then((base64) => getExportsDir().then((dir) =>
        FMRFolderManager.writeBase64File(dir, `${assembled.project.folderName}.zip`, base64, 'application/zip')
      ))
      .then((fileEntry) => ({ fileEntry, project: assembled.project }));
  }

  /** Recursively copies a real (or virtual) DirectoryEntry into a JSZip folder node. */
  function addDirToZip(zipFolder, dirEntry) {
    return FMRFolderManager.walkAsync(dirEntry).then((node) => addWalkedNodeToZip(zipFolder, node));
  }

  function addWalkedNodeToZip(zipFolder, node) {
    const filePromises = (node.files || []).map((f) => readFileEntryAsBase64(f).then((b64) => {
      if (b64 != null) zipFolder.file(f.name, b64, { base64: true });
    }));
    const dirPromises = (node.dirs || []).map((d) => addWalkedNodeToZip(zipFolder.folder(d.name), d));
    return Promise.all([...filePromises, ...dirPromises]);
  }

  function readFileEntryAsBase64(fileRef) {
    // Virtual FS case: content already stored directly (string or base64).
    if (fileRef.content !== undefined) {
      if (fileRef.isBase64) return Promise.resolve(fileRef.content);
      return Promise.resolve(btoa(unescape(encodeURIComponent(fileRef.content || ''))));
    }
    // Real Cordova FileEntry case.
    const entry = fileRef.entry;
    if (!entry) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      entry.file((file) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result || '';
          const base64 = result.split(',')[1] || '';
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }, reject);
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  global.FMRExportManager = {
    pointsToGeoJSON,
    pointsToGPX,
    segmentsToGeoJSON,
    segmentsToGPX,
    toCSV,
    assembleProjectData,
    exportJSON,
    exportCSV,
    exportGPX,
    exportGeoJSON,
    exportZip,
    getExportsDir,
  };
})(window);
