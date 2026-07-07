/**
 * db.js
 * SQLite persistence layer for FMR Geotag.
 *
 * Uses `cordova-sqlite-storage` (window.sqlitePlugin) on-device, which
 * provides a real, file-backed SQLite database that survives app restarts
 * and works fully offline. When running outside Cordova (e.g. quick
 * desktop-browser preview during development) it transparently falls
 * back to an in-memory store with the exact same async API, so the rest
 * of the app never needs to know which backend is active.
 *
 * Schema:
 *   Projects   - one row per survey (segment or pathway)
 *   Segments   - one row per captured 50m segment
 *   Tracks     - one row per recorded GPS point in pathway mode
 *   Photos     - one row per captured photo (linked to segment or track)
 *   Settings   - simple key/value app settings
 *   SyncQueue  - pending export/sync actions (future server sync hook)
 */
(function (global) {
  'use strict';

  const DB_NAME = 'fmr_geotag.db';
  let db = null;
  let usingFallback = false;
  let fallbackStore = null;

  const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS Projects (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      projectName TEXT,
      barangay TEXT,
      municipality TEXT,
      province TEXT,
      roadName TEXT,
      surveyorName TEXT,
      remarks TEXT,
      folderName TEXT,
      folderPath TEXT,
      status TEXT DEFAULT 'in_progress',
      totalDistance REAL DEFAULT 0,
      createdAt TEXT,
      completedAt TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS Segments (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      segmentNumber INTEGER,
      latitude REAL,
      longitude REAL,
      elevation REAL,
      accuracy REAL,
      timestamp TEXT,
      photoPath TEXT,
      photoFileName TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS Tracks (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      seq INTEGER,
      latitude REAL,
      longitude REAL,
      altitude REAL,
      accuracy REAL,
      speed REAL,
      heading REAL,
      timestamp TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS Photos (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      segmentId TEXT,
      trackId TEXT,
      filePath TEXT,
      fileName TEXT,
      latitude REAL,
      longitude REAL,
      timestamp TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS Settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS SyncQueue (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      action TEXT,
      payload TEXT,
      createdAt TEXT,
      synced INTEGER DEFAULT 0
    )`
  ];

  /* ---------------------------------------------------------------
   * In-memory fallback (development/browser preview only)
   * ------------------------------------------------------------- */
  function createFallbackStore() {
    return { Projects: [], Segments: [], Tracks: [], Photos: [], Settings: [], SyncQueue: [] };
  }

  function fallbackExec(sql, params) {
    // Extremely small "just enough" SQL shim covering the queries this
    // file issues below (INSERT / SELECT / UPDATE / DELETE by id or
    // projectId). This is only ever used when the real sqlite plugin
    // is unavailable, so it does not need to be a full SQL engine.
    const table = (sql.match(/(?:INTO|FROM|UPDATE)\s+(\w+)/i) || [])[1];
    if (!table || !fallbackStore[table]) return { rows: { length: 0, item: () => ({}) } };

    if (/^\s*INSERT/i.test(sql)) {
      const cols = (sql.match(/\(([^)]+)\)\s*VALUES/i) || [])[1];
      const colNames = cols ? cols.split(',').map((c) => c.trim()) : [];
      const row = {};
      colNames.forEach((c, i) => { row[c] = params[i]; });
      fallbackStore[table].push(row);
      return { rows: { length: 0, item: () => ({}) }, insertId: row.id };
    }

    if (/^\s*SELECT/i.test(sql)) {
      let rows = fallbackStore[table].slice();
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch && params && params.length) {
        rows = rows.filter((r) => r[whereMatch[1]] === params[0]);
      }
      const orderMatch = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
      if (orderMatch) {
        const col = orderMatch[1];
        const dir = (orderMatch[2] || 'ASC').toUpperCase();
        rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'DESC' ? -1 : 1));
      }
      return { rows: { length: rows.length, item: (i) => rows[i] } };
    }

    if (/^\s*UPDATE/i.test(sql)) {
      const setClause = (sql.match(/SET\s+(.+?)\s+WHERE/i) || [])[1] || '';
      const setCols = setClause.split(',').map((s) => s.split('=')[0].trim());
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      const whereCol = whereMatch ? whereMatch[1] : null;
      const whereVal = params[params.length - 1];
      fallbackStore[table].forEach((row) => {
        if (!whereCol || row[whereCol] === whereVal) {
          setCols.forEach((c, i) => { row[c] = params[i]; });
        }
      });
      return { rows: { length: 0, item: () => ({}) } };
    }

    if (/^\s*DELETE/i.test(sql)) {
      const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
      if (whereMatch) {
        fallbackStore[table] = fallbackStore[table].filter((r) => r[whereMatch[1]] !== params[0]);
      } else {
        fallbackStore[table] = [];
      }
      return { rows: { length: 0, item: () => ({}) } };
    }

    return { rows: { length: 0, item: () => ({}) } };
  }

  /* ---------------------------------------------------------------
   * Core execute helper (works against either backend)
   * ------------------------------------------------------------- */
  function exec(sql, params) {
    params = params || [];
    return new Promise((resolve, reject) => {
      if (usingFallback) {
        try {
          resolve(fallbackExec(sql, params));
        } catch (e) {
          reject(e);
        }
        return;
      }
      db.transaction((tx) => {
        tx.executeSql(sql, params,
          (_tx, result) => resolve(result),
          (_tx, err) => { reject(err); return false; }
        );
      }, (err) => reject(err));
    });
  }

  /* ---------------------------------------------------------------
   * Init
   * ------------------------------------------------------------- */
  function init() {
    return new Promise((resolve, reject) => {
      if (global.sqlitePlugin && typeof global.sqlitePlugin.openDatabase === 'function') {
        // Real, on-device SQLite (persists to the app's private data dir).
        db = global.sqlitePlugin.openDatabase({
          name: DB_NAME,
          location: 'default'
        });
        usingFallback = false;
      } else {
        // No native plugin present (browser dev preview) - use fallback.
        console.warn('[FMR DB] cordova-sqlite-storage not found - using in-memory fallback store.');
        usingFallback = true;
        fallbackStore = createFallbackStore();
      }

      // Run schema creation sequentially.
      SCHEMA_STATEMENTS.reduce((p, stmt) => p.then(() => exec(stmt)), Promise.resolve())
        .then(resolve)
        .catch(reject);
    });
  }

  /* ---------------------------------------------------------------
   * Projects
   * ------------------------------------------------------------- */
  function createProject(project) {
    const now = new Date().toISOString();
    const id = project.id || FMRUtils.generateId('proj');
    return exec(
      `INSERT INTO Projects
        (id, type, projectName, barangay, municipality, province, roadName, surveyorName, remarks, folderName, folderPath, status, totalDistance, createdAt, completedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, project.type, project.projectName, project.barangay, project.municipality,
       project.province, project.roadName, project.surveyorName, project.remarks || '',
       project.folderName, project.folderPath, 'in_progress', 0, now, null]
    ).then(() => Object.assign({ id, createdAt: now, status: 'in_progress', totalDistance: 0 }, project));
  }

  function updateProjectStatus(projectId, status, totalDistance) {
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    return exec(
      `UPDATE Projects SET status = ?, totalDistance = ?, completedAt = ? WHERE id = ?`,
      [status, totalDistance || 0, completedAt, projectId]
    );
  }

  function getAllProjects() {
    return exec(`SELECT * FROM Projects ORDER BY createdAt DESC`).then(rowsToArray);
  }

  function getProject(projectId) {
    return exec(`SELECT * FROM Projects WHERE id = ?`, [projectId])
      .then((res) => (res.rows.length ? res.rows.item(0) : null));
  }

  function deleteProject(projectId) {
    return Promise.all([
      exec(`DELETE FROM Segments WHERE projectId = ?`, [projectId]),
      exec(`DELETE FROM Tracks WHERE projectId = ?`, [projectId]),
      exec(`DELETE FROM Photos WHERE projectId = ?`, [projectId]),
    ]).then(() => exec(`DELETE FROM Projects WHERE id = ?`, [projectId]));
  }

  /** Detects a likely duplicate project (same name + road within the same day). */
  function findPossibleDuplicate(projectName, roadName) {
    return getAllProjects().then((projects) => {
      const todayKey = new Date().toDateString();
      return projects.find((p) =>
        p.projectName === projectName &&
        p.roadName === roadName &&
        new Date(p.createdAt).toDateString() === todayKey
      ) || null;
    });
  }

  /* ---------------------------------------------------------------
   * Segments
   * ------------------------------------------------------------- */
  function insertSegment(segment) {
    const id = segment.id || FMRUtils.generateId('seg');
    return exec(
      `INSERT INTO Segments (id, projectId, segmentNumber, latitude, longitude, elevation, accuracy, timestamp, photoPath, photoFileName)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, segment.projectId, segment.segmentNumber, segment.latitude, segment.longitude,
       segment.elevation, segment.accuracy, segment.timestamp, segment.photoPath, segment.photoFileName]
    ).then(() => Object.assign({ id }, segment));
  }

  function getSegmentsForProject(projectId) {
    return exec(`SELECT * FROM Segments WHERE projectId = ? ORDER BY segmentNumber ASC`, [projectId])
      .then(rowsToArray);
  }

  /* ---------------------------------------------------------------
   * Tracks
   * ------------------------------------------------------------- */
  function insertTrackPoint(point) {
    const id = point.id || FMRUtils.generateId('trk');
    return exec(
      `INSERT INTO Tracks (id, projectId, seq, latitude, longitude, altitude, accuracy, speed, heading, timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, point.projectId, point.seq, point.latitude, point.longitude, point.altitude,
       point.accuracy, point.speed, point.heading, point.timestamp]
    ).then(() => Object.assign({ id }, point));
  }

  function getTrackPointsForProject(projectId) {
    return exec(`SELECT * FROM Tracks WHERE projectId = ? ORDER BY seq ASC`, [projectId])
      .then(rowsToArray);
  }

  /* ---------------------------------------------------------------
   * Photos
   * ------------------------------------------------------------- */
  function insertPhoto(photo) {
    const id = photo.id || FMRUtils.generateId('photo');
    return exec(
      `INSERT INTO Photos (id, projectId, segmentId, trackId, filePath, fileName, latitude, longitude, timestamp)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, photo.projectId, photo.segmentId || null, photo.trackId || null, photo.filePath,
       photo.fileName, photo.latitude, photo.longitude, photo.timestamp]
    ).then(() => Object.assign({ id }, photo));
  }

  function getPhotosForProject(projectId) {
    return exec(`SELECT * FROM Photos WHERE projectId = ? ORDER BY timestamp ASC`, [projectId])
      .then(rowsToArray);
  }

  /* ---------------------------------------------------------------
   * Settings
   * ------------------------------------------------------------- */
  function getSetting(key, defaultValue) {
    return exec(`SELECT value FROM Settings WHERE key = ?`, [key]).then((res) => {
      if (res.rows.length) {
        try { return JSON.parse(res.rows.item(0).value); }
        catch (e) { return res.rows.item(0).value; }
      }
      return defaultValue;
    });
  }

  function setSetting(key, value) {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    return exec(`SELECT key FROM Settings WHERE key = ?`, [key]).then((res) => {
      if (res.rows.length) {
        return exec(`UPDATE Settings SET value = ? WHERE key = ?`, [strValue, key]);
      }
      return exec(`INSERT INTO Settings (key, value) VALUES (?,?)`, [key, strValue]);
    });
  }

  function getAllSettings() {
    return exec(`SELECT * FROM Settings`).then(rowsToArray).then((rows) => {
      const obj = {};
      rows.forEach((r) => {
        try { obj[r.key] = JSON.parse(r.value); } catch (e) { obj[r.key] = r.value; }
      });
      return obj;
    });
  }

  /* ---------------------------------------------------------------
   * SyncQueue (reserved for future online sync; app is offline-only today)
   * ------------------------------------------------------------- */
  function enqueueSync(projectId, action, payload) {
    const id = FMRUtils.generateId('sync');
    return exec(
      `INSERT INTO SyncQueue (id, projectId, action, payload, createdAt, synced) VALUES (?,?,?,?,?,0)`,
      [id, projectId, action, JSON.stringify(payload || {}), new Date().toISOString()]
    );
  }

  function getPendingSync() {
    return exec(`SELECT * FROM SyncQueue WHERE synced = 0`).then(rowsToArray);
  }

  /* ---------------------------------------------------------------
   * Stats (for dashboard status bar)
   * ------------------------------------------------------------- */
  function getDashboardStats() {
    return Promise.all([
      exec(`SELECT COUNT(*) as c FROM Projects`),
      exec(`SELECT COUNT(*) as c FROM Segments`),
      exec(`SELECT COUNT(*) as c FROM Tracks`),
    ]).then(([p, s, t]) => ({
      projects: usingFallback ? fallbackStore.Projects.length : p.rows.item(0).c,
      segments: usingFallback ? fallbackStore.Segments.length : s.rows.item(0).c,
      tracks: usingFallback ? fallbackStore.Tracks.length : t.rows.item(0).c,
    }));
  }

  /* ---------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------- */
  function rowsToArray(res) {
    const arr = [];
    for (let i = 0; i < res.rows.length; i++) arr.push(res.rows.item(i));
    return arr;
  }

  global.FMRDb = {
    init,
    createProject,
    updateProjectStatus,
    getAllProjects,
    getProject,
    deleteProject,
    findPossibleDuplicate,
    insertSegment,
    getSegmentsForProject,
    insertTrackPoint,
    getTrackPointsForProject,
    insertPhoto,
    getPhotosForProject,
    getSetting,
    setSetting,
    getAllSettings,
    enqueueSync,
    getPendingSync,
    getDashboardStats,
  };
})(window);
