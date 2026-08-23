// Team Builder Unleashed background update scheduler.
importScripts('update-checker.js');

const UPDATE_ALARM = 'team-builder-unleashed-update-check';

async function setUpdateBadge(state) {
  if (state.status === 'update-available') {
    await chrome.action.setBadgeBackgroundColor({ color: '#2b7cf0' });
    await chrome.action.setBadgeText({ text: 'UPD' });
    await chrome.action.setTitle({ title: `Team Builder Unleashed — update v${state.latestVersion} available` });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Team Builder Unleashed' });
}

async function runUpdateCheck(options) {
  const state = await TeamBuilderUnleashedUpdates.checkForUpdates(options);
  await setUpdateBadge(state);
  return state;
}

function scheduleUpdateChecks() {
  chrome.alarms.create(UPDATE_ALARM, {
    periodInMinutes: TeamBuilderUnleashedUpdates.CHECK_INTERVAL_MS / 60000,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleUpdateChecks();
  void runUpdateCheck({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
  scheduleUpdateChecks();
  void runUpdateCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void runUpdateCheck();
});

void runUpdateCheck();
