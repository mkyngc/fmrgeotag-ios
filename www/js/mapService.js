/**
 * mapService.js
 * Offline mapping layer built on Leaflet (bundled locally under
 * www/lib/leaflet - no CDN, no network access required).
 *
 * Offline tiles: Leaflet's `L.tileLayer` is pointed at a local folder of
 * pre-downloaded XYZ tiles (e.g. produced with MOBAC / QGIS and copied
 * onto the device under the "Offline Map Folder" configured in
 * Settings). If no local tile set is found, the map still renders with
 * a plain grid background plus the live GPS marker and recorded
 * path/segment markers, so the app remains fully usable without any
 * pre-cached imagery.
 */
(function (global) {
  'use strict';

  const DEFAULT_CENTER = [12.8797, 121.7740]; // Philippines centroid fallback
  const activeMaps = {};

  /** A minimal Leaflet layer that renders a neutral grid instead of tiles. */
  const GridFallbackLayer = global.L.GridLayer.extend({
    createTile: function (coords) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');
      ctx.fillStyle = '#dfe9df';
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.strokeStyle = '#c8d6c8';
      ctx.strokeRect(0, 0, size.x, size.y);
      return tile;
    }
  });

  /**
   * Initializes a Leaflet map inside the given container element id.
   * Returns the map instance plus helper layer groups for path/markers.
   */
  function initMap(containerId, options) {
    options = options || {};
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Map container #${containerId} not found`);

    // Destroy a previous instance bound to this container, if any (screen re-entry).
    if (activeMaps[containerId]) {
      activeMaps[containerId].map.remove();
      delete activeMaps[containerId];
    }

    const map = global.L.map(containerId, {
      zoomControl: true,
      attributionControl: false,
    }).setView(options.center || DEFAULT_CENTER, options.zoom || 17);

    attachTileLayer(map, options.offlineTileFolder);

    const pathLayer = global.L.polyline([], { color: '#2e7d32', weight: 5, opacity: 0.9 }).addTo(map);
    const markersLayer = global.L.layerGroup().addTo(map);
    let currentLocationMarker = null;

    const bundle = { map, pathLayer, markersLayer, getCurrentLocationMarker: () => currentLocationMarker };
    activeMaps[containerId] = bundle;
    return bundle;
  }

  function attachTileLayer(map, offlineTileFolder) {
    if (offlineTileFolder) {
      const tileLayer = global.L.tileLayer(`${offlineTileFolder}/{z}/{x}/{y}.png`, {
        maxZoom: 19,
        errorTileUrl: '', // transparent - grid fallback shows through
      });
      tileLayer.addTo(map);
    }
    // Grid fallback always underlays so unrendered/missing tiles never show blank white.
    new GridFallbackLayer({ maxZoom: 19 }).addTo(map);
  }

  /** Updates (or creates) the pulsing "you are here" marker. */
  function updateCurrentLocation(bundle, lat, lng, accuracy) {
    if (!bundle) return;
    const latlng = [lat, lng];
    if (!bundle._currentMarker) {
      bundle._currentMarker = global.L.circleMarker(latlng, {
        radius: 8, color: '#1b5e20', fillColor: '#4caf50', fillOpacity: 1, weight: 3,
      }).addTo(bundle.map);
      bundle._accuracyCircle = global.L.circle(latlng, {
        radius: accuracy || 10, color: '#4caf50', fillColor: '#4caf50', fillOpacity: 0.1, weight: 1,
      }).addTo(bundle.map);
    } else {
      bundle._currentMarker.setLatLng(latlng);
      bundle._accuracyCircle.setLatLng(latlng);
      bundle._accuracyCircle.setRadius(accuracy || 10);
    }
    bundle.map.panTo(latlng, { animate: true });
  }

  /** Appends a point to the live path polyline. */
  function appendPathPoint(bundle, lat, lng) {
    if (!bundle) return;
    const latlngs = bundle.pathLayer.getLatLngs();
    latlngs.push([lat, lng]);
    bundle.pathLayer.setLatLngs(latlngs);
  }

  /** Drops a numbered segment marker (used in 50m Segment Mode). */
  function addSegmentMarker(bundle, lat, lng, segmentNumber) {
    if (!bundle) return;
    const icon = global.L.divIcon({
      html: `<div style="background:#1b5e20;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${segmentNumber}</div>`,
      className: '',
      iconSize: [26, 26],
    });
    global.L.marker([lat, lng], { icon }).addTo(bundle.markersLayer);
  }

  function fitToPath(bundle) {
    if (!bundle) return;
    const latlngs = bundle.pathLayer.getLatLngs();
    if (latlngs.length > 1) bundle.map.fitBounds(bundle.pathLayer.getBounds(), { padding: [24, 24] });
  }

  function destroyMap(containerId) {
    if (activeMaps[containerId]) {
      activeMaps[containerId].map.remove();
      delete activeMaps[containerId];
    }
  }

  /**
   * Renders a simple offline "map snapshot" PNG (base64, no data: prefix)
   * from a list of {latitude, longitude} points using an off-screen
   * canvas. This does not require network tiles and works purely from
   * the recorded coordinates, satisfying the map_snapshot.png deliverable
   * for Pathway exports without any external dependency.
   */
  function generatePathSnapshotBase64(points, opts) {
    opts = opts || {};
    const width = opts.width || 640;
    const height = opts.height || 640;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#eef3ee';
    ctx.fillRect(0, 0, width, height);

    if (!points || points.length < 2) {
      ctx.fillStyle = '#8fa190';
      ctx.font = '16px sans-serif';
      ctx.fillText('Insufficient GPS points for snapshot', 20, height / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }

    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 40;

    const project = (lat, lng) => {
      const x = pad + ((lng - minLng) / ((maxLng - minLng) || 1e-9)) * (width - pad * 2);
      const y = height - pad - ((lat - minLat) / ((maxLat - minLat) || 1e-9)) * (height - pad * 2);
      return [x, y];
    };

    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 4;
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = project(p.latitude, p.longitude);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Start / end markers
    const [sx, sy] = project(points[0].latitude, points[0].longitude);
    const [ex, ey] = project(points[points.length - 1].latitude, points[points.length - 1].longitude);
    ctx.fillStyle = '#1b5e20';
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c62828';
    ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText('Start', sx + 10, sy);
    ctx.fillText('End', ex + 10, ey);

    return canvas.toDataURL('image/png').split(',')[1];
  }

  global.FMRMap = {
    initMap,
    updateCurrentLocation,
    appendPathPoint,
    addSegmentMarker,
    fitToPath,
    destroyMap,
    generatePathSnapshotBase64,
  };
})(window);
