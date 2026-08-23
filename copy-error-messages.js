// Plain-language copy errors for Team Builder Unleashed.
//
// Copying a roster should never make a creator decipher a request URL or an
// internal field name. Keep the reasons and next steps in one small module so
// every classic/custom/directory copy path says the same thing.
(function () {
  'use strict';

  const PS1_ERA_GAME_SLUGS = new Set([
    'ncaa-97',
    'ncaa-98',
    'ncaa-99',
    'ncaa-00',
    'ncaa-01',
    'ncaa-2000',
    'ncaa-2001',
  ]);

  function messageFrom(error) {
    return error instanceof Error ? error.message : String(error || '');
  }

  function blockedCopyMessage(route) {
    if (route?.kind !== 'classic' || !PS1_ERA_GAME_SLUGS.has(String(route.gameSlug || '').toLowerCase())) {
      return null;
    }
    return 'Ratings conversion has incomplete data for older PS1-era games (NCAA 98–01). ' +
      'Support for these games is coming soon. You can still use Download CSV to view the roster.';
  }

  function copyErrorMessage(error, route) {
    const blocked = blockedCopyMessage(route);
    if (blocked) return blocked;
    const message = messageFrom(error);

    if (/request failed \(404\)|not found/i.test(message)) {
      return 'This roster is not available to copy yet. Refresh the page and try again later.';
    }
    if (/request failed \((401|403)\)|unauthori[sz]ed|forbidden/i.test(message)) {
      return 'TeamCrafters could not open this roster right now. Refresh the page, then try copying again.';
    }
    if (/request failed \(5\d\d\)|failed to fetch|networkerror|network request failed/i.test(message)) {
      return 'TeamCrafters is having trouble reaching this roster. Check your connection and try again in a moment.';
    }
    if (/invalid [A-Z]+ rating|invalid position|invalid weight|not a valid Team Builder player/i.test(message)) {
      return 'This roster has player data that cannot be safely converted to CFB 27 yet. ' +
        'Use Download CSV to review the roster, then try a newer game or roster.';
    }
    if (/expected a Team Builder roster|found \d+\.?$/i.test(message)) {
      return 'This roster has an unexpected number of players, so it cannot be copied safely right now.';
    }
    if (/portrait|character visuals|character_visuals/i.test(message)) {
      return 'One or more player faces could not be matched safely. Try copying again after refreshing the page.';
    }
    return 'We could not copy this roster. Refresh the page and try again. If it keeps happening, please report it in the TeamCrafters Discord.';
  }

  window.TeamBuilderUnleashedCopyErrors = {
    blockedCopyMessage,
    copyErrorMessage,
  };
})();
