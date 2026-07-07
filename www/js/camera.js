/**
 * camera.js
 * Wraps `cordova-plugin-camera` to capture geotagged survey photos.
 *
 * Photos are requested as base64 JPEG data (not a file URI) so they can
 * be written directly into the correct project/segment folder by
 * folderCreator.js and also bundled straight into ZIP exports without
 * an extra file-copy step.
 */
(function (global) {
  'use strict';

  /**
   * Captures a photo using the device camera.
   * @param {number} qualityPercent JPEG quality 0-100 (from Settings).
   * @returns {Promise<string>} base64-encoded JPEG data (no data: prefix).
   */
  function capturePhoto(qualityPercent) {
    return new Promise((resolve, reject) => {
      if (!navigator.camera) {
        // Browser dev fallback: generate a placeholder image so the
        // rest of the flow (save/preview/export) can still be tested.
        resolve(generatePlaceholderBase64());
        return;
      }
      navigator.camera.getPicture(
        (base64Data) => resolve(base64Data),
        (err) => reject(new Error('Camera capture failed: ' + err)),
        {
          quality: qualityPercent || 70,
          destinationType: Camera.DestinationType.DATA_URL,
          sourceType: Camera.PictureSourceType.CAMERA,
          encodingType: Camera.EncodingType.JPEG,
          mediaType: Camera.MediaType.PICTURE,
          correctOrientation: true,
          saveToPhotoAlbum: false,
          targetWidth: 1600,
          targetHeight: 1600,
        }
      );
    });
  }

  /** Produces the next sequential file name, e.g. IMG_0001.jpg, IMG_0002.jpg... */
  function nextFileName(projectId) {
    return FMRDb.getPhotosForProject(projectId).then((photos) => {
      const nextIndex = photos.length + 1;
      return `IMG_${String(nextIndex).padStart(4, '0')}.jpg`;
    });
  }

  /** Tiny 1x1 gray JPEG (base64) used only when no camera plugin is present. */
  function generatePlaceholderBase64() {
    // A minimal valid JPEG, base64-encoded, used strictly for desktop-browser
    // development preview when navigator.camera is unavailable.
    return '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
  }

  global.FMRCamera = {
    capturePhoto,
    nextFileName,
  };
})(window);
