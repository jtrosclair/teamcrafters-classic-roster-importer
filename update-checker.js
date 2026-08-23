// Team Builder Unleashed release checker.
//
// This file is shared by the popup and the Manifest V3 service worker. It keeps
// one clearly readable state in extension storage so the UI can explain whether
// an update exists, the installed build is ahead of GitHub, or a check failed.
(function () {
  'use strict';

  const UPDATE_STATE_KEY = 'tcUnleashedUpdateState';
  const RELEASES_API = 'https://api.github.com/repos/jtrosclair/teamcrafters-classic-roster-importer/releases?per_page=20';
  const RELEASES_PAGE = 'https://github.com/jtrosclair/teamcrafters-classic-roster-importer/releases/latest';
  const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const RETRY_INTERVAL_MS = 15 * 60 * 1000;

  function installedVersion() {
    return String(chrome.runtime.getManifest().version || '').trim();
  }

  function parseVersion(value) {
    const match = String(value || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/i);
    if (!match) return null;
    return match.slice(1).map((part) => Number(part || 0));
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let index = 0; index < 4; index += 1) {
      const difference = a[index] - b[index];
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => resolve(result?.[key] || null));
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(value, resolve);
    });
  }

  function cleanState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      checkedAt: Number.isFinite(value.checkedAt) ? value.checkedAt : 0,
      lastSuccessfulAt: Number.isFinite(value.lastSuccessfulAt) ? value.lastSuccessfulAt : 0,
      installedVersion: typeof value.installedVersion === 'string' ? value.installedVersion : '',
      latestVersion: typeof value.latestVersion === 'string' ? value.latestVersion : '',
      releaseUrl: typeof value.releaseUrl === 'string' ? value.releaseUrl : RELEASES_PAGE,
      downloadUrl: typeof value.downloadUrl === 'string' ? value.downloadUrl : '',
      releaseName: typeof value.releaseName === 'string' ? value.releaseName : '',
      publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : '',
      etag: typeof value.etag === 'string' ? value.etag : '',
      lastError: typeof value.lastError === 'string' ? value.lastError : '',
    };
  }

  function statusFor(state) {
    if (!state?.latestVersion || !parseVersion(state.latestVersion)) return state?.lastError ? 'error' : 'unknown';
    const difference = compareVersions(state.latestVersion, installedVersion());
    if (difference === null) return 'error';
    if (difference > 0) return 'update-available';
    if (difference < 0) return 'ahead';
    return 'up-to-date';
  }

  function publicState(state) {
    const normalized = cleanState(state) || {};
    return {
      ...normalized,
      installedVersion: installedVersion(),
      status: statusFor(normalized),
    };
  }

  function releaseFromList(value) {
    if (!Array.isArray(value)) throw new Error('The update service sent an unexpected response.');
    for (const release of value) {
      if (!release || release.draft || release.prerelease) continue;
      const version = String(release.tag_name || '').trim().replace(/^v/i, '');
      if (!parseVersion(version)) continue;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const zip = assets.find((asset) => /\.zip$/i.test(String(asset?.name || '')) && typeof asset.browser_download_url === 'string');
      return {
        latestVersion: version,
        releaseUrl: typeof release.html_url === 'string' ? release.html_url : RELEASES_PAGE,
        downloadUrl: zip?.browser_download_url || '',
        releaseName: typeof release.name === 'string' ? release.name : '',
        publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
      };
    }
    throw new Error('No published Team Builder Unleashed release was found.');
  }

  async function fetchRelease(previous) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    const response = await fetch(RELEASES_API, { cache: 'no-store', headers });
    if (response.status === 304 && previous?.latestVersion) {
      return { release: publicState(previous), etag: previous.etag, notModified: true };
    }
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const suffix = retryAfter ? ` Try again in about ${retryAfter} seconds.` : '';
      throw new Error(`GitHub could not check for updates (${response.status}).${suffix}`);
    }
    return {
      release: releaseFromList(await response.json()),
      etag: response.headers.get('etag') || '',
      notModified: false,
    };
  }

  function shouldUseCachedState(state, force) {
    if (force || !state?.checkedAt) return false;
    const interval = state.lastError ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS;
    return Date.now() - state.checkedAt < interval;
  }

  async function checkForUpdates({ force = false } = {}) {
    const previous = cleanState(await storageGet(UPDATE_STATE_KEY));
    if (shouldUseCachedState(previous, force)) return publicState(previous);
    const now = Date.now();
    try {
      const result = await fetchRelease(previous);
      const next = {
        ...(previous || {}),
        ...result.release,
        checkedAt: now,
        lastSuccessfulAt: now,
        installedVersion: installedVersion(),
        etag: result.etag,
        lastError: '',
      };
      await storageSet({ [UPDATE_STATE_KEY]: next });
      return publicState(next);
    } catch (error) {
      const next = {
        ...(previous || {}),
        checkedAt: now,
        installedVersion: installedVersion(),
        lastError: error instanceof Error ? error.message : 'Could not check for updates.',
      };
      await storageSet({ [UPDATE_STATE_KEY]: next });
      return publicState(next);
    }
  }

  async function getUpdateState() {
    return publicState(cleanState(await storageGet(UPDATE_STATE_KEY)));
  }

  globalThis.TeamBuilderUnleashedUpdates = {
    CHECK_INTERVAL_MS,
    RETRY_INTERVAL_MS,
    UPDATE_STATE_KEY,
    checkForUpdates,
    compareVersions,
    getUpdateState,
    parseVersion,
  };
})();
