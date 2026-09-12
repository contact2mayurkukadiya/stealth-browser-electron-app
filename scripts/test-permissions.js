'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point app.getPath('userData') mock or use temporary file
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisurf-perm-test-'));
const testDbPath = path.join(tempDir, 'permissions.json');

const {
  PERMISSION_NAMES,
  PERMISSION_STATES,
  normalizeOrigin,
  isValidPermission,
  isValidState,
} = require('../main/permissions/types');

const { PermissionDatabase } = require('../main/permissions/PermissionDatabase');
const { PermissionPromptQueue } = require('../main/permissions/PermissionPromptQueue');
const { PermissionController } = require('../main/permissions/PermissionController');
const siteSettingsService = require('../main/services/siteSettingsService');

async function runTests() {
  console.log('--- Starting Enterprise Permission System Test Suite ---');

  // 1. Types & Normalization Tests
  console.log('1. Testing types and normalization...');
  assert.strictEqual(normalizeOrigin('https://google.com/search?q=test'), 'https://google.com');
  assert.strictEqual(normalizeOrigin('https://sub.domain.com:8080/path'), 'https://sub.domain.com:8080');
  assert.strictEqual(normalizeOrigin('http://localhost:3000/#hash'), 'http://localhost:3000');
  assert.strictEqual(normalizeOrigin('null'), '');
  assert.strictEqual(normalizeOrigin(''), '');
  assert.strictEqual(normalizeOrigin(null), '');

  assert.strictEqual(isValidPermission('camera'), true);
  assert.strictEqual(isValidPermission('microphone'), true);
  assert.strictEqual(isValidPermission('geolocation'), true);
  assert.strictEqual(isValidPermission('invalid-perm'), false);

  assert.strictEqual(isValidState('allow'), true);
  assert.strictEqual(isValidState('deny'), true);
  assert.strictEqual(isValidState('prompt'), true);
  assert.strictEqual(isValidState('allow-this-session'), true);
  assert.strictEqual(isValidState('invalid-state'), false);
  console.log('   ✓ Types & Normalization passed');

  // 2. PermissionDatabase Tests
  console.log('2. Testing PermissionDatabase (Persistence & Ephemeral Storage)...');
  const db = new PermissionDatabase({ storagePath: testDbPath });

  // Persistent profile
  db.set('profile-1', 'https://example.com/page', 'camera', 'allow');
  db.set('profile-1', 'https://example.com', 'microphone', 'deny');
  assert.strictEqual(db.get('profile-1', 'https://example.com', 'camera'), 'allow');
  assert.strictEqual(db.get('profile-1', 'https://example.com', 'microphone'), 'deny');
  assert.strictEqual(db.get('profile-1', 'https://example.com', 'geolocation'), null);

  // Profile isolation
  assert.strictEqual(db.get('profile-2', 'https://example.com', 'camera'), null);

  // Flush to disk and reload
  db.flushToDisk();
  assert.strictEqual(fs.existsSync(testDbPath), true);

  const db2 = new PermissionDatabase({ storagePath: testDbPath });
  assert.strictEqual(db2.get('profile-1', 'https://example.com', 'camera'), 'allow');
  assert.strictEqual(db2.get('profile-1', 'https://example.com', 'microphone'), 'deny');

  // Ephemeral profile test (Incognito)
  const ephemeralProfileId = 'stealth-win-temp-123';
  db2.registerEphemeralProfile(ephemeralProfileId);
  db2.set(ephemeralProfileId, 'https://secret.com', 'geolocation', 'allow');
  assert.strictEqual(db2.get(ephemeralProfileId, 'https://secret.com', 'geolocation'), 'allow');

  // Verify ephemeral wasn't written to disk
  db2.flushToDisk();
  const rawDisk = JSON.parse(fs.readFileSync(testDbPath, 'utf-8'));
  assert.strictEqual(rawDisk[ephemeralProfileId], undefined);

  // Unregister clears in-memory
  db2.unregisterEphemeralProfile(ephemeralProfileId);
  assert.strictEqual(db2.get(ephemeralProfileId, 'https://secret.com', 'geolocation'), null);

  // Delete & Reset
  db2.delete('profile-1', 'https://example.com', 'microphone');
  assert.strictEqual(db2.get('profile-1', 'https://example.com', 'microphone'), null);
  assert.strictEqual(db2.get('profile-1', 'https://example.com', 'camera'), 'allow');

  db2.clearOrigin('profile-1', 'https://example.com');
  assert.strictEqual(db2.get('profile-1', 'https://example.com', 'camera'), null);
  console.log('   ✓ PermissionDatabase passed');

  // 3. PermissionPromptQueue Tests
  console.log('3. Testing PermissionPromptQueue (Deduplication & Queueing)...');
  const queue = new PermissionPromptQueue();

  const State = require('../main/state');
  const fakeWindow = {
    id: 999,
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: () => {},
    },
  };
  const fakeContext = {
    window: fakeWindow,
    windowId: 'win-test-999',
    tabs: {},
  };
  State.windowContextsById.set(999, fakeContext);
  State.webContentsIdToTabId.set(101, 'tab-test-1');
  State.tabIdToWindowId.set('tab-test-1', 999);

  const fakeWebContents = {
    id: 101,
    isDestroyed: () => false,
    on: () => {},
    once: () => {},
  };

  let resolvedDecision = null;
  let resolvedPersist = null;

  queue.enqueue({
    webContents: fakeWebContents,
    origin: 'https://meeting.com',
    permission: 'camera',
    onResolve: (decision, persist) => {
      resolvedDecision = decision;
      resolvedPersist = persist;
    },
  });

  const promptId = Array.from(queue.activePrompts.keys())[0];
  assert.ok(promptId, 'Prompt ID should be generated');
  const activePrompt = queue.activePrompts.get(promptId);
  assert.strictEqual(activePrompt.origin, 'https://meeting.com');
  assert.strictEqual(activePrompt.permission, 'camera');

  // Test deduplication
  let duplicateResolved = false;
  queue.enqueue({
    webContents: fakeWebContents,
    origin: 'https://meeting.com',
    permission: 'camera',
    onResolve: () => {
      duplicateResolved = true;
    },
  });

  // Resolve active prompt
  queue.resolvePrompt(promptId, 'allow', true);
  assert.strictEqual(resolvedDecision, 'allow');
  assert.strictEqual(resolvedPersist, true);
  assert.strictEqual(duplicateResolved, true, 'Deduplicated request should resolve with merged callback');
  assert.strictEqual(queue.activePrompts.size, 0);
  console.log('   ✓ PermissionPromptQueue passed');

  // 4. PermissionController Tests
  console.log('4. Testing PermissionController (Decision logic & Session mappings)...');
  const testController = new PermissionController(db2, queue);

  // Default is prompt
  assert.strictEqual(testController.getDecision('profile-1', 'https://news.com', 'notifications'), 'prompt');
  assert.strictEqual(testController.checkPermission('profile-1', 'https://news.com', 'notifications'), false);

  // Set allow-this-session
  testController.setPermission('profile-1', 'https://news.com', 'notifications', 'allow-this-session');
  assert.strictEqual(testController.getDecision('profile-1', 'https://news.com', 'notifications'), 'allow-this-session');
  assert.strictEqual(testController.checkPermission('profile-1', 'https://news.com', 'notifications'), true);
  // Verify it is NOT in persistent db
  assert.strictEqual(db2.get('profile-1', 'https://news.com', 'notifications'), null);

  // Media type disambiguation
  assert.strictEqual(testController.mapPermissionType('media', { mediaTypes: ['video'] }), 'camera');
  assert.strictEqual(testController.mapPermissionType('media', { mediaTypes: ['audio'] }), 'microphone');
  assert.strictEqual(testController.mapPermissionType('geolocation'), 'geolocation');

  console.log('   ✓ PermissionController passed');

  // 5. SiteSettingsService Tests
  console.log('5. Testing SiteSettingsService...');
  siteSettingsService.controller = testController;

  const originState = siteSettingsService.getOriginState('profile-1', 'https://news.com');
  assert.strictEqual(originState.origin, 'https://news.com');
  const notifPerm = originState.permissions.find(p => p.name === 'notifications');
  assert.ok(notifPerm);
  assert.strictEqual(notifPerm.state, 'allow-this-session');

  siteSettingsService.setOriginPermission('profile-1', 'https://news.com', 'camera', 'deny', true);
  const updatedState = siteSettingsService.getOriginState('profile-1', 'https://news.com');
  const cameraPerm = updatedState.permissions.find(p => p.name === 'camera');
  assert.strictEqual(cameraPerm.state, 'deny');

  // Test bare domain normalization and reset
  assert.strictEqual(normalizeOrigin('webcamtests.com'), 'https://webcamtests.com');
  siteSettingsService.setOriginPermission('profile-1', 'webcamtests.com', 'camera', 'allow', true);
  const bareDomainState = siteSettingsService.getOriginState('profile-1', 'webcamtests.com');
  assert.strictEqual(bareDomainState.origin, 'https://webcamtests.com');
  assert.strictEqual(bareDomainState.permissions.find(p => p.name === 'camera').state, 'allow');

  // Reset bare domain
  siteSettingsService.resetOrigin('profile-1', 'webcamtests.com');
  const bareResetState = siteSettingsService.getOriginState('profile-1', 'webcamtests.com');
  assert.strictEqual(bareResetState.permissions.find(p => p.name === 'camera').state, 'prompt');
  console.log('   ✓ Bare domain normalization and reset passed');
  console.log('   ✓ SiteSettingsService passed');

  // Cleanup
  db.destroy();
  db2.destroy();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('--- ALL PERMISSION SYSTEM TESTS PASSED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
