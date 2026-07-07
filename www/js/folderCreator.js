/**
 * folderCreator.js
 * Wraps cordova-plugin-file to build and populate the on-device folder
 * structure described in the spec:
 *
 *   FMR_Geotag/
 *     Project_A/
 *       2026-07-06_093000/
 *         Segment_1/ { photo.jpg, gps.json, metadata.json }
 *         Segment_2/ ...
 *       (or for pathway)
 *         Track/ { track.json, track.gpx, track.geojson }
 *         photos/
 *         summary.json
 *
 * On Android this resolves to cordova.file.externalRootDirectory
 * (device storage, visible to the user / other apps), falling back to
 * cordova.file.dataDirectory (app-private, always writable) if external
 * storage is not available. On iOS it uses cordova.file.documentsDirectory.
 *
 * When cordova.file is not present (desktop browser preview), an
 * in-memory virtual filesystem stands in so the rest of the app can be
 * exercised without a device.
 */
(function (global) {
  'use strict';

  const ROOT_FOLDER_NAME = 'FMR_Geotag';
  let cachedRootEntry = null;
  let usingVirtualFs = false;
  const virtualFs = { name: ROOT_FOLDER_NAME, isDirectory: true, children: {} };

  /* ---------------------------------------------------------------
   * Virtual FS (browser dev fallback) - minimal DirectoryEntry shim
   * ------------------------------------------------------------- */
  function vNode(name, isDirectory, parent) {
    return {
      name,
      isDirectory,
      isFile: !isDirectory,
      children: isDirectory ? {} : undefined,
      content: undefined,
      parent,
      fullPath: parent ? `${parent.fullPath}/${name}` : `/${name}`,
    };
  }

  function vGetOrCreateDir(parentNode, name) {
    if (!parentNode.children[name]) {
      parentNode.children[name] = vNode(name, true, parentNode);
    }
    return parentNode.children[name];
  }

  function vGetOrCreateFile(parentNode, name) {
    if (!parentNode.children[name]) {
      parentNode.children[name] = vNode(name, false, parentNode);
    }
    return parentNode.children[name];
  }

  /* ---------------------------------------------------------------
   * Root resolution
   * ------------------------------------------------------------- */
  function resolveRoot() {
    if (cachedRootEntry) return Promise.resolve(cachedRootEntry);

    if (!global.cordova || !global.cordova.file || !global.resolveLocalFileSystemURL) {
      usingVirtualFs = true;
      virtualFs.fullPath = `/${ROOT_FOLDER_NAME}`;
      cachedRootEntry = virtualFs;
      return Promise.resolve(cachedRootEntry);
    }

    const baseUrl = global.cordova.file.externalRootDirectory ||
                     global.cordova.file.documentsDirectory ||
                     global.cordova.file.dataDirectory;

    return new Promise((resolve, reject) => {
      global.resolveLocalFileSystemURL(baseUrl, (baseEntry) => {
        baseEntry.getDirectory(ROOT_FOLDER_NAME, { create: true }, (rootEntry) => {
          cachedRootEntry = rootEntry;
          resolve(rootEntry);
        }, reject);
      }, reject);
    });
  }

  /** Creates (or opens) a subdirectory under a given DirectoryEntry. */
  function getDirectory(parentEntry, name, create) {
    if (usingVirtualFs) {
      return Promise.resolve(create ? vGetOrCreateDir(parentEntry, name) : parentEntry.children[name]);
    }
    return new Promise((resolve, reject) => {
      parentEntry.getDirectory(name, { create: !!create }, resolve, reject);
    });
  }

  /** Writes a plain-text (or JSON-stringified) file into a directory. */
  function writeTextFile(dirEntry, fileName, text) {
    if (usingVirtualFs) {
      const f = vGetOrCreateFile(dirEntry, fileName);
      f.content = text;
      return Promise.resolve(f);
    }
    return new Promise((resolve, reject) => {
      dirEntry.getFile(fileName, { create: true }, (fileEntry) => {
        fileEntry.createWriter((writer) => {
          writer.onwriteend = () => resolve(fileEntry);
          writer.onerror = reject;
          const blob = new Blob([text], { type: 'text/plain' });
          writer.write(blob);
        }, reject);
      }, reject);
    });
  }

  function writeJSONFile(dirEntry, fileName, obj) {
    return writeTextFile(dirEntry, fileName, JSON.stringify(obj, null, 2));
  }

  /** Writes a base64-encoded image (no data: prefix) into a directory. */
  function writeBase64File(dirEntry, fileName, base64Data, mimeType) {
    if (usingVirtualFs) {
      const f = vGetOrCreateFile(dirEntry, fileName);
      f.content = base64Data;
      f.isBase64 = true;
      return Promise.resolve(f);
    }
    return new Promise((resolve, reject) => {
      dirEntry.getFile(fileName, { create: true }, (fileEntry) => {
        fileEntry.createWriter((writer) => {
          writer.onwriteend = () => resolve(fileEntry);
          writer.onerror = reject;
          try {
            const byteChars = atob(base64Data);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
            const byteArray = new Uint8Array(byteNumbers);
            writer.write(new Blob([byteArray], { type: mimeType || 'image/jpeg' }));
          } catch (e) {
            reject(e);
          }
        }, reject);
      }, reject);
    });
  }

  function readTextFile(dirEntry, fileName) {
    if (usingVirtualFs) {
      const f = dirEntry.children[fileName];
      return Promise.resolve(f ? f.content : null);
    }
    return new Promise((resolve, reject) => {
      dirEntry.getFile(fileName, { create: false }, (fileEntry) => {
        fileEntry.file((file) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsText(file);
        }, reject);
      }, reject);
    });
  }

  function getFullPath(entry) {
    return usingVirtualFs ? entry.fullPath : (entry.nativeURL || entry.fullPath);
  }

  /* ---------------------------------------------------------------
   * High-level: project folder builders
   * ------------------------------------------------------------- */

  /**
   * Creates FMR_Geotag/<ProjectFolderName>/ and returns its DirectoryEntry.
   */
  function createProjectFolder(projectFolderName) {
    return resolveRoot().then((root) => getDirectory(root, projectFolderName, true));
  }

  /** Creates Segment_N subfolder under the project folder. */
  function createSegmentFolder(projectDirEntry, segmentNumber) {
    return getDirectory(projectDirEntry, `Segment_${segmentNumber}`, true);
  }

  /** Creates Track/ and photos/ subfolders under the project folder (pathway mode). */
  function createPathwayFolders(projectDirEntry) {
    return Promise.all([
      getDirectory(projectDirEntry, 'Track', true),
      getDirectory(projectDirEntry, 'photos', true),
    ]).then(([trackDir, photosDir]) => ({ trackDir, photosDir }));
  }

  /** Recursively walks a directory tree, returning { name, path, files:[{name,size}], dirs:[...] }. */
  function walk(dirEntry) {
    if (usingVirtualFs) {
      const files = [];
      const dirs = [];
      Object.values(dirEntry.children || {}).forEach((child) => {
        if (child.isDirectory) dirs.push(walk(child));
        else files.push({ name: child.name, content: child.content, isBase64: !!child.isBase64 });
      });
      return { name: dirEntry.name, path: dirEntry.fullPath, files, dirs };
    }
    // Native walk uses a directory reader (async); wrapped as a promise chain by caller when needed.
    return null;
  }

  /** Async native-capable recursive walk returning the same shape as the virtual walk(). */
  function walkAsync(dirEntry) {
    if (usingVirtualFs) return Promise.resolve(walk(dirEntry));

    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      const entries = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (!batch.length) {
            Promise.all(entries.map((e) => e.isDirectory
              ? walkAsync(e).then((sub) => ({ type: 'dir', node: sub }))
              : Promise.resolve({ type: 'file', entry: e })
            )).then((resolved) => {
              const files = [];
              const dirs = [];
              resolved.forEach((r) => (r.type === 'dir' ? dirs.push(r.node) : files.push(r.entry)));
              // Resolve file contents lazily by name only (size/metadata fetched on demand elsewhere)
              resolve({ name: dirEntry.name, path: getFullPath(dirEntry), files: files.map((f) => ({ name: f.name, entry: f })), dirs });
            }).catch(reject);
          } else {
            entries.push(...batch);
            readBatch();
          }
        }, reject);
      };
      readBatch();
    });
  }

  global.FMRFolderManager = {
    ROOT_FOLDER_NAME,
    resolveRoot,
    getDirectory,
    writeTextFile,
    writeJSONFile,
    writeBase64File,
    readTextFile,
    getFullPath,
    createProjectFolder,
    createSegmentFolder,
    createPathwayFolders,
    walkAsync,
    isUsingVirtualFs: () => usingVirtualFs,
  };
})(window);
