// TeamCrafters Team Builder Unleashed Studio bridge.
//
// Runs only on the shared TeamCrafters studio and owns all extension-local state.
// The page can browse the bundled stadium/mascot catalogs and arm a selection for
// the existing confirmed native Team Builder save flow; it never receives Chrome
// APIs, EA credentials, or a direct EA persistence endpoint.
(function () {
  "use strict";

  const NAMESPACE = "teamcrafters.studio";
  const BRIDGE_VERSION = 1;
  const PAGE_SOURCE = "teamcrafters-page";
  const EXTENSION_SOURCE = "teamcrafters-extension";
  const EDITOR_PATHS = new Set([
    "/team-builder-unleashed",
    "/team-builder-unleashed/",
    "/team-builder-unleashed/cfb27",
    "/team-builder-unleashed/cfb27/",
  ]);
  const ALLOWED_ORIGINS = new Set([
    "https://www.teamcrafters.net",
    "http://localhost:3000",
    "http://localhost:3001",
  ]);
  const MAX_REQUEST_ID_LENGTH = 128;
  const ROSTER_KEY = "tcRosterClipboard";
  const MASCOT_KEY = "tcMascotClipboard";
  const STADIUM_KEY = "tcStadiumClipboard";
  const UNIFORM_KEY = "tcUniformClipboard";
  const SCHOOL_TEMPLATE_KEY = "tcSchoolTemplates";
  const EQUIPMENT_SLOT_IDS = new Set([
    0, 2, 9, 10, 11, 12, 25, 26, 29, 30, 51, 54, 71, 72, 96, 97, 101, 106, 107,
    108, 109, 110, 111, 114, 115, 116, 117, 118, 120, 121, 122, 124, 125, 127,
    129, 142, 143,
  ]);
  const BODY_TYPE_SLOT_ID = 129;
  const LEFT_CLEAT_SLOT_ID = 10;
  const RIGHT_CLEAT_SLOT_ID = 11;
  const BODY_TYPE_ASSET_NAMES = new Set([
    "Heavy_BodyType",
    "Lean_BodyType",
    "Muscular_BodyType",
    "Standard_BodyType",
    "Thin_BodyType",
  ]);
  const textEncoder = new TextEncoder();
  let catalogsPromise = null;
  let uniformCatalogPromise = null;
  let ignoredWorkspaceChangeEvents = 0;

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isAllowedLocation() {
    return (
      ALLOWED_ORIGINS.has(window.location.origin) &&
      EDITOR_PATHS.has(window.location.pathname)
    );
  }

  if (!isAllowedLocation()) return;

  function post(type, payload, requestId) {
    if (!isAllowedLocation()) return;
    const envelope = {
      namespace: NAMESPACE,
      bridgeVersion: BRIDGE_VERSION,
      source: EXTENSION_SOURCE,
      type,
      payload,
    };
    if (requestId) envelope.requestId = requestId;
    window.postMessage(envelope, window.location.origin);
  }

  function postError(code, message, requestId) {
    post("TC_STUDIO_ERROR", { code, message }, requestId);
  }

  function writeStudioWorkspace(values) {
    ignoredWorkspaceChangeEvents += 1;
    return chrome.storage.local.set(values);
  }

  function removeStudioWorkspace(keys) {
    ignoredWorkspaceChangeEvents += 1;
    return chrome.storage.local.remove(keys);
  }

  function isRequestId(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_REQUEST_ID_LENGTH
    );
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  async function sha256(value) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode(value),
    );
    return Array.from(new Uint8Array(bytes))
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("");
  }

  function safeRoster(clipboard) {
    if (!isRecord(clipboard)) return null;
    const rosterJson =
      typeof clipboard.rosterJson === "string"
        ? clipboard.rosterJson
        : undefined;
    const visualsJson =
      typeof clipboard.visualsJson === "string"
        ? clipboard.visualsJson
        : undefined;
    let playerCount = Number.isInteger(clipboard.playerCount)
      ? clipboard.playerCount
      : 0;
    if (!playerCount && rosterJson) {
      try {
        const players = JSON.parse(rosterJson);
        if (isRecord(players)) playerCount = Object.keys(players).length;
      } catch {
        // The workspace still reports an armed source; player-level preview stays unavailable.
      }
    }
    return {
      teamName: text(clipboard.teamName) || undefined,
      copiedAt: text(clipboard.copiedAt) || undefined,
      playerCount: Math.max(0, Math.min(100, playerCount)),
      rosterJson,
      visualsJson,
    };
  }

  function readPlayerMaps(clipboard) {
    if (
      !isRecord(clipboard) ||
      typeof clipboard.rosterJson !== "string" ||
      typeof clipboard.visualsJson !== "string" ||
      clipboard.rosterJson.length > 5 * 1024 * 1024 ||
      clipboard.visualsJson.length > 5 * 1024 * 1024
    ) {
      throw Object.assign(
        new Error("Copy or import a roster before editing a player."),
        { code: "NO_ROSTER" },
      );
    }
    let roster;
    let visuals;
    try {
      roster = JSON.parse(clipboard.rosterJson);
      visuals = JSON.parse(clipboard.visualsJson);
    } catch {
      throw Object.assign(new Error("The roster data could not be read."), {
        code: "INVALID_ROSTER",
      });
    }
    const playerIds = isRecord(roster) ? Object.keys(roster) : [];
    if (
      !playerIds.length ||
      playerIds.length > 100 ||
      playerIds.some((id) => !/^\d+$/.test(id) || !isRecord(roster[id])) ||
      !isRecord(visuals) ||
      playerIds.some((id) => !isRecord(visuals[id]))
    ) {
      throw Object.assign(
        new Error("The roster and player appearances do not match."),
        { code: "INVALID_ROSTER" },
      );
    }
    return { roster, visuals, playerIds };
  }

  function safeInteger(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
  }

  function bodyLoadoutSignature(loadouts) {
    if (!Array.isArray(loadouts)) return "";
    const bodyLoadout = loadouts.find(
      (loadout) => isRecord(loadout) && Number(loadout.loadoutCategory) === 5,
    );
    return bodyLoadout ? JSON.stringify(bodyLoadout) : "";
  }

  function setBodyTypeAssetName(visual, assetName) {
    if (!Array.isArray(visual.loadouts)) visual.loadouts = [];
    let bodyLoadout = visual.loadouts.find(
      (loadout) => isRecord(loadout) && Number(loadout.loadoutCategory) === 5,
    );
    if (!bodyLoadout) {
      bodyLoadout = {
        loadoutType: 0,
        loadoutCategory: 5,
        loadoutElements: [],
        displayOrder: 9999,
      };
      visual.loadouts.push(bodyLoadout);
    }
    if (!Array.isArray(bodyLoadout.loadoutElements))
      bodyLoadout.loadoutElements = [];
    const bodyType = bodyLoadout.loadoutElements.find(
      (element) =>
        isRecord(element) && Number(element.slotType) === BODY_TYPE_SLOT_ID,
    );
    if (bodyType) {
      bodyType.itemAssetName = assetName;
    } else {
      bodyLoadout.loadoutElements.push({
        slotType: BODY_TYPE_SLOT_ID,
        itemAssetName: assetName,
        itemDisplayName: "",
      });
    }
  }

  function equipmentAssetForSlot(loadout, slotId) {
    if (!isRecord(loadout) || !Array.isArray(loadout.loadoutElements))
      return null;
    const element = loadout.loadoutElements.find(
      (candidate) => isRecord(candidate) && candidate.slotType === slotId,
    );
    return isRecord(element) ? element.itemAssetName : null;
  }

  function setEquipmentAssetForSlot(loadout, slotId, assetName) {
    const existing = loadout.loadoutElements.find(
      (candidate) => isRecord(candidate) && candidate.slotType === slotId,
    );
    if (existing) {
      existing.itemAssetName = assetName;
    } else {
      loadout.loadoutElements.push({
        slotType: slotId,
        itemAssetName: assetName,
      });
    }
  }

  function synchronizeCleats(loadouts) {
    const gearLoadout = loadouts.find(
      (loadout) => isRecord(loadout) && Number(loadout.loadoutCategory) === 0,
    );
    if (!gearLoadout || !Array.isArray(gearLoadout.loadoutElements)) return;
    const left = equipmentAssetForSlot(gearLoadout, LEFT_CLEAT_SLOT_ID);
    const right = equipmentAssetForSlot(gearLoadout, RIGHT_CLEAT_SLOT_ID);
    if (left === right) return;
    const assetName = left ?? right ?? "";
    setEquipmentAssetForSlot(gearLoadout, LEFT_CLEAT_SLOT_ID, assetName);
    setEquipmentAssetForSlot(gearLoadout, RIGHT_CLEAT_SLOT_ID, assetName);
  }

  function deepEqual(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) => deepEqual(value, right[index]))
      );
    }
    if (isRecord(left) || isRecord(right)) {
      if (!isRecord(left) || !isRecord(right)) return false;
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every(
          (key, index) =>
            key === rightKeys[index] && deepEqual(left[key], right[key]),
        )
      );
    }
    return false;
  }

  function withoutKey(record, omittedKey) {
    return Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== omittedKey),
    );
  }

  function isEditableEquipmentElement(loadout, element) {
    return (
      Number(loadout.loadoutCategory) === 0 &&
      EQUIPMENT_SLOT_IDS.has(element.slotType) &&
      element.slotType !== BODY_TYPE_SLOT_ID
    );
  }

  function hasOnlyElementKeys(element) {
    const keys = Object.keys(element).sort();
    return (
      keys.length === 2 && keys[0] === "itemAssetName" && keys[1] === "slotType"
    );
  }

  function assertOnlyEquipmentChanged(currentLoadouts, nextLoadouts) {
    if (
      !Array.isArray(currentLoadouts) ||
      currentLoadouts.length !== nextLoadouts.length
    )
      throw Object.assign(
        new Error("The equipment update changed a protected player setting."),
        { code: "INVALID_PAYLOAD" },
      );

    for (let index = 0; index < currentLoadouts.length; index += 1) {
      const currentLoadout = currentLoadouts[index];
      const nextLoadout = nextLoadouts[index];
      if (
        !isRecord(currentLoadout) ||
        !isRecord(nextLoadout) ||
        !deepEqual(
          withoutKey(currentLoadout, "loadoutElements"),
          withoutKey(nextLoadout, "loadoutElements"),
        ) ||
        !Array.isArray(currentLoadout.loadoutElements) ||
        !Array.isArray(nextLoadout.loadoutElements)
      )
        throw Object.assign(
          new Error("The equipment update changed a protected player setting."),
          { code: "INVALID_PAYLOAD" },
        );

      const currentBySlot = new Map(
        currentLoadout.loadoutElements.map((element) => [
          element.slotType,
          element,
        ]),
      );
      const nextBySlot = new Map(
        nextLoadout.loadoutElements.map((element) => [
          element.slotType,
          element,
        ]),
      );

      for (const [slotType, currentElement] of currentBySlot) {
        const nextElement = nextBySlot.get(slotType);
        if (!nextElement) {
          if (!isEditableEquipmentElement(currentLoadout, currentElement))
            throw Object.assign(
              new Error(
                "The equipment update changed a protected player setting.",
              ),
              { code: "INVALID_PAYLOAD" },
            );
          continue;
        }
        if (deepEqual(currentElement, nextElement)) continue;
        if (
          !isEditableEquipmentElement(currentLoadout, currentElement) ||
          !deepEqual(
            withoutKey(currentElement, "itemAssetName"),
            withoutKey(nextElement, "itemAssetName"),
          )
        )
          throw Object.assign(
            new Error(
              "The equipment update changed a protected player setting.",
            ),
            { code: "INVALID_PAYLOAD" },
          );
      }

      for (const [slotType, nextElement] of nextBySlot) {
        if (currentBySlot.has(slotType)) continue;
        if (
          !isEditableEquipmentElement(nextLoadout, nextElement) ||
          !hasOnlyElementKeys(nextElement)
        )
          throw Object.assign(
            new Error(
              "The equipment update changed a protected player setting.",
            ),
            { code: "INVALID_PAYLOAD" },
          );
      }
    }
  }

  function savePlayerAppearance(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.expectedRevision !== "string" ||
      !isRecord(payload.patch)
    ) {
      return Promise.reject(
        Object.assign(new Error("The player update is invalid."), {
          code: "INVALID_PAYLOAD",
        }),
      );
    }
    return chrome.storage.local
      .get([ROSTER_KEY, MASCOT_KEY, STADIUM_KEY])
      .then(async (storage) => {
        if (payload.expectedRevision !== (await revisionFor(storage)))
          throw Object.assign(
            new Error(
              "The roster changed. Refresh it before saving this player.",
            ),
            { code: "REVISION_CONFLICT" },
          );
        const clipboard = storage[ROSTER_KEY];
        const { roster, visuals, playerIds } = readPlayerMaps(clipboard);
        const patch = payload.patch;
        const playerId = text(patch.playerId);
        if (
          !playerIds.includes(playerId) ||
          !safeInteger(patch.heightInches, 24, 120) ||
          !safeInteger(patch.weightLbs, 160, 400) ||
          !safeInteger(patch.homeTownState, 0, 50) ||
          !safeInteger(patch.skinTone, 1, 8)
        ) {
          throw Object.assign(
            new Error("Check the player details and try again."),
            { code: "INVALID_PAYLOAD" },
          );
        }
        const homeTown = text(patch.homeTown);
        const bodyTypeAssetName = text(patch.bodyTypeAssetName);
        if (homeTown.length > 60)
          throw Object.assign(
            new Error("Hometown city must be 60 characters or fewer."),
            { code: "INVALID_PAYLOAD" },
          );
        if (bodyTypeAssetName && !BODY_TYPE_ASSET_NAMES.has(bodyTypeAssetName))
          throw Object.assign(
            new Error("Choose a body type from Team Builder Unleashed."),
            { code: "INVALID_PAYLOAD" },
          );

        const player = roster[playerId];
        const visual = visuals[playerId];
        player.PLYR_HEIGHT = String(patch.heightInches);
        player.PLYR_WEIGHT = String(patch.weightLbs - 160);
        player.PLYR_HOME_TOWN = homeTown;
        player.PLYR_HOME_STATE = String(patch.homeTownState);
        player.PLYR_SKINTONE = String(patch.skinTone);
        visual.heightInches = patch.heightInches;
        visual.weightPounds = patch.weightLbs;
        visual.skinTone = patch.skinTone;
        if (bodyTypeAssetName) setBodyTypeAssetName(visual, bodyTypeAssetName);

        if (patch.faceScan !== null) {
          if (
            !isRecord(patch.faceScan) ||
            !/^\d+$/.test(text(patch.faceScan.portraitId))
          ) {
            throw Object.assign(
              new Error("Choose a face from the CFB 27 catalog."),
              { code: "INVALID_PAYLOAD" },
            );
          }
          if (patch.faceScan.kind === "nil") {
            if (
              !/^[A-Za-z0-9_()-]{1,120}$/.test(
                text(patch.faceScan.playerAssetName),
              ) ||
              !/^[A-Za-z0-9_()-]{1,120}$/.test(
                text(patch.faceScan.genericHeadName),
              )
            ) {
              throw Object.assign(
                new Error("Choose a NIL face scan from the CFB 27 catalog."),
                { code: "INVALID_PAYLOAD" },
              );
            }
            player.PLYR_PORTRAIT = text(patch.faceScan.portraitId);
            player.PLYR_ASSETNAME = text(patch.faceScan.playerAssetName);
            visual.assetName = text(patch.faceScan.playerAssetName);
            visual.genericHeadName = text(patch.faceScan.genericHeadName);
            visual.customHead = 0;
          } else if (patch.faceScan.kind === "generic") {
            if (
              !/^[A-Za-z0-9_]{1,160}$/.test(
                text(patch.faceScan.genericHeadName),
              )
            ) {
              throw Object.assign(
                new Error("Choose a generic head from the CFB 27 catalog."),
                { code: "INVALID_PAYLOAD" },
              );
            }
            // Generic heads deliberately leave player-asset fields alone. EA only needs the portrait and recipe.
            player.PLYR_PORTRAIT = text(patch.faceScan.portraitId);
            visual.genericHeadName = text(patch.faceScan.genericHeadName);
          } else {
            throw Object.assign(
              new Error("Choose a face from the CFB 27 catalog."),
              { code: "INVALID_PAYLOAD" },
            );
          }
        }

        await writeStudioWorkspace({
          [ROSTER_KEY]: {
            ...clipboard,
            rosterJson: JSON.stringify(roster),
            visualsJson: JSON.stringify(visuals),
            editedAt: new Date().toISOString(),
          },
        });
        return getWorkspace();
      });
  }

  function safeEquipmentLoadouts(value) {
    if (
      !Array.isArray(value) ||
      value.length > 8 ||
      JSON.stringify(value).length > 512 * 1024
    )
      return null;
    for (const loadout of value) {
      if (
        !isRecord(loadout) ||
        !safeInteger(loadout.loadoutCategory, 0, 16) ||
        !safeInteger(loadout.loadoutType, 0, 16) ||
        !Array.isArray(loadout.loadoutElements) ||
        loadout.loadoutElements.length > 64
      )
        return null;
      const slots = new Set();
      for (const element of loadout.loadoutElements) {
        if (
          !isRecord(element) ||
          !safeInteger(element.slotType, 0, 200) ||
          (element.itemAssetName !== undefined &&
            (typeof element.itemAssetName !== "string" ||
              element.itemAssetName.length > 512 ||
              /[\u0000-\u001f]/.test(element.itemAssetName))) ||
          slots.has(element.slotType)
        )
          return null;
        slots.add(element.slotType);
      }
    }
    const loadouts = JSON.parse(JSON.stringify(value));
    synchronizeCleats(loadouts);
    return loadouts;
  }

  function savePlayerEquipment(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.expectedRevision !== "string" ||
      !isRecord(payload.patch)
    ) {
      return Promise.reject(
        Object.assign(new Error("The equipment update is invalid."), {
          code: "INVALID_PAYLOAD",
        }),
      );
    }
    return chrome.storage.local
      .get([ROSTER_KEY, MASCOT_KEY, STADIUM_KEY])
      .then(async (storage) => {
        if (payload.expectedRevision !== (await revisionFor(storage)))
          throw Object.assign(
            new Error(
              "The roster changed. Refresh it before saving equipment.",
            ),
            { code: "REVISION_CONFLICT" },
          );
        const clipboard = storage[ROSTER_KEY];
        const { visuals, playerIds } = readPlayerMaps(clipboard);
        const playerId = text(payload.patch.playerId);
        const loadouts = safeEquipmentLoadouts(payload.patch.loadouts);
        if (!playerIds.includes(playerId) || loadouts === null)
          throw Object.assign(
            new Error(
              "The equipment selection is not valid. Please choose it again.",
            ),
            { code: "INVALID_PAYLOAD" },
          );
        if (
          bodyLoadoutSignature(visuals[playerId].loadouts) !==
          bodyLoadoutSignature(loadouts)
        )
          throw Object.assign(
            new Error("Change body type from Appearance, not Equipment."),
            { code: "INVALID_PAYLOAD" },
          );
        assertOnlyEquipmentChanged(visuals[playerId].loadouts, loadouts);
        visuals[playerId].loadouts = loadouts;
        await writeStudioWorkspace({
          [ROSTER_KEY]: {
            ...clipboard,
            visualsJson: JSON.stringify(visuals),
            equipmentEditedAt: new Date().toISOString(),
          },
        });
        return getWorkspace();
      });
  }

  function safeMascot(value) {
    if (!isRecord(value)) return null;
    const assetName = text(value.assetName);
    const teamName = text(value.teamName);
    const mascotName = text(value.mascotName);
    return assetName && teamName && mascotName
      ? { assetName, teamName, mascotName }
      : null;
  }

  function safeStadium(value) {
    if (
      !isRecord(value) ||
      !Number.isInteger(value.stadiumId) ||
      value.stadiumId < 0
    )
      return null;
    const displayName = text(value.displayName);
    return displayName ? { stadiumId: value.stadiumId, displayName } : null;
  }

  const SCHOOL_FIXED_GRADE_IDS = new Set([
    "CHAMPIONSHIP_CONTENDER_GRADE",
    "PROGRAM_TRADITION_GRADE",
    "CAMPUS_LIFESTYLE_GRADE",
    "STADIUM_ATMOSTPHERE_GRADE",
    "BRAND_EXPOSURE_GRADE",
    "ACADEMIC_PRESTIGE",
    "ATHLETIC_FACILITIES_GRADE",
  ]);
  const SCHOOL_AUTOMATIC_GRADE_IDS = new Set([
    "COACH_STABILITY_GRADE",
    "COACH_PRESTIGE_GRADE",
    "CONFERENCE_PRESTIGE_GRADE",
  ]);
  const SCHOOL_GRADE_IDS = new Set([
    ...SCHOOL_FIXED_GRADE_IDS,
    "PRO_POTENTIAL_GRADE",
    ...SCHOOL_AUTOMATIC_GRADE_IDS,
  ]);

  function safeSchoolTemplates(value) {
    if (!Array.isArray(value) || value.length > 100) return null;
    const ids = new Set();
    const templates = [];
    for (const template of value) {
      if (
        !isRecord(template) ||
        !safeInteger(template.id, 13, 1000000) ||
        ids.has(template.id) ||
        typeof template.displayName !== "string" ||
        !text(template.displayName) ||
        text(template.displayName).length > 60 ||
        !safeInteger(template.prestige, 0, 10) ||
        !Array.isArray(template.grades) ||
        template.grades.length !== 11
      )
        return null;
      const gradeIds = new Set();
      const grades = [];
      for (const grade of template.grades) {
        if (
          !isRecord(grade) ||
          typeof grade.id !== "string" ||
          !SCHOOL_GRADE_IDS.has(grade.id) ||
          gradeIds.has(grade.id) ||
          typeof grade.displayName !== "string" ||
          typeof grade.description !== "string" ||
          typeof grade.ratingSummary !== "string" ||
          !Number.isInteger(grade.min) ||
          !Number.isInteger(grade.max) ||
          grade.min < -1 ||
          grade.min > 12 ||
          grade.max < -1 ||
          grade.max > 12
        )
          return null;
        if (
          SCHOOL_FIXED_GRADE_IDS.has(grade.id) &&
          (grade.min !== grade.max || grade.min < 0)
        )
          return null;
        if (
          grade.id === "PRO_POTENTIAL_GRADE" &&
          (grade.min < grade.max || grade.max < 0)
        )
          return null;
        if (
          SCHOOL_AUTOMATIC_GRADE_IDS.has(grade.id) &&
          (grade.min !== -1 || grade.max !== -1)
        )
          return null;
        gradeIds.add(grade.id);
        grades.push({
          id: grade.id,
          displayName: grade.displayName,
          description: grade.description,
          min: grade.min,
          max: grade.max,
          ratingSummary: grade.ratingSummary,
        });
      }
      if (gradeIds.size !== SCHOOL_GRADE_IDS.size) return null;
      ids.add(template.id);
      templates.push({
        id: template.id,
        displayName: text(template.displayName),
        prestige: template.prestige,
        grades,
      });
    }
    return templates;
  }

  async function schoolTemplateState(storage) {
    const templates = safeSchoolTemplates(storage[SCHOOL_TEMPLATE_KEY]) || [];
    return {
      game: "CFB27",
      revision: await sha256(JSON.stringify(templates)),
      templates,
    };
  }

  async function revisionFor(storage) {
    return sha256(
      JSON.stringify({
        roster: safeRoster(storage[ROSTER_KEY]),
        mascot: safeMascot(storage[MASCOT_KEY]),
        stadium: safeStadium(storage[STADIUM_KEY]),
      }),
    );
  }

  async function loadUniformCatalog() {
    if (uniformCatalogPromise) return uniformCatalogPromise;
    uniformCatalogPromise = fetch(chrome.runtime.getURL("uniform-catalog.json"))
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Uniform catalog request failed (${response.status}).`,
          );
        const catalog = JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
        if (!window.TCUniformBuild)
          throw new Error("The uniform builder is unavailable. Reload the extension and try again.");
        return window.TCUniformBuild.normalizeCatalog(catalog);
      })
      .catch((error) => {
        uniformCatalogPromise = null;
        throw error;
      });
    return uniformCatalogPromise;
  }

  function uniformTeamCatalog(catalog) {
    return Object.entries(catalog.teams)
      .map(([teamName, team]) => ({
        teamName,
        abbreviation: text(team.abbr) || null,
        uniforms: team.uniforms.map((uniform) => ({
          displayName: text(uniform.displayName),
          loadoutType: uniform.currentOfficial ? uniform.loadoutType : 8,
          currentOfficial: Boolean(uniform.currentOfficial),
        })),
      }))
      .filter(
        (team) =>
          team.teamName &&
          team.uniforms.length > 0 &&
          team.uniforms.every(
            (uniform) =>
              uniform.displayName &&
              [3, 6, 8].includes(uniform.loadoutType),
          ),
      )
      .sort((first, second) => first.teamName.localeCompare(second.teamName));
  }

  function uniformOverrideSelection(value) {
    if (!isRecord(value)) return null;
    const teamName = text(value.teamName);
    const uniforms = Array.isArray(value.uniforms) ? value.uniforms : [];
    if (!teamName || !uniforms.length) return null;
    return { teamName, uniformCount: uniforms.length };
  }

  async function getUniformOverride() {
    const storage = await chrome.storage.local.get(UNIFORM_KEY);
    const selection = uniformOverrideSelection(storage[UNIFORM_KEY]);
    return {
      game: "CFB27",
      revision: await sha256(JSON.stringify(selection)),
      selection,
    };
  }

  async function saveUniformOverride(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.expectedRevision !== "string" ||
      (payload.teamName !== null && typeof payload.teamName !== "string")
    )
      throw Object.assign(new Error("Choose a school from the uniform list."), {
        code: "INVALID_PAYLOAD",
      });
    const storage = await chrome.storage.local.get(UNIFORM_KEY);
    const current = uniformOverrideSelection(storage[UNIFORM_KEY]);
    if (payload.expectedRevision !== (await sha256(JSON.stringify(current))))
      throw Object.assign(
        new Error("The uniform selection changed. Refresh it before saving."),
        { code: "REVISION_CONFLICT" },
      );
    if (payload.teamName === null) {
      await removeStudioWorkspace(UNIFORM_KEY);
      return getUniformOverride();
    }
    const catalog = await loadUniformCatalog();
    const teamName = text(payload.teamName);
    const team = catalog.teams[teamName];
    if (!team)
      throw Object.assign(new Error("Choose a school from the uniform list."), {
        code: "INVALID_PAYLOAD",
      });
    const uniformSet = window.TCUniformBuild.buildUniformSet(teamName, team);
    await writeStudioWorkspace({ [UNIFORM_KEY]: uniformSet });
    return getUniformOverride();
  }

  async function loadCatalogs() {
    if (catalogsPromise) return catalogsPromise;
    catalogsPromise = Promise.all([
      fetch(chrome.runtime.getURL("reference/mascots.json")).then(
        (response) => {
          if (!response.ok)
            throw new Error(
              `Mascot catalog request failed (${response.status}).`,
            );
          return response.json();
        },
      ),
      fetch(chrome.runtime.getURL("reference/stadiums.json")).then(
        (response) => {
          if (!response.ok)
            throw new Error(
              `Stadium catalog request failed (${response.status}).`,
            );
          return response.json();
        },
      ),
    ])
      .then(([mascotRows, stadiumRows]) => {
        if (!Array.isArray(mascotRows) || !Array.isArray(stadiumRows))
          throw new Error("The Team Builder catalogs are invalid.");
        const mascots = mascotRows.flatMap((row) => {
          if (!isRecord(row)) return [];
          const assetName = text(row.TMAN);
          const teamName = text(row.TeamName);
          const mascotName = text(row.MascotName);
          return assetName && teamName && mascotName
            ? [{ assetName, teamName, mascotName }]
            : [];
        });
        const stadiums = stadiumRows.flatMap((row) => {
          if (!isRecord(row) || !Number.isInteger(row.id) || row.id < 0)
            return [];
          const displayName = text(row.displayName);
          return displayName ? [{ stadiumId: row.id, displayName }] : [];
        });
        if (!mascots.length || !stadiums.length)
          throw new Error("The Team Builder catalogs are empty.");
        return { mascots, stadiums };
      })
      .catch((error) => {
        catalogsPromise = null;
        throw error;
      });
    return catalogsPromise;
  }

  async function getWorkspace() {
    const storage = await chrome.storage.local.get([
      ROSTER_KEY,
      MASCOT_KEY,
      STADIUM_KEY,
    ]);
    return {
      game: "CFB27",
      revision: await revisionFor(storage),
      roster: safeRoster(storage[ROSTER_KEY]),
    };
  }

  async function getRosterImportSample() {
    const response = await fetch(chrome.runtime.getURL("sample-roster.csv"));
    if (!response.ok)
      throw Object.assign(
        new Error(`Could not load the sample roster (${response.status}).`),
        { code: "SAMPLE_UNAVAILABLE" },
      );
    const csv = await response.text();
    if (!csv.trim() || csv.length > 1024 * 1024) {
      throw Object.assign(new Error("The sample roster is unavailable."), {
        code: "SAMPLE_UNAVAILABLE",
      });
    }
    return { csv };
  }

  async function importRosterCsv(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.csv !== "string" ||
      payload.csv.length > 1024 * 1024
    ) {
      throw Object.assign(
        new Error("Choose a CSV file smaller than 1 MB and try again."),
        { code: "INVALID_PAYLOAD" },
      );
    }
    if (!window.TCCsvImport || !window.TCRosterMerge) {
      throw Object.assign(
        new Error(
          "The roster importer is unavailable. Reload the extension and try again.",
        ),
        { code: "IMPORTER_UNAVAILABLE" },
      );
    }

    const teamName = text(payload.teamName).slice(0, 120) || "Imported roster";
    const [portraitCatalog, baseRoster, baseVisuals] = await Promise.all([
      window.TCRosterMerge.loadPortraitCatalog(),
      fetch(chrome.runtime.getURL("base-template/roster.json")).then(
        (response) => {
          if (!response.ok)
            throw new Error(
              `Could not load the roster template (${response.status}).`,
            );
          return response.json();
        },
      ),
      fetch(chrome.runtime.getURL("base-template/character_visuals.json")).then(
        (response) => {
          if (!response.ok)
            throw new Error(
              `Could not load the appearance template (${response.status}).`,
            );
          return response.json();
        },
      ),
    ]);
    const { errors, warnings, clipboard } =
      window.TCCsvImport.buildClipboardFromCsv(
        payload.csv,
        teamName,
        portraitCatalog,
      );
    if (errors.length || !clipboard) return { ok: false, errors, warnings };

    const { roster, visuals, stats } = window.TCRosterMerge.buildPresetPayload(
      clipboard,
      baseRoster,
      baseVisuals,
      portraitCatalog,
    );
    await writeStudioWorkspace({
      [ROSTER_KEY]: {
        version: 2,
        teamName,
        displayName: `TeamCrafters: ${teamName}`,
        sourceUrl: null,
        copiedAt: new Date().toISOString(),
        playerCount: clipboard.playerCount,
        stats,
        rosterUrl: window.TCRosterMerge.ROSTER_URL,
        visualsUrl: window.TCRosterMerge.VISUALS_URL,
        rosterJson: JSON.stringify(roster),
        visualsJson: JSON.stringify(visuals),
      },
    });
    return {
      ok: true,
      workspace: await getWorkspace(),
      playerCount: clipboard.playerCount,
      warnings,
      stats: {
        removedFiller: stats.removedFiller,
        unplacedPlayers: stats.unplacedPlayers,
      },
    };
  }

  async function getIdentity() {
    const [storage, catalogs] = await Promise.all([
      chrome.storage.local.get([ROSTER_KEY, MASCOT_KEY, STADIUM_KEY]),
      loadCatalogs(),
    ]);
    return {
      game: "CFB27",
      revision: await revisionFor(storage),
      mascot: safeMascot(storage[MASCOT_KEY]),
      stadium: safeStadium(storage[STADIUM_KEY]),
      catalogs,
    };
  }

  async function getSchoolTemplates() {
    return schoolTemplateState(
      await chrome.storage.local.get(SCHOOL_TEMPLATE_KEY),
    );
  }

  async function saveSchoolTemplates(payload) {
    if (!isRecord(payload) || typeof payload.expectedRevision !== "string") {
      throw Object.assign(
        new Error("The school templates request is invalid."),
        { code: "INVALID_PAYLOAD" },
      );
    }
    const nextTemplates = safeSchoolTemplates(payload.templates);
    if (nextTemplates === null) {
      throw Object.assign(
        new Error("Check the school template details and try again."),
        { code: "INVALID_PAYLOAD" },
      );
    }
    const storage = await chrome.storage.local.get(SCHOOL_TEMPLATE_KEY);
    const current = await schoolTemplateState(storage);
    if (payload.expectedRevision !== current.revision) {
      throw Object.assign(
        new Error("School templates changed. Refresh this tab before saving."),
        { code: "REVISION_CONFLICT" },
      );
    }
    await chrome.storage.local.set({ [SCHOOL_TEMPLATE_KEY]: nextTemplates });
    return schoolTemplateState({ [SCHOOL_TEMPLATE_KEY]: nextTemplates });
  }

  async function saveIdentity(payload) {
    if (
      !isRecord(payload) ||
      typeof payload.expectedRevision !== "string" ||
      !isRecord(payload.patch)
    ) {
      throw Object.assign(
        new Error("The studio identity request is invalid."),
        { code: "INVALID_PAYLOAD" },
      );
    }
    const storage = await chrome.storage.local.get([
      ROSTER_KEY,
      MASCOT_KEY,
      STADIUM_KEY,
    ]);
    if (payload.expectedRevision !== (await revisionFor(storage))) {
      throw Object.assign(
        new Error(
          "The extension state changed. Refresh the studio before saving identity changes.",
        ),
        { code: "REVISION_CONFLICT" },
      );
    }
    const catalogs = await loadCatalogs();
    const patch = payload.patch;
    const next = {};

    if (Object.hasOwn(patch, "mascot")) {
      if (patch.mascot === null) next[MASCOT_KEY] = null;
      else if (isRecord(patch.mascot)) {
        const assetName = text(patch.mascot.assetName);
        const mascot = catalogs.mascots.find(
          (candidate) => candidate.assetName === assetName,
        );
        if (!mascot)
          throw Object.assign(
            new Error("Choose a mascot from the Team Builder catalog."),
            { code: "INVALID_PAYLOAD" },
          );
        next[MASCOT_KEY] = mascot;
      } else
        throw Object.assign(new Error("The mascot selection is invalid."), {
          code: "INVALID_PAYLOAD",
        });
    }

    if (Object.hasOwn(patch, "stadium")) {
      if (patch.stadium === null) next[STADIUM_KEY] = null;
      else if (isRecord(patch.stadium)) {
        const stadiumId = patch.stadium.stadiumId;
        const stadium = catalogs.stadiums.find(
          (candidate) => candidate.stadiumId === stadiumId,
        );
        if (!stadium)
          throw Object.assign(
            new Error("Choose a stadium from the Team Builder catalog."),
            { code: "INVALID_PAYLOAD" },
          );
        next[STADIUM_KEY] = stadium;
      } else
        throw Object.assign(new Error("The stadium selection is invalid."), {
          code: "INVALID_PAYLOAD",
        });
    }

    if (!Object.keys(next).length)
      throw Object.assign(
        new Error("Choose a stadium or mascot change first."),
        { code: "INVALID_PAYLOAD" },
      );
    const removals = Object.entries(next)
      .filter(([, value]) => value === null)
      .map(([key]) => key);
    const writes = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== null),
    );
    if (Object.keys(writes).length) await writeStudioWorkspace(writes);
    if (removals.length) await removeStudioWorkspace(removals);
    return getIdentity();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      ![ROSTER_KEY, MASCOT_KEY, STADIUM_KEY, UNIFORM_KEY].some(
        (key) => changes[key],
      )
    )
      return;
    if (ignoredWorkspaceChangeEvents > 0) {
      ignoredWorkspaceChangeEvents -= 1;
      return;
    }
    void getWorkspace().then((workspace) =>
      post("TC_STUDIO_WORKSPACE_CHANGED", {
        game: "CFB27",
        revision: workspace.revision,
      }),
    );
  });

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isAllowedLocation()
    )
      return;
    const message = event.data;
    if (
      !isRecord(message) ||
      message.namespace !== NAMESPACE ||
      message.bridgeVersion !== BRIDGE_VERSION ||
      message.source !== PAGE_SOURCE ||
      typeof message.type !== "string"
    )
      return;
    if (message.requestId !== undefined && !isRequestId(message.requestId))
      return;

    if (message.type === "TC_STUDIO_HELLO") {
      post("TC_STUDIO_READY", {
        extensionVersion: chrome.runtime.getManifest().version,
        supportedGames: ["CFB27"],
        capabilities: [
          "workspace.read",
          "workspace.subscribe",
          "workspace.import",
          "identity.read",
          "identity.write",
          "identity.revision",
          "uniforms.override",
          "schoolTemplates.read",
          "schoolTemplates.write",
          "player.appearance.read",
          "player.appearance.write",
          "player.appearance.bodyType.write",
          "player.equipment.read",
          "player.equipment.write",
        ],
      });
      return;
    }

    if (!message.requestId) return;
    const request =
      message.type === "TC_STUDIO_GET_WORKSPACE"
        ? getWorkspace().then((payload) =>
            post("TC_STUDIO_WORKSPACE", payload, message.requestId),
          )
        : message.type === "TC_STUDIO_GET_ROSTER_IMPORT_SAMPLE"
          ? getRosterImportSample().then((payload) =>
              post(
                "TC_STUDIO_ROSTER_IMPORT_SAMPLE",
                payload,
                message.requestId,
              ),
            )
          : message.type === "TC_STUDIO_IMPORT_ROSTER_CSV"
            ? importRosterCsv(message.payload).then((payload) =>
                post(
                  "TC_STUDIO_ROSTER_IMPORT_RESULT",
                  payload,
                  message.requestId,
                ),
              )
            : message.type === "TC_STUDIO_GET_IDENTITY"
              ? getIdentity().then((payload) =>
                  post("TC_STUDIO_IDENTITY", payload, message.requestId),
                )
              : message.type === "TC_STUDIO_SAVE_IDENTITY"
                ? saveIdentity(message.payload).then((payload) =>
                    post("TC_STUDIO_WRITE_RESULT", payload, message.requestId),
                  )
                : message.type === "TC_STUDIO_GET_UNIFORM_OVERRIDE"
                  ? getUniformOverride().then((payload) =>
                      post(
                        "TC_STUDIO_UNIFORM_OVERRIDE",
                        payload,
                        message.requestId,
                      ),
                    )
                  : message.type === "TC_STUDIO_SAVE_UNIFORM_OVERRIDE"
                    ? saveUniformOverride(message.payload).then((payload) =>
                        post(
                          "TC_STUDIO_UNIFORM_OVERRIDE",
                          payload,
                          message.requestId,
                        ),
                      )
                : message.type === "TC_STUDIO_GET_SCHOOL_TEMPLATES"
                  ? getSchoolTemplates().then((payload) =>
                      post(
                        "TC_STUDIO_SCHOOL_TEMPLATES",
                        payload,
                        message.requestId,
                      ),
                    )
                  : message.type === "TC_STUDIO_SAVE_SCHOOL_TEMPLATES"
                    ? saveSchoolTemplates(message.payload).then((payload) =>
                        post(
                          "TC_STUDIO_SCHOOL_TEMPLATES",
                          payload,
                          message.requestId,
                        ),
                      )
                    : message.type === "TC_STUDIO_SAVE_PLAYER_APPEARANCE"
                      ? savePlayerAppearance(message.payload).then((payload) =>
                          post(
                            "TC_STUDIO_WORKSPACE",
                            payload,
                            message.requestId,
                          ),
                        )
                      : message.type === "TC_STUDIO_SAVE_PLAYER_EQUIPMENT"
                        ? savePlayerEquipment(message.payload).then((payload) =>
                            post(
                              "TC_STUDIO_WORKSPACE",
                              payload,
                              message.requestId,
                            ),
                          )
                        : Promise.reject(
                            Object.assign(
                              new Error(
                                "This studio message is not supported.",
                              ),
                              { code: "UNSUPPORTED_MESSAGE" },
                            ),
                          );
    request.catch((error) =>
      postError(
        error?.code || "BRIDGE_ERROR",
        error?.message || "The extension rejected the request.",
        message.requestId,
      ),
    );
  });
})();
