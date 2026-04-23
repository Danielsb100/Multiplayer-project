import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Pathfinding } from 'three-pathfinding';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// Global variables for pathfinding
const _pathfinding = new Pathfinding();
const _navmeshZone = 'level1';
let localPlayerPath = null;

// --- 0. Socket & Login ---
let socket = null;
let localUsername = '';
let localProfilePicture = null;
let authToken = '';
let localUserRole = 'USER'; // New: Store user role
const loginScreen = document.getElementById('login-screen');
const joinBtn = document.getElementById('join-btn');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginError = document.getElementById('login-error');
let AUTH_API = 'https://login-system-production-84c6.up.railway.app';
const COURSE_ID_FROM_URL = Number(new URLSearchParams(window.location.search).get('courseId')) || null;
document.body.classList.toggle('course-world-mode', Boolean(COURSE_ID_FROM_URL));
window.__courseWorldContext = { courseId: COURSE_ID_FROM_URL, runtime: null };
const courseRoomContextCard = document.getElementById('course-room-context');
const courseRoomContextCourse = document.getElementById('course-room-context-course');
const courseRoomContextRoom = document.getElementById('course-room-context-room');
let courseRoomShells = [];
let courseRoomColliderIds = [];
let activeCourseRoomModuleId = null;
const COURSE_ROOM_MODEL_CONFIG = Object.freeze({
    paths: Object.freeze({
        first: 'assets/course-room/room-first.glb',
        middle: 'assets/course-room/room-middle.glb',
        last: 'assets/course-room/room-last.glb'
    }),
    fallbackPath: 'assets/course-room/room-shell.glb',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotationY: 0,
    minimumWidth: 14,
    minimumDepth: 10,
    spacingPadding: 0
});
const DEFAULT_COURSE_ROOM_LAYOUT = Object.freeze({
    roomWidth: COURSE_ROOM_MODEL_CONFIG.minimumWidth,
    roomDepth: COURSE_ROOM_MODEL_CONFIG.minimumDepth,
    roomSpacing: COURSE_ROOM_MODEL_CONFIG.minimumWidth,
    source: 'procedural'
});
let courseRoomModelTemplatesPromise = null;
let courseRoomModelTemplates = null;
let courseRoomModelLoadFailed = false;
let courseRoomRenderVersion = 0;
let courseRoomLayoutMetrics = { ...DEFAULT_COURSE_ROOM_LAYOUT };

// Auth Elements
const authTabs = document.querySelector('.auth-tabs');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const loginSection = document.getElementById('login-section');
const registerSection = document.getElementById('register-section');
const regUsernameInput = document.getElementById('reg-username');
const regEmailInput = document.getElementById('reg-email');
const regPasswordInput = document.getElementById('reg-password');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');

// Map to track object IDs to Three.js UUIDs
const idToUuid = {};

// Custom Cursor
const customCursor = document.getElementById('custom-cursor');
window.addEventListener('mousemove', (e) => {
    customCursor.style.left = e.clientX + 'px';
    customCursor.style.top = e.clientY + 'px';
});
window.addEventListener('mousedown', () => customCursor.classList.add('clicking'));
window.addEventListener('mouseup', () => customCursor.classList.remove('clicking'));

// Input state vars removed

// Advanced Cube Placement State
const PlacementState = { NONE: 0, BASE: 1, HEIGHT: 2 };
let currentPlacementState = PlacementState.NONE;
let placementStartPoint = new THREE.Vector3();
let placementBasePoint = new THREE.Vector3();
let previewCube = null;
let lastMouseY = 0;
const MAX_CUBE_HEIGHT = 8;
console.log("GAME_LOADED: Version 1.3.1 - VIDEO_IDENTITY_FIXED");

let lastStateChangeTime = 0;
const STATE_CHANGE_DEBOUNCE = 300; // ms
const PRIMARY_DRAG_PAN_THRESHOLD = 8;
let primaryPointerState = null;

// User Color Logic
const LOGIN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff', '#94a3b8'];
let localUserColor = LOGIN_COLORS[Math.floor(Math.random() * LOGIN_COLORS.length)];
let interactionPointGlobal = null;
let didInteractThisFrame = false; // Missing variable fix
let isJumping = false;           // MISSING VARIABLE FIX (ROUND 2)
let jumpTime = 0;                // MISSING VARIABLE FIX (ROUND 2)
const JUMP_DURATION = 0.6;       // MISSING VARIABLE FIX (ROUND 2)
let localPlayerSocketId = null;  // New to track identity robustly
const loginColorOptions = document.querySelectorAll('.login-color-option');

// Initialize login color selection
loginColorOptions.forEach(opt => {
    const color = opt.dataset.color;
    if (color === localUserColor) opt.classList.add('active');
    opt.addEventListener('click', () => {
        loginColorOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        localUserColor = color;
    });
});

// Context Menu State
let isMenuOpen = false;
let contextMenuTarget = null;
let contextMenuPoint = new THREE.Vector3();

// --- Collision Structures ---
const wallBoxes = [];
const preciseColliders = [];
const GRID_SIZE = 1.0;
const activeLoads = new Set();
const abortedLoads = new Set();



function snapToGrid(v) {
    if (!v) return v;
    return new THREE.Vector3(
        Math.round(v.x / GRID_SIZE) * GRID_SIZE,
        v.y,
        Math.round(v.z / GRID_SIZE) * GRID_SIZE
    );
}

const contextMenu = document.getElementById('context-menu');
const menuGroundSection = document.getElementById('menu-ground-section');
const menuCubeSection = document.getElementById('menu-cube-section');
const menuModelSection = document.getElementById('menu-model-section');
const menuPlacementSection = document.getElementById('menu-placement-section'); // New
const contextGlbUpload = document.getElementById('context-glb-upload');
const menuPlaceModule = document.getElementById('menu-place-module');
const menuImportPlacementGlb = document.getElementById('menu-import-placement-glb');
const placementModelUpload = document.getElementById('placement-model-upload');
const placementMixers = {};

// Catalog State & UI
let catalogData = { characters: [], models: [], structures: [] };
let selectedCatalogModelUrl = null;
let selectedCatalogAnims = null;
const catalogOverlay = document.getElementById('catalog-overlay');
const catalogGrid = document.getElementById('catalog-grid');
const catalogTitle = document.getElementById('catalog-title');
const closeCatalogBtn = document.getElementById('close-catalog');

// Player Interaction UI
const playerActionMenu = document.getElementById('player-action-menu');
const actionMenuName = document.getElementById('action-menu-name');
const btnCallPlayer = document.getElementById('btn-call-player');
const btnViewAssets = document.getElementById('btn-view-assets');

const assetModalOverlay = document.getElementById('asset-modal-overlay');
const modalUsernameSpan = document.getElementById('modal-username');
const assetListBody = document.getElementById('asset-list-body');
const assetThDate = document.getElementById('asset-th-date');
const assetGridContainer = document.getElementById('asset-grid-container');
const assetListTable = document.querySelector('.asset-list-container');
const previewModal = document.getElementById('media-preview-modal');
const previewContent = document.getElementById('preview-content');
const closePreviewBtn = document.getElementById('close-media-preview');
const btnDownloadPreview = document.getElementById('btn-download-preview');
const tabBtns = document.querySelectorAll('.tab-btn');
const closeAssetModalBtn = document.getElementById('close-asset-modal');
const btnUploadAsset = document.getElementById('btn-upload-asset');
const selfAssetUploadInput = document.getElementById('self-asset-upload');

let currentAssetTab = 'image';
let currentLoadedAssets = [];
let isSelfModal = false;

let selectedPlayerForAction = null;
let selectedPlayerPeerId = null;
// Char catalog button removed
const menuCatalogModels = document.getElementById('menu-catalog-models');

// Fetch catalog data immediately via HTTP
fetch('/api/catalog')
    .then(res => res.json())
    .then(data => { catalogData = data; })
    .catch(err => console.error("Error fetching catalog:", err));

// --- Empty State ---
let isGrounded = true;

// --- Auth Tab Switching ---
if (tabLogin && tabRegister) {
    tabLogin.onclick = () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginSection.classList.remove('hidden');
        registerSection.classList.add('hidden');
    };
    tabRegister.onclick = () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerSection.classList.remove('hidden');
        loginSection.classList.add('hidden');
    };
}

// PeerJS & Audio State
let peer = null;
let localStream = null;
let currentCall = null;
const peerIdToName = {};
let callDurationInterval = null;
let secondsElapsed = 0;
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationFrameId = null;

// Audio DOM Elements
const audioCallLayer = document.getElementById('audio-call-layer');
const callingName = document.getElementById('calling-name');
const callTimer = document.getElementById('call-timer');
const remoteAudio = document.getElementById('remote-audio');
const incomingModal = document.getElementById('incoming-modal');
const incomingCaller = document.getElementById('incoming-caller');
const btnMute = document.getElementById('btn-mute');
const btnCamera = document.getElementById('btn-camera'); // New
const btnHangup = document.getElementById('btn-hangup');
const btnAnswer = document.getElementById('btn-answer');
const btnReject = document.getElementById('btn-reject');

// Video Elements
const videoContainer = document.getElementById('video-container');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');

// Player List DOM
const playerListContainer = document.getElementById('player-list-container');
const playerListContent = document.getElementById('player-list-content');
const worldOperationsCard = document.getElementById('world-operations-card');
const worldOperationsUnread = document.getElementById('world-operations-unread');
const worldOperationsUrgent = document.getElementById('world-operations-urgent');
const worldOperationsList = document.getElementById('world-operations-list');
const worldOperationsLink = document.getElementById('world-operations-link');
let worldOperationsRefreshTimer = null;

function isOverUI(event) {
    return event.target.closest('.ui-layer') || event.target.closest('.context-menu');
}

function escapeWorldHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderWorldOperationsSummary(summary) {
    if (!worldOperationsCard || !worldOperationsList || !summary?.counts) return;

    const hasPending = summary.counts.unread > 0 || summary.counts.totalPending > 0 || summary.counts.remindersOpen > 0;
    worldOperationsCard.classList.toggle('hidden', !hasPending);
    if (!hasPending) return;

    worldOperationsUnread.textContent = `${summary.counts.unread} unread`;
    worldOperationsUrgent.textContent = `${summary.counts.urgent} urgent`;
    if (worldOperationsLink) {
        worldOperationsLink.href = `${AUTH_API}/dashboard.html`;
    }

    const highlightedItems = [
        ...(summary.operational?.urgent || []),
        ...(summary.operational?.today || []),
        ...(summary.inbox || []).filter((item) => item.status === 'UNREAD')
    ].slice(0, 3);

    if (!highlightedItems.length) {
        worldOperationsList.innerHTML = '<li class="world-operations-empty">No pending items right now.</li>';
        return;
    }

    worldOperationsList.innerHTML = highlightedItems.map((item) => `
        <li class="world-operations-item">
            <strong>${escapeWorldHtml(item.title || 'Operational item')}</strong>
            <span>${escapeWorldHtml(item.summary || item.message || 'Open the dashboard to follow the details.')}</span>
        </li>
    `).join('');
}

async function refreshWorldOperationsSummary() {
    if (!authToken || !AUTH_API) return;

    try {
        const response = await fetch(`${AUTH_API}/api/notifications/summary`, {
            headers: {
                Authorization: `Bearer ${authToken}`
            }
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load operational summary');
        }

        renderWorldOperationsSummary(result);
    } catch (error) {
        console.error('Failed to refresh world operations summary:', error);
    }
}



joinBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        loginError.innerText = "Please enter email and password";
        loginError.classList.remove('hidden');
        return;
    }

    joinBtn.disabled = true;
    joinBtn.innerText = "Connecting...";
    loginError.classList.add('hidden');

    try {
        const response = await fetch(`${AUTH_API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Login failed");

        await performJoin(result.token, result.user);
    } catch (err) {
        console.error("Login error:", err);
        loginError.innerText = err.message;
        loginError.classList.remove('hidden');
        joinBtn.disabled = false;
        joinBtn.innerText = "Enter the World";
    }
});

/**
 * Funçao centralizada para entrar no mundo após ter o token
 */
async function performJoin(token, user) {
    if (socket && socket.connected) return;

    authToken = token;
    localUsername = user?.username || "Guest";
    localProfilePicture = user?.profilePicture || null;
    localUserRole = user?.role || 'USER';

    // Initialize socket with the received token
    // @ts-ignore
    socket = io({
        auth: { token: authToken }
    });

    // Setup socket listeners
    setupSocketListeners();

    // Emit initial user data
    socket.emit('setName', { name: localUsername, color: localUserColor, profilePicture: localProfilePicture });

    // Load the static player character directly
    const playerModelPath = 'assets/character/player.glb?v=' + Date.now();
    socket.emit('modelUpdate', { path: playerModelPath });
    loadPlayerModel(playerModelPath, localUserColor, playerGroup, true);

    playerGroup.visible = true;
    loginScreen.classList.add('hidden');

    // We need to wait for socket.id to be available if possible, 
    // but setupSocketListeners will handle it when connected.
    // For local immediate feedback:
    createGametag("local", localUsername, localUserColor, true, localProfilePicture);

    // Initialize PeerJS for audio calls
    initPeer();

    playerListContainer.classList.remove('hidden');
    updatePlayerList();
    await refreshWorldOperationsSummary();
    if (worldOperationsRefreshTimer) clearInterval(worldOperationsRefreshTimer);
    worldOperationsRefreshTimer = setInterval(refreshWorldOperationsSummary, 60000);

    if (document.activeElement) document.activeElement.blur();
    window.focus();

    console.log(`Successfully joined as ${localUsername} (${localUserRole})`);
}

/**
 * Verifica se há um token na URL para login automático
 */
async function checkAutoLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        console.log("Auto-login token detected. Verifying...");
        joinBtn.disabled = true;
        joinBtn.innerText = "Auto-Authenticating...";

        try {
            const response = await fetch(`${AUTH_API}/auth/verify`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const result = await response.json();
            if (!response.ok) throw new Error("Invalid auto-login token");

            await performJoin(token, result.user);

            // Clean up URL to hide token
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.error("Auto-login failed:", err);
            loginError.innerText = "Session expired. Please log in again.";
            loginError.classList.remove('hidden');
            joinBtn.disabled = false;
            joinBtn.innerText = "Enter the World";
        }
    }
}

// Fetch dynamic config from server on start
fetch('/api/config')
    .then(res => res.json())
    .then(data => {
        if (data.LOGIN_SYSTEM_URL) {
            AUTH_API = data.LOGIN_SYSTEM_URL;
        }
        const registerLink = document.getElementById('register-link');
        if (registerLink) {
            registerLink.href = AUTH_API; // Set the href dynamically
        }
        // Call auto-login check on start
        checkAutoLogin();
    })
    .catch(err => {
        console.error("Failed to load config, falling back to default.", err);
        checkAutoLogin();
    });

// --- Handle Register ---
async function handleRegister() {
    registerError.innerText = '';
    const username = regUsernameInput.value.trim();
    const email = regEmailInput.value.trim();
    const password = regPasswordInput.value;

    if (!username || !email || !password) {
        registerError.innerText = 'Preencha todos os campos.';
        return;
    }

    try {
        registerBtn.disabled = true;
        registerBtn.innerText = 'Criando conta...';

        const response = await fetch(`${AUTH_API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro no registro');

        // Post-register: clear inputs and switch to login with a success message
        alert('Account created successfully! Log in to enter.');
        regUsernameInput.value = '';
        regEmailInput.value = '';
        regPasswordInput.value = '';
        tabLogin.click(); // Switch to login tab
        emailInput.value = email; // Pre-fill email for login
    } catch (err) {
        registerError.innerText = err.message;
    } finally {
        registerBtn.disabled = false;
        registerBtn.innerText = 'Sign Up';
    }
}

if (registerBtn) {
    registerBtn.onclick = handleRegister;
}

function setupSocketListeners() {
    socket.on('connect', () => {
        localPlayerSocketId = socket.id;
        console.log("Socket connected! ID:", socket.id);
    });

    socket.on('connect_error', (err) => {
        console.error("Socket connection error:", err.message);
        loginError.innerText = "Connection failed: " + err.message;
        loginError.classList.remove('hidden');

        // Show login screen again if connection was rejected
        loginScreen.classList.remove('hidden');
        playerGroup.visible = false;
        joinBtn.disabled = false;
        joinBtn.innerText = "Enter the World";
    });

    socket.on('currentPlayers', (players) => {
        console.log("Received currentPlayers count:", Object.keys(players).length);
        Object.keys(players).forEach((id) => {
            // CRITICAL: Robust identity check using both socket.id and local tracker
            if (id === socket.id || id === localPlayerSocketId) {
                console.log("Skipping local player in currentPlayers sync:", id);
                return;
            }
            addOtherPlayer(players[id]);
            if (players[id].peerId) peerIdToName[players[id].peerId] = players[id].name;
        });
        updatePlayerList();
    });

    socket.on('newPlayer', (playerInfo) => {
        if (playerInfo.id === socket.id || playerInfo.id === localPlayerSocketId) return;
        console.log("New player joined:", playerInfo.id, playerInfo.name);
        addOtherPlayer(playerInfo);
        updatePlayerList();
    });

    socket.on('playerMoved', (playerInfo) => {
        if (playerInfo.id === socket.id || playerInfo.id === localPlayerSocketId) return; // Ignore self
        if (remotePlayers[playerInfo.id]) {
            const p = remotePlayers[playerInfo.id];

            if (playerInfo.position) {
                console.log(`[Replication] Received move for ${playerInfo.id}:`, playerInfo.position);
                p.targetPosition.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
            }
            if (playerInfo.rotation) {
                p.targetRotation.set(
                    playerInfo.rotation.x,
                    playerInfo.rotation.y,
                    playerInfo.rotation.z
                );
            }
        }
    });

    socket.on('playerUpdated', (playerInfo) => {
        console.log("Player updated sync:", playerInfo.id, playerInfo.name);
        createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false, playerInfo.profilePicture);
        if (remotePlayers[playerInfo.id]) {
            remotePlayers[playerInfo.id].name = playerInfo.name;
            remotePlayers[playerInfo.id].color = playerInfo.color;
            if (remotePlayers[playerInfo.id].mainMesh) {
                applyCharacterColor(remotePlayers[playerInfo.id].mainMesh, playerInfo.color);
            }
        }
        updatePlayerList();
    });

    socket.on('playerDisconnected', (id) => {
        console.log("Player disconnected:", id);
        if (remotePlayers[id]) {
            scene.remove(remotePlayers[id].group);
            delete remotePlayers[id];
        }
        removeGametag(id);
        updatePlayerList();
    });

    socket.on('playerPeerUpdated', (data) => {
        if (remotePlayers[data.id]) {
            remotePlayers[data.id].peerId = data.peerId;
            peerIdToName[data.peerId] = remotePlayers[data.id].name || 'Player';
            updatePlayerList();
        }
    });

    socket.on('playerModelUpdated', (data) => {
        if (data.id === socket.id) return; // Ignore self
        console.log("Remote player model update received:", data.id);
        if (remotePlayers[data.id]) {
            const mData = data.modelData;
            if (mData) {
                if (mData.buffer) {
                    loadModelFromBuffer(mData.buffer, remotePlayers[data.id], data.color);
                } else if (mData.path) {
                    const pathWithCacheBuster = mData.path + '?v=' + Date.now();
                    loadPlayerModel(pathWithCacheBuster, data.color || remotePlayers[data.id].color, remotePlayers[data.id].avatarContainer, false, data.id);
                }
            }
        }
    });

    socket.on('initialCubes', (cubes) => {
        if (cubes) cubes.forEach(cube => createCube(cube));
    });

    socket.on('initialModels', (models) => {
        if (models) models.forEach(model => createPlacedModel(model));
    });

    socket.on('initialModulePlacements', (placements) => {
        if (COURSE_ID_FROM_URL) {
            return;
        }
        if (placements) placements.forEach(p => createModulePlacement(p));
        // Also fetch from DB in case some are not in transient memory
        fetchModulePlacements();
    });

    socket.on('modulePlacementAdded', (data) => {
        if (COURSE_ID_FROM_URL) return;
        createModulePlacement(data);
    });

    socket.on('modulePlacementUpdated', (data) => {
        if (COURSE_ID_FROM_URL) return;
        let obj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
        if (!obj) {
            // Fallback: search by id in userData
            scene.traverse(child => { if (child.userData && child.userData.id == data.id) obj = child; });
        }
        if (obj) {
            obj.userData.moduleId = data.moduleId;
            obj.userData.moduleTitle = data.moduleTitle || '';
            obj.userData.status = data.status || 'NONE';
            if (obj.userData.refreshBadge) obj.userData.refreshBadge();
        }
    });

    socket.on('modulePlacementDeleted', (id) => {
        if (COURSE_ID_FROM_URL) return;
        const uuid = idToUuid[id];
        let obj = uuid ? scene.getObjectByProperty('uuid', uuid) : null;
        if (!obj) {
            // Fallback: search by id in userData
            scene.traverse(child => { if (child.userData && child.userData.id == id) obj = child; });
        }
        if (obj) {
            // Cleanup collisions if any (though placements usually don't have them)
            scene.remove(obj);
        }
        delete idToUuid[id];
    });

    socket.on('cubeAdded', (cube) => {
        createCube(cube);
    });

    socket.on('modelAdded', (model) => {
        createPlacedModel(model);
    });

    socket.on('objectDeleted', (id) => {
        const uuid = idToUuid[id];
        if (uuid) {
            const obj = scene.getObjectByProperty('uuid', uuid);
            if (obj) scene.remove(obj);
        }
        for (let i = wallBoxes.length - 1; i >= 0; i--) {
            if (wallBoxes[i].relatedId == id) wallBoxes.splice(i, 1);
        }
        for (let i = preciseColliders.length - 1; i >= 0; i--) {
            if (preciseColliders[i].userData && preciseColliders[i].userData.id == id) {
                preciseColliders.splice(i, 1);
            }
        }
        delete idToUuid[id];
    });

    socket.on('objectUpdated', (data) => {
        const obj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
        if (obj) {
            if (data.color) {
                if (obj.material) obj.material.color.set(data.color);
                else {
                    obj.traverse(child => {
                        if (child.isMesh && child.material && !child.name.toLowerCase().includes('collision')) {
                            child.material.color.set(data.color);
                        }
                    });
                }
            }
            if (data.rotation) {
                obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
                obj.updateMatrixWorld(true);
                for (const box of wallBoxes) {
                    if (box.relatedId == data.id) box.setFromObject(obj);
                }
            }
        }
    });

    socket.on('chatMessage', (data) => {
        addMessageToChat(data);
    });

    socket.on('initialChatHistory', (history) => {
        if (history) history.forEach(msg => addMessageToChat(msg));
    });

    socket.on('modulePlacementModelUpdated', (data) => {
        let obj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
        if (!obj) {
            scene.traverse(child => { if (child.userData && child.userData.id == data.id) obj = child; });
        }
        if (obj && obj.userData.refreshModel) {
            obj.userData.idleAnimName = data.idleAnim || 'idle';
            obj.userData.interactedAnimName = data.interactedAnim || 'interacted';
            obj.userData.refreshModel();
        }
    });
}

// Character selection hook removed

closeCatalogBtn.addEventListener('click', () => catalogOverlay.classList.add('hidden'));

function renderCatalog(type, onSelect) {
    catalogGrid.innerHTML = '';

    if (type === 'characters') catalogTitle.innerText = 'Escolher Avatar';
    else if (type === 'structures') catalogTitle.innerText = 'Elementos de Estrutura';
    else catalogTitle.innerText = 'Object Catalog';

    catalogData[type].forEach(item => {
        const div = document.createElement('div');
        div.className = 'catalog-item';
        div.innerHTML = `
            <img src="${item.icon}" onerror="this.src='assets/default.png'">
            <span>${item.name}</span>
        `;
        div.onclick = (e) => {
            e.stopPropagation();
            console.log("Catalog Item Selected:", item.name);
            try {
                onSelect(item);
                catalogOverlay.classList.add('hidden');
                closeContextMenu();
            } catch (err) {
                console.error("Error in catalog onSelect:", err);
                catalogOverlay.classList.add('hidden');
                closeContextMenu();
            }
        };
        catalogGrid.appendChild(div);
    });
}

function openCatalog(type, onSelect) {
    renderCatalog(type, onSelect);
    catalogOverlay.classList.remove('hidden');
}

// --- 1. Scene Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f8f9fa');
scene.fog = new THREE.FogExp2('#f8f9fa', 0.005); // Relaxed fog for production visibility

const clock = new THREE.Clock(); // For animations

const frustumSize = 15;
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2, frustumSize * aspect / 2,
    frustumSize / 2, frustumSize / -2, -2000, 2000 // Extended clipping for production
);
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.zoomSpeed = 0.8; // More gradual zoom for mouse side-buttons
controls.minZoom = 0.001; // Guard against scene disappearance
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.9;
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
controls.target.set(0, 0, 0);
controls.enableRotate = false; // Keep isometric view

function createCourseModeBaseEnvironment() {
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(220, 220),
        new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    floor.userData.id = 'course_floor';
    scene.add(floor);

    // const grid = new THREE.GridHelper(220, 22, 0x334155, 0x1e293b);
    // grid.position.y = 0.01;
    // scene.add(grid);
}

function prepareCourseRoomModelTemplate(root) {
    root.updateMatrixWorld(true);
    root.traverse((child) => {
        const name = child.name ? child.name.toLowerCase() : '';
        if (name.includes('navmesh') || name.includes('collision')) {
            child.visible = false;
            return;
        }

        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
    });
    return root;
}

function loadSingleCourseRoomModelTemplate(path, label) {
    const loader = new GLTFLoader();
    return new Promise((resolve) => {
        loader.load(
            path,
            (gltf) => resolve(prepareCourseRoomModelTemplate(gltf.scene)),
            undefined,
            (error) => {
                console.warn(`Course room model "${label}" not loaded from ${path}.`, error);
                resolve(null);
            }
        );
    });
}

function calculateCourseRoomLayoutFromTemplate(template) {
    if (!template) {
        return { ...DEFAULT_COURSE_ROOM_LAYOUT };
    }

    const probe = template.clone(true);
    probe.position.set(
        COURSE_ROOM_MODEL_CONFIG.position.x,
        COURSE_ROOM_MODEL_CONFIG.position.y,
        COURSE_ROOM_MODEL_CONFIG.position.z
    );
    probe.scale.set(
        COURSE_ROOM_MODEL_CONFIG.scale.x,
        COURSE_ROOM_MODEL_CONFIG.scale.y,
        COURSE_ROOM_MODEL_CONFIG.scale.z
    );
    probe.rotation.y = COURSE_ROOM_MODEL_CONFIG.rotationY;
    probe.updateMatrixWorld(true);

    // Filter out navmesh/nodes so they don't inflate the room width and cause gaps
    probe.traverse((child) => {
        if (child.isMesh) {
            const name = child.name ? child.name.toLowerCase() : '';
            if (name.includes('navmesh') || name.includes('node') || name.includes('door') || name.includes('tongue')) {
                child.visible = false;
                // Temporarily detach/move or just use a more surgical box calculation
                // For setFromObject, we can just set visible to false and it will be ignored by default
            }
        }
    });

    const box = new THREE.Box3().setFromObject(probe);
    const size = box.getSize(new THREE.Vector3());
    const roomWidth = Math.max(COURSE_ROOM_MODEL_CONFIG.minimumWidth, Number.isFinite(size.x) ? size.x : COURSE_ROOM_MODEL_CONFIG.minimumWidth);
    const roomDepth = Math.max(COURSE_ROOM_MODEL_CONFIG.minimumDepth, Number.isFinite(size.z) ? size.z : COURSE_ROOM_MODEL_CONFIG.minimumDepth);

    return {
        roomWidth,
        roomDepth,
        roomSpacing: roomWidth + COURSE_ROOM_MODEL_CONFIG.spacingPadding,
        source: 'model'
    };
}

function calculateCourseRoomLayoutFromTemplates(templates) {
    const availableTemplates = Object.values(templates || {}).filter(Boolean);
    if (!availableTemplates.length) {
        return { ...DEFAULT_COURSE_ROOM_LAYOUT };
    }

    const templateLayouts = availableTemplates.map((template) => calculateCourseRoomLayoutFromTemplate(template));
    const roomWidth = Math.max(...templateLayouts.map((layout) => layout.roomWidth));
    const roomDepth = Math.max(...templateLayouts.map((layout) => layout.roomDepth));

    return {
        roomWidth,
        roomDepth,
        roomSpacing: roomWidth + COURSE_ROOM_MODEL_CONFIG.spacingPadding,
        source: 'model'
    };
}

function setCourseRoomLayoutMetrics(nextMetrics) {
    const prev = courseRoomLayoutMetrics;
    const changed = !prev
        || Math.abs(prev.roomWidth - nextMetrics.roomWidth) > 0.01
        || Math.abs(prev.roomDepth - nextMetrics.roomDepth) > 0.01
        || Math.abs(prev.roomSpacing - nextMetrics.roomSpacing) > 0.01
        || prev.source !== nextMetrics.source;

    if (changed) {
        courseRoomLayoutMetrics = { ...nextMetrics };
    }

    return changed;
}

function getCourseRoomLayoutMetrics() {
    return { ...courseRoomLayoutMetrics };
}

function getCourseRoomPlacement(index, y = 0) {
    return {
        x: index * (courseRoomLayoutMetrics?.roomSpacing || 14),
        y,
        z: 0
    };
}

function getCourseRoomModelRole(index, totalModules) {
    if (totalModules <= 1 || index === 0) {
        return 'first';
    }
    if (index === totalModules - 1) {
        return 'last';
    }
    return 'middle';
}

function getCourseRoomModelTemplateForIndex(index, totalModules, templates = courseRoomModelTemplates) {
    if (!templates) return null;

    const role = getCourseRoomModelRole(index, totalModules);
    return templates[role] || templates.middle || templates.first || templates.last || null;
}

function getCourseRuntimePlacementId(module, index) {
    return module?.placement?.id || `course-${COURSE_ID_FROM_URL}-module-${module?.moduleId ?? index}`;
}

function syncCoursePlacementObjects(runtime, centers) {
    if (!runtime?.modules?.length || !centers?.length) return;

    runtime.modules.forEach((module, index) => {
        const placementId = getCourseRuntimePlacementId(module, index);
        const placementObject = scene.getObjectByProperty('uuid', idToUuid[placementId]);
        if (!placementObject) return;

        const center = centers[index];
        placementObject.position.set(center.x, center.y, center.z);
    });
}

function loadCourseRoomModelTemplates() {
    if (courseRoomModelLoadFailed) {
        return Promise.resolve(null);
    }
    if (courseRoomModelTemplates) {
        return Promise.resolve(courseRoomModelTemplates);
    }
    if (courseRoomModelTemplatesPromise) {
        return courseRoomModelTemplatesPromise;
    }

    courseRoomModelTemplatesPromise = Promise.all([
        loadSingleCourseRoomModelTemplate(COURSE_ROOM_MODEL_CONFIG.paths.first, 'first'),
        loadSingleCourseRoomModelTemplate(COURSE_ROOM_MODEL_CONFIG.paths.middle, 'middle'),
        loadSingleCourseRoomModelTemplate(COURSE_ROOM_MODEL_CONFIG.paths.last, 'last'),
        loadSingleCourseRoomModelTemplate(COURSE_ROOM_MODEL_CONFIG.fallbackPath, 'fallback')
    ]).then(([firstTemplate, middleTemplate, lastTemplate, fallbackTemplate]) => {
        const templates = {
            first: firstTemplate || fallbackTemplate || middleTemplate || lastTemplate || null,
            middle: middleTemplate || fallbackTemplate || firstTemplate || lastTemplate || null,
            last: lastTemplate || fallbackTemplate || middleTemplate || firstTemplate || null
        };

        if (!templates.first && !templates.middle && !templates.last) {
            courseRoomModelLoadFailed = true;
            setCourseRoomLayoutMetrics({ ...DEFAULT_COURSE_ROOM_LAYOUT });
            return null;
        }

        courseRoomModelTemplates = templates;
        setCourseRoomLayoutMetrics(calculateCourseRoomLayoutFromTemplates(courseRoomModelTemplates));
        return courseRoomModelTemplates;
    });

    return courseRoomModelTemplatesPromise;
}

function clearCourseRoomShells() {
    courseRoomShells.forEach((room) => {
        if (room.group?.parent) {
            scene.remove(room.group);
        }
    });
    if (courseRoomColliderIds.length) {
        for (let i = wallBoxes.length - 1; i >= 0; i -= 1) {
            if (courseRoomColliderIds.includes(wallBoxes[i].relatedId)) {
                wallBoxes.splice(i, 1);
            }
        }
    }
    courseRoomColliderIds = [];
    courseRoomShells = [];
}

function updateCourseRoomContext() {
    if (!COURSE_ID_FROM_URL || !courseRoomContextCard || !courseRoomContextCourse || !courseRoomContextRoom) return;
    const runtime = window.__courseWorldContext?.runtime;
    if (!runtime) return;

    courseRoomContextCard.classList.remove('hidden');
    courseRoomContextCourse.textContent = runtime.title || 'Course world';

    const currentRoom = courseRoomShells.find((room) => {
        const dx = Math.abs(playerGroup.position.x - room.center.x);
        const dz = Math.abs(playerGroup.position.z - room.center.z);
        return dx <= room.halfWidth && dz <= room.halfDepth;
    }) || null;

    if (!currentRoom) {
        activeCourseRoomModuleId = null;
        courseRoomContextRoom.textContent = 'Between rooms';
        return;
    }

    if (activeCourseRoomModuleId !== currentRoom.moduleId) {
        activeCourseRoomModuleId = currentRoom.moduleId;
    }
    courseRoomContextRoom.textContent = `Room Module ${currentRoom.index + 1} — ${currentRoom.title}`;
}

function renderCourseRoomShells(runtime) {
    if (!COURSE_ID_FROM_URL) return;
    clearCourseRoomShells();
    if (!runtime?.modules?.length) {
        updateCourseRoomContext();
        return;
    }

    const renderVersion = ++courseRoomRenderVersion;
    if (!courseRoomModelTemplates && !courseRoomModelLoadFailed) {
        loadCourseRoomModelTemplates().then((templates) => {
            if (!templates || courseRoomRenderVersion !== renderVersion) return;
            renderCourseRoomShells(runtime);
        });
    }

    const roomTemplates = courseRoomModelTemplates;
    const layoutMetrics = roomTemplates
        ? calculateCourseRoomLayoutFromTemplates(roomTemplates)
        : getCourseRoomLayoutMetrics();
    setCourseRoomLayoutMetrics(layoutMetrics);

    const roomWidth = layoutMetrics.roomWidth;
    const roomDepth = layoutMetrics.roomDepth;
    const wallHeight = 3;
    const wallThickness = 0.25;
    const doorWidth = 3.2;
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.95, metalness: 0.05 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x1d4ed8, emissiveIntensity: 0.12 });
    const doorBlockerMaterial = new THREE.MeshStandardMaterial({
        color: 0x1d4ed8,
        emissive: 0x60a5fa,
        emissiveIntensity: 0.22,
        metalness: 0.08,
        roughness: 0.45,
        transparent: true,
        opacity: 0.94
    });
    const roomSpacing = layoutMetrics.roomSpacing;
    const centers = runtime.modules.map((module, index) => ({
        ...getCourseRoomPlacement(index, module?.placement?.position?.y ?? 0)
    }));

    const registerCourseCollider = (mesh, relatedId) => {
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        box.relatedId = relatedId;
        wallBoxes.push(box);
        courseRoomColliderIds.push(relatedId);
    };

    const addWallSegment = (group, width, depth, x, z, colliderId) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), wallMaterial.clone());
        wall.position.set(x, wallHeight / 2, z);
        wall.userData.courseStructure = true;
        group.add(wall);
        registerCourseCollider(wall, colliderId);
        return wall;
    };

    const buildNorthSouthWall = (group, center, orientation, colliderBaseId) => {
        const z = center.z + (orientation === 'south' ? roomDepth / 2 : -roomDepth / 2);
        return addWallSegment(group, roomWidth, wallThickness, center.x, z, `${colliderBaseId}_${orientation}`);
    };

    const buildSharedWall = (group, x, centerZ, hasDoor, colliderBaseId) => {
        const segments = [];
        let segmentCounter = 0;
        const addSegment = (depth, z) => {
            segments.push(addWallSegment(group, wallThickness, depth, x, z, `${colliderBaseId}_${segmentCounter++}`));
        };

        if (!hasDoor) {
            addSegment(roomDepth, centerZ);
            return segments;
        }
        const segmentDepth = (roomDepth - doorWidth) / 2;
        const offset = doorWidth / 2 + segmentDepth / 2;
        addSegment(segmentDepth, centerZ - offset);
        addSegment(segmentDepth, centerZ + offset);
        return segments;
    };

    const addDoorBlocker = (group, x, z) => {
        const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.34, wallHeight * 0.82, doorWidth * 0.92), doorBlockerMaterial.clone());
        blocker.position.set(x, (wallHeight * 0.82) / 2, z);
        blocker.userData.courseDoorBlocker = true;
        group.add(blocker);
        return blocker;
    };

    runtime.modules.forEach((module, index) => {
        const center = centers[index];
        const nextCenter = centers[index + 1] || null;
        const nextModule = runtime.modules[index + 1] || null;
        const roomGroup = new THREE.Group();
        roomGroup.userData.courseRoom = true;
        roomGroup.userData.moduleId = module.moduleId;
        const colliderBaseId = `course_room_${module.moduleId}`;
        const proceduralMeshes = [];
        
        // Ensure navmesh array exists in local scope closure
        if (index === 0) {
            window.__navmeshGeometries = [];
            console.log("--- Starting Procedural NavMesh Collection ---");
        }

        // Procedural floor
        const floor = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, 0.08, roomDepth), accentMaterial.clone());
        floor.position.set(center.x, 0.04, center.z);
        floor.receiveShadow = true;
        floor.userData.courseStructure = true;
        // CRITICAL FIX: Name it so raycasters/logic can identify it as a floor to ignore or walk on correctly
        floor.name = "procedural_floor_ignore"; 
        roomGroup.add(floor);
        proceduralMeshes.push(floor);

        const buildNorthSouthWall = (group, center, orientation, colliderBaseId) => {
            const z = center.z + (orientation === 'south' ? roomDepth / 2 : -roomDepth / 2);
            return addWallSegment(group, roomWidth, wallThickness, center.x, z, `${colliderBaseId}_${orientation}`);
        };

        proceduralMeshes.push(buildNorthSouthWall(roomGroup, center, 'north', colliderBaseId));
        proceduralMeshes.push(buildNorthSouthWall(roomGroup, center, 'south', colliderBaseId));

        if (index === 0) {
            proceduralMeshes.push(...buildSharedWall(roomGroup, center.x - roomWidth / 2, center.z, false, `${colliderBaseId}_west_outer`));
        }
        if (!nextCenter) {
            proceduralMeshes.push(...buildSharedWall(roomGroup, center.x + roomWidth / 2, center.z, false, `${colliderBaseId}_east_outer`));
        } else {
            proceduralMeshes.push(...buildSharedWall(
                roomGroup,
                center.x + roomSpacing / 2,
                center.z,
                Boolean(nextModule?.unlocked),
                `${colliderBaseId}_to_${nextModule.moduleId}`
            ));
        }

        scene.add(roomGroup);
        courseRoomShells.push({
            group: roomGroup,
            moduleId: module.moduleId,
            title: module.title,
            index,
            center,
            halfWidth: roomWidth / 2,
            halfDepth: roomDepth / 2
        });

        const roomModelTemplate = getCourseRoomModelTemplateForIndex(index, runtime.modules.length, roomTemplates);
        if (roomModelTemplate) {
            const shellModel = roomModelTemplate.clone(true);
            shellModel.position.set(
                center.x + COURSE_ROOM_MODEL_CONFIG.position.x,
                COURSE_ROOM_MODEL_CONFIG.position.y,
                center.z + COURSE_ROOM_MODEL_CONFIG.position.z
            );
            shellModel.scale.set(
                COURSE_ROOM_MODEL_CONFIG.scale.x,
                COURSE_ROOM_MODEL_CONFIG.scale.y,
                COURSE_ROOM_MODEL_CONFIG.scale.z
            );
            shellModel.rotation.y = COURSE_ROOM_MODEL_CONFIG.rotationY;
            roomGroup.add(shellModel);

            shellModel.updateMatrixWorld(true);

            shellModel.traverse((child) => {
                if (child.isMesh) {
                    const name = child.name ? child.name.toLowerCase() : '';
                    if (name.includes('navmesh') || name.includes('node') || name.includes('door') || name.includes('tongue')) {
                        child.visible = false;
                        if (name.includes('navmesh')) {
                            const geo = child.geometry.clone();
                            geo.applyMatrix4(child.matrixWorld);
                            if (window.__navmeshGeometries) {
                                window.__navmeshGeometries.push(geo);
                                console.log(`Collected NavMesh from room ${index}: ${child.name}`);
                            }
                        }
                    } else {
                        // User specifically requested to use the low-poly visual models as colliders.
                        if (name.includes('collision')) {
                            child.visible = false;
                        }
                        child.userData.id = 'course_coll_' + child.uuid;
                        preciseColliders.push(child);
                    }
                }
            });

            proceduralMeshes.forEach((mesh) => {
                if (mesh) {
                    mesh.visible = false;
                }
            });

            // CRITICAL FIX: The user wants their GLB geometry to act as the primary physics boundary.
            // We purge the mathematical procedural walls so they don't block the visual doorways.
            for (let i = wallBoxes.length - 1; i >= 0; i--) {
                if (wallBoxes[i].relatedId && wallBoxes[i].relatedId.startsWith(colliderBaseId)) {
                    wallBoxes.splice(i, 1);
                }
            }

            if (nextCenter && !nextModule?.unlocked) {
                addDoorBlocker(roomGroup, center.x + roomSpacing / 2, center.z);
            }
        }
    });

    syncCoursePlacementObjects(runtime, centers);
    updateCourseRoomContext();

    // Merge NavMeshes and stitch the gaps for the procedural rooms
    if (window.__navmeshGeometries && window.__navmeshGeometries.length > 0) {
        console.log(`Total NavMesh pieces collected: ${window.__navmeshGeometries.length}`);
        try {
            const mergedGeometry = BufferGeometryUtils.mergeGeometries(window.__navmeshGeometries, false);
            if (mergedGeometry) {
                // Stitch vertices that are within 0.50 units of each other to close modeling gaps
                const stitchedGeometry = BufferGeometryUtils.mergeVertices(mergedGeometry, 0.50);
                _pathfinding.setZoneData(_navmeshZone, Pathfinding.createZone(stitchedGeometry));
                console.log("Procedural NavMesh merged and stitched successfully (50cm tolerance)!");
            }
        } catch (err) {
            console.error("Error merging Procedural NavMeshes:", err);
        }
        delete window.__navmeshGeometries;
    }
}

// --- Environment Map Loading ---
if (COURSE_ID_FROM_URL) {
    createCourseModeBaseEnvironment();
} else {
    const mapLoader = new GLTFLoader();
    mapLoader.load('assets/maps/map/map.glb', (gltf) => {
        const environmentMap = gltf.scene;
        scene.add(environmentMap);

        environmentMap.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                const name = child.name ? child.name.toLowerCase() : '';

                if (name.includes('navmesh')) {
                    child.visible = false;
                    child.updateMatrixWorld(true);
                    const geo = child.geometry.clone();
                    geo.applyMatrix4(child.matrixWorld);
                    _pathfinding.setZoneData(_navmeshZone, Pathfinding.createZone(geo));
                    return;
                }

                if (name.includes('collision')) {
                    child.visible = false;
                } else if (name.includes('wall')) {
                    child.userData.isStructure = true;
                    if (child.material) {
                        child.material = child.material.clone();
                        child.material.transparent = true;
                    }
                }

                child.userData.id = 'env_mesh_' + child.uuid;
                preciseColliders.push(child);
            }
        });
        console.log("Environment map loaded successfully.");
    }, undefined, (error) => {
        console.warn("Notice: No default map found or error loading map.glb");
    });
}

// --- Animation Manager ---
function applyCharacterColor(model, color) {
    if (!model) return;

    // Build colors
    const baseColor = new THREE.Color(color);
    // Fresnel Color -> a brighter, 60% whiter mixture of the main theme color
    const fresnelColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.6);

    const fresnelMaterial = new THREE.ShaderMaterial({
        uniforms: {
            baseColor: { value: baseColor },
            fresnelColor: { value: fresnelColor },
            fresnelPower: { value: 1.5 }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewDir;
            
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mvPosition.xyz);
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 baseColor;
            uniform vec3 fresnelColor;
            uniform float fresnelPower;
            
            varying vec3 vNormal;
            varying vec3 vViewDir;
            
            void main() {
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                float diffuse = max(dot(vNormal, lightDir), 0.0);
                vec3 litColor = baseColor * (0.3 + 0.7 * diffuse);
                
                float f = 1.0 - max(dot(vViewDir, vNormal), 0.0);
                float fresnel = pow(f, fresnelPower);
                
                vec3 finalColor = mix(litColor, fresnelColor, fresnel);
                finalColor += fresnelColor * fresnel * 0.5;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        transparent: false
    });

    model.traverse((child) => {
        if (child.isMesh) {
            child.material = fresnelMaterial;
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
}

function handleAnimationState(animObj, state, duration = 0.2, loop = true) {
    if (!animObj.mixer || animObj.currentState === state) return;

    // Restriction: This only handles 'idle' and 'walk' base states now.
    // 'jump' and 'interact' are handled as overlays.
    if (state !== 'idle' && state !== 'walk') return;

    const nextAction = animObj.actions[state];
    if (!nextAction) return;

    if (animObj.currentAction) {
        animObj.currentAction.fadeOut(duration);
    }

    nextAction.reset().fadeIn(duration).play();
    nextAction.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    nextAction.clampWhenFinished = !loop;

    animObj.currentAction = nextAction;
    animObj.currentState = state;
}

function triggerInteract(animObj, targetPoint = null) {
    if (!animObj.mixer || !animObj.actions['interact']) return;

    // Rotate to face the point if provided
    if (targetPoint && animObj.mixer.getRoot().parent) {
        const root = animObj.mixer.getRoot();
        const parent = root.parent;
        const dir = new THREE.Vector3().subVectors(targetPoint, parent.position);
        parent.rotation.y = Math.atan2(dir.x, dir.z);
    }

    const action = animObj.actions['interact'];
    action.reset();
    action.setLoop(THREE.LoopOnce);
    action.clampWhenFinished = false;
    action.setEffectiveWeight(1);
    action.play();
}

// --- Multiplayer & Player Setup ---
const remotePlayers = {}; // Stores meshes and groups
const gametags = {}; // Stores UI elements

// Polyfill for legacy animation calls
let playerAnims = { mixer: null, actions: {}, currentAction: null, currentState: 'idle' };

const playerGroup = new THREE.Group();
let characterMesh = null;
scene.add(playerGroup);

function createDefaultAvatar(color = '#3b82f6') {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.2 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    group.add(body);

    const eyeGeo = new THREE.BoxGeometry(0.5, 0.2, 0.2);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    const eyes = new THREE.Mesh(eyeGeo, eyeMat);
    eyes.position.set(0, 1.3, 0.35);
    group.add(eyes);
    return { group, bodyMesh: body };
}

// Local player setup
const localAvatar = createDefaultAvatar(localUserColor);
characterMesh = localAvatar.bodyMesh;
playerGroup.add(localAvatar.group);
playerGroup.position.set(0, 0, 0);
playerGroup.visible = false; // Hidden until join

function createGametag(id, name, color, isLocal, profilePictureUrl = null) {
    const resolveAvatarSrc = (url) => {
        if (!url || typeof url !== 'string') return `https://ui-avatars.com/api/?name=${name}&background=random`;
        return url.startsWith('http') ? url : `${AUTH_API}${url}`;
    };

    if (gametags[id]) {
        gametags[id].element.querySelector('span.gametag-name').innerText = name;
        if (color) gametags[id].element.querySelector('span.gametag-name').style.color = color;
        const img = gametags[id].element.querySelector('.gametag-avatar');
        if (img) img.src = resolveAvatarSrc(profilePictureUrl);
        return;
    }
    const element = document.createElement('div');
    element.className = 'gametag';
    const avatarSrc = resolveAvatarSrc(profilePictureUrl);
    element.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: auto;">
            <img src="${avatarSrc}" class="gametag-avatar" style="width: 36px; height: 36px; border-radius: 50%; border: 2px solid ${color || '#fff'}; object-fit: cover; box-shadow: 0 2px 4px rgba(0,0,0,0.5);" onerror="this.src='https://ui-avatars.com/api/?name=${name}&background=random'">
            <div style="display: flex; align-items: center; gap: 4px; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 12px;">
                <span class="gametag-name" style="color: ${color || '#fff'}; font-weight: 500; font-size: 0.8rem; text-shadow: 1px 1px 0 #000;">${name}</span>
            </div>
        </div>
    `;

    if (!isLocal) {
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            openPlayerActionMenuForId(id, e);
        });

        const callBtn = document.createElement('button');
        callBtn.innerText = '📞';
        callBtn.className = 'gametag-call-btn';
        callBtn.style.background = 'none';
        callBtn.style.border = 'none';
        callBtn.style.cursor = 'pointer';
        callBtn.onclick = (e) => {
            e.stopPropagation();
            const player = remotePlayers[id];
            if (player && player.peerId) {
                makeCall(player.peerId, name);
            } else {
                alert('This player has not configured a voice channel yet.');
            }
        };
        element.querySelector('div > div:nth-child(2)').appendChild(callBtn);
    }

    document.body.appendChild(element);
    gametags[id] = { element, isLocal, color, profilePicture: profilePictureUrl };
}

function removeGametag(id) {
    if (gametags[id]) {
        gametags[id].element.remove();
        delete gametags[id];
    }
}

function updatePlayerList() {
    if (!localUsername) return;
    playerListContent.innerHTML = '';

    // 1. Add Me
    const meDiv = document.createElement('div');
    meDiv.className = 'player-item';

    const meInfoDiv = document.createElement('div');
    meInfoDiv.className = 'player-info player-name-container';
    meInfoDiv.innerHTML = `
        <div class="player-status-dot"></div>
        <span class="player-name">${localUsername}</span>
        <span class="is-me">YOU</span>
    `;

    meInfoDiv.onclick = (e) => {
        e.stopPropagation();
        showSelfAssetModal();
    };

    meDiv.appendChild(meInfoDiv);
    playerListContent.appendChild(meDiv);

    // 2. Add Others
    for (const id in remotePlayers) {
        const player = remotePlayers[id];
        let name = player.name || 'Unknown';

        // Final fallback: if state name is Guest or Unknown, check gametag
        if ((!player.name || player.name.includes('Guest')) && gametags[id]) {
            const tagText = gametags[id].element.innerText.replace('📞', '').replace('(no voice)', '').trim();
            if (tagText && !tagText.includes('Guest') && tagText !== 'Carregando...') {
                name = tagText;
                player.name = name; // Update state silently
            }
        }

        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'player-info';
        infoDiv.style.cursor = 'pointer';
        infoDiv.innerHTML = `
            <div class="player-status-dot" style="background: ${player.peerId ? '#10b981' : '#64748b'}"></div>
            <span class="player-name">${name}</span>
            ${!player.peerId ? '<span style="font-size: 0.7rem; color: #94a3b8; margin-left: 5px;">(no voice)</span>' : ''}
        `;

        infoDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            openPlayerActionMenuForId(id, e);
        });

        playerDiv.appendChild(infoDiv);
        playerListContent.appendChild(playerDiv);
    }
}

// Update gametags screen positions
function updateGametags() {
    if (!socket || !socket.id) return;
    const tempV = new THREE.Vector3();

    // Update local config
    if (gametags[socket.id] && localUsername !== '') {
        playerGroup.getWorldPosition(tempV);
        tempV.y += 3.5; // Above head
        tempV.project(camera);
        const x = (tempV.x * .5 + .5) * window.innerWidth;
        const y = (tempV.y * -.5 + .5) * window.innerHeight;
        gametags[socket.id].element.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;
        gametags[socket.id].element.style.display = 'block';
    }

    // Update remotes
    for (const id in remotePlayers) {
        if (gametags[id]) {
            remotePlayers[id].group.getWorldPosition(tempV);
            tempV.y += 3.5;
            tempV.project(camera);
            const x = (tempV.x * .5 + .5) * window.innerWidth;
            const y = (tempV.y * -.5 + .5) * window.innerHeight;
            gametags[id].element.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;
            gametags[id].element.style.display = 'block';
        }
    }
}

// --- Socket Events ---
// (This area will have socket calls, so ensure 'socket' is checked before use)
function sendMovement(pos, rot, anim) {
    if (socket) {
        socket.emit('playerMovement', {
            position: pos,
            rotation: rot,
            animation: anim,
            isJumping: isJumping,
            jumpAlpha: jumpTime / JUMP_DURATION,
            didInteract: didInteractThisFrame,
            interactionPoint: interactionPointGlobal
        });
        didInteractThisFrame = false;
    }
}

function cleanupByPosition(pos) {
    const targets = [];
    const pVec = new THREE.Vector3(pos.x, pos.y, pos.z);
    scene.traverse(obj => {
        if (obj.userData && obj.userData.id) {
            if (obj.position.distanceTo(pVec) < 0.1) {
                targets.push(obj.userData.id);
            }
        }
    });
    targets.forEach(id => removeOptimisticObject(id));
}

function removeOptimisticObject(id) {
    if (id) abortedLoads.add(id);

    // Find objects by ID directly instead of traversing the whole scene
    const targets = [];
    scene.traverse(obj => {
        if (obj.userData && obj.userData.id === id) {
            targets.push(obj);
        }
    });

    targets.forEach(obj => {
        // 1. CLEANUP collisions from arrays
        for (let i = wallBoxes.length - 1; i >= 0; i--) {
            if (wallBoxes[i].relatedId == id) wallBoxes.splice(i, 1);
        }
        for (let i = preciseColliders.length - 1; i >= 0; i--) {
            if (preciseColliders[i].userData && preciseColliders[i].userData.id == id) {
                preciseColliders.splice(i, 1);
            }
        }

        // 2. Remove from scene and mapping
        scene.remove(obj);
        delete idToUuid[id];
    });
}

// Redundant listeners removed, they are correctly handled in setupSocketListeners()


// (Removed redundant sync area - already in setupSocketListeners)
function syncChatHistory(history) { }

function addOtherPlayer(playerInfo) {
    if (remotePlayers[playerInfo.id]) {
        console.warn("Player already exists, skipping addOtherPlayer:", playerInfo.id);
        return;
    }
    // Anchor group: holds only network position/rotation — never touched visually
    const anchorGroup = new THREE.Group();
    anchorGroup.position.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
    anchorGroup.rotation.set(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z);
    anchorGroup.userData.remotePlayerId = playerInfo.id;
    scene.add(anchorGroup);

    // Avatar container: child of anchor — all visual mesh loading/centering goes here
    const avatarContainer = new THREE.Group();
    avatarContainer.userData.remotePlayerId = playerInfo.id;
    anchorGroup.add(avatarContainer);

    // Default avatar goes into avatarContainer
    const avatar = createDefaultAvatar(playerInfo.color);
    avatarContainer.add(avatar.group);

    remotePlayers[playerInfo.id] = {
        name: playerInfo.name,       // Store real name or Guest
        group: anchorGroup,          // anchor: use this for position/rotation from network
        avatarContainer: avatarContainer, // visual container: use this for model loading
        mainMesh: avatar.bodyMesh,
        color: playerInfo.color,
        peerId: playerInfo.peerId || null, // FIX: Store PeerJS ID for audio calls
        // --- Interpolation Targets ---
        targetPosition: anchorGroup.position.clone(),
        targetRotation: anchorGroup.rotation.clone(),
        anims: {
            mixer: null,
            actions: {},
            currentState: null,
            currentAction: null
        }
    };

    createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false, playerInfo.profilePicture);

    if (playerInfo.modelData && playerInfo.modelData.path) {
        loadPlayerModel(playerInfo.modelData.path + '?v=' + Date.now(), playerInfo.color, remotePlayers[playerInfo.id].avatarContainer, false, playerInfo.id);
    } else {
        const defaultModelPath = 'assets/character/player.glb?v=' + Date.now();
        loadPlayerModel(defaultModelPath, playerInfo.color, remotePlayers[playerInfo.id].avatarContainer, false, playerInfo.id);
    }
}

function loadPlayerModel(path, color, container, isLocal = false, remoteId = null) {
    loadingIndicator.classList.remove('hidden');
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(path, (gltf) => {
        // Clear previous meshes
        while (container.children.length > 0) container.remove(container.children[0]);

        const mesh = gltf.scene;
        mesh.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Apply character color
        applyCharacterColor(mesh, color);

        // Center before parenting
        mesh.position.set(0, 0, 0);
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        // For simple static proxy, just center X and Z, stand on MIN Y
        mesh.position.x = -center.x;
        mesh.position.z = -center.z;
        mesh.position.y = -box.min.y;

        container.add(mesh);
        if (isLocal) {
            characterMesh = mesh;
        } else if (remoteId && remotePlayers[remoteId]) {
            remotePlayers[remoteId].mainMesh = mesh;
        }

        loadingIndicator.classList.add('hidden');
    }, undefined, (err) => {
        console.error("Failed to load player model:", err);
        loadingIndicator.classList.add('hidden');
    });
}


// --- Input Handling ---
const keys = { w: false, a: false, s: false, d: false, ' ': false, e: false };
const chatInput = document.getElementById('chat-input');
const chatHistoryContainer = document.getElementById('chat-history-container');
const chatHistory = document.getElementById('chat-history');
const chatHistoryEmpty = document.getElementById('chat-history-empty');
const chatSendBtn = document.getElementById('chat-send-btn');

function sendChatMessage() {
    const msg = chatInput?.value?.trim();
    if (!msg || !socket) return;
    socket.emit('chatMessage', msg);
    chatInput.value = '';
    chatInput.focus();
}

function getRemotePlayerFromObject(object) {
    let root = object;
    while (root && root !== scene) {
        const remotePlayerId = root.userData?.remotePlayerId;
        if (remotePlayerId && remotePlayers[remotePlayerId]) {
            return { id: remotePlayerId, player: remotePlayers[remotePlayerId] };
        }
        root = root.parent;
    }
    return null;
}

function openPlayerActionMenuForId(playerId, eventOrPosition) {
    const player = remotePlayers[playerId];
    if (!player) return;

    const name = player.name || 'Unknown';
    selectedPlayerPeerId = player.peerId || null;
    showPlayerActionMenu(name, eventOrPosition);
}

function syncChatHistoryVisibility() {
    if (!chatHistoryContainer || !chatHistory) return;
    const hasMessages = chatHistory.children.length > 0;
    if (chatHistoryEmpty) {
        chatHistoryEmpty.classList.toggle('hidden', hasMessages);
    }

    if (document.body.classList.contains('course-world-mode')) {
        chatHistoryContainer.classList.remove('hidden');
        return;
    }

    chatHistoryContainer.classList.toggle('hidden', !hasMessages);
}

syncChatHistoryVisibility();

if (chatSendBtn) {
    chatSendBtn.addEventListener('click', () => sendChatMessage());
}

window.addEventListener('keydown', (e) => {
    if (document.activeElement === emailInput || document.activeElement === passwordInput) return;
    if (document.activeElement === chatInput) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendChatMessage();
        } else if (e.key === 'Escape') {
            chatInput.blur();
        }
        return;
    }

    if (e.key === 'Enter') {
        chatInput.focus();
        return;
    }

    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;

    // Jump trigger (Parabolic) - Removed

    // Interact trigger
    if (key === 'e') {
        triggerInteract(playerAnims);
        didInteractThisFrame = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (document.activeElement === emailInput || document.activeElement === passwordInput || document.activeElement === chatInput) return;
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    if (e.code === 'Space') keys[' '] = false;
});

// --- Lighting & Environment ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // Increased to brighten the scene
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(20, 30, 20); // Moved higher and further for larger coverage
directionalLight.castShadow = true;

// Extend shadow camera frustum
directionalLight.shadow.camera.left = -50;
directionalLight.shadow.camera.right = 50;
directionalLight.shadow.camera.top = 50;
directionalLight.shadow.camera.bottom = -50;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;

directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.bias = -0.0001;
scene.add(directionalLight);

const fillLight = new THREE.DirectionalLight(0x88bbff, 0.6);
fillLight.position.set(-10, 5, -10);
scene.add(fillLight);

// const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
// gridHelper.position.y = -0.01;
// scene.add(gridHelper);

// const planeGeometry = new THREE.PlaneGeometry(200, 200);
// const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.4 });
// const plane = new THREE.Mesh(planeGeometry, planeMaterial);
// plane.rotation.x = -Math.PI / 2;
// plane.receiveShadow = true;
// plane.name = "ground";
// scene.add(plane);

// --- Raycasting & Advanced Cube Placement ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- 3D Cursor Marker ---
const cursorGeo = new THREE.RingGeometry(0.3, 0.4, 32);
const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
const cursorMarker = new THREE.Mesh(cursorGeo, cursorMat);
cursorMarker.rotation.x = -Math.PI / 2;
cursorMarker.visible = false;
scene.add(cursorMarker);

window.addEventListener('contextmenu', (event) => {
    if (localUsername === '' || isOverUI(event)) return;

    // Feature: Cancel placement with right click
    if (currentPlacementState !== PlacementState.NONE) {
        event.preventDefault();
        cancelPlacement();
        return;
    }

    event.preventDefault();

    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Raycast against the whole scene
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        let hit = null;
        let groundHit = null;

        // Prioritize interactive objects over ground
        for (const intersect of intersects) {
            let isPlayerOrGhost = false;
            let isEnvMap = false;

            let tempRoot = intersect.object;
            while (tempRoot && tempRoot !== scene) {
                if (tempRoot === playerGroup || (tempRoot.userData && tempRoot.userData.isOptimistic) || tempRoot === cursorMarker) isPlayerOrGhost = true;
                if (tempRoot.userData && tempRoot.userData.id && tempRoot.userData.id.toString().includes('env_')) isEnvMap = true;
                tempRoot = tempRoot.parent;
            }

            if (isPlayerOrGhost) continue; // Ignore player and cursor

            // Ignore map walls! Only accept map floors or custom ground!
            if (isEnvMap) {
                let isFloor = intersect.face && intersect.face.normal.y > 0.5;
                if (!isFloor) continue;
            }

            let root = intersect.object;
            while (root && root !== scene) {
                if (root.userData && root.userData.id) {
                    hit = { object: root, point: intersect.point };
                    break;
                }
                if (root.name === "ground") {
                    groundHit = { object: root, point: intersect.point };
                }
                root = root.parent;
            }
            if (hit) break;
        }

        const finalHit = hit || groundHit;
        if (finalHit) {
            contextMenuTarget = finalHit.object;
            contextMenuPoint.copy(snapToGrid(finalHit.point)); // Apply Grid Snap

            // Position menu
            contextMenu.style.left = event.clientX + 'px';
            contextMenu.style.top = event.clientY + 'px';
            contextMenu.classList.remove('hidden');
            let root = finalHit.object;
            // ONLY find root if it's NOT the ground
            if (root.name !== "ground") {
                while (root && root !== scene) {
                    if (root.userData && root.userData.id) break;
                    root = root.parent;
                }
            }
            contextMenuTarget = root || finalHit.object;
            contextMenuPoint.copy(snapToGrid(finalHit.point));

            contextMenu.style.left = event.clientX + 'px';
            contextMenu.style.top = event.clientY + 'px';
            contextMenu.classList.remove('hidden');
            isMenuOpen = true;

            menuGroundSection.classList.add('hidden');
            menuCubeSection.classList.add('hidden');
            menuModelSection.classList.add('hidden');
            menuPlacementSection.classList.add('hidden'); // Reset all

            // Ground name check
            const isEnv = contextMenuTarget.userData && contextMenuTarget.userData.id && contextMenuTarget.userData.id.toString().includes('env_');
            if (contextMenuTarget.name === "ground" || (contextMenuTarget.object && contextMenuTarget.object.name === "ground") || isEnv) {
                menuGroundSection.classList.remove('hidden');

                // Role-based visibility for Module Placement
                if (localUserRole === 'MASTER' || localUserRole === 'ADMIN') {
                    menuPlaceModule.classList.remove('hidden');
                    menuPlaceModule.style.display = 'block';
                } else {
                    menuPlaceModule.classList.add('hidden');
                    menuPlaceModule.style.display = 'none';
                }
            } else if (contextMenuTarget.userData && contextMenuTarget.userData.id) {
                const id = contextMenuTarget.userData.id.toString().toLowerCase();
                if (id.includes('cube')) {
                    menuCubeSection.classList.remove('hidden');
                } else if (id.includes('model') || id.includes('struct')) {
                    menuModelSection.classList.remove('hidden');
                } else if (contextMenuTarget.userData.isPlacement) {
                    // Show assignment/delete only for MASTERs
                    if (localUserRole === 'MASTER' || localUserRole === 'ADMIN') {
                        menuPlacementSection.classList.remove('hidden');
                    }
                }
            }
        }
    }
});

document.getElementById('menu-create-block').addEventListener('click', () => {
    cancelPlacement(); // Ensure previous state is cleared
    lastStateChangeTime = Date.now();
    currentPlacementState = PlacementState.BASE;
    console.log("State -> BASE");
    placementStartPoint.copy(contextMenuPoint);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: localUserColor, transparent: true, opacity: 0.5 });
    previewCube = new THREE.Mesh(geo, mat);
    previewCube.userData.isPreview = true; // Mark for aggressive cleanup
    previewCube.position.set(placementStartPoint.x, 0.5, placementStartPoint.z);
    scene.add(previewCube);

    closeContextMenu();
});

document.getElementById('menu-catalog-models').addEventListener('click', () => {
    openCatalog('models', (item) => {
        if (socket) {
            socket.emit('placeModel', {
                modelPath: item.model,
                position: contextMenuPoint.clone(),
                isStructure: false
            });
        }

        // Trigger interact animation
        triggerInteract(playerAnims, contextMenuPoint);
        didInteractThisFrame = true;
        // Object will appear when server confirms via 'modelAdded'
    });
    closeContextMenu();
});

// Add Structures to Context Menu
const menuCatalogStructs = document.createElement('div');
menuCatalogStructs.className = 'menu-item';
menuCatalogStructs.innerHTML = '🏗️ Estruturas (Paredes/Escadas)';
document.getElementById('menu-ground-section').appendChild(menuCatalogStructs);

menuCatalogStructs.onclick = () => {
    openCatalog('structures', (item) => {
        if (socket) {
            socket.emit('placeModel', {
                modelPath: item.model,
                position: contextMenuPoint.clone(),
                isStructure: true
            });
        }

        triggerInteract(playerAnims, contextMenuPoint);
        didInteractThisFrame = true;
        catalogOverlay.classList.add('hidden'); // Explicitly hide after selection
        closeContextMenu();
    });
    closeContextMenu();
};

// Close menu on click
window.addEventListener('mousedown', (e) => {
    if (isMenuOpen && !contextMenu.contains(e.target)) {
        closeContextMenu();
    }
});

function closeContextMenu() {
    contextMenu.classList.add('hidden');
    isMenuOpen = false;
    contextMenuTarget = null;
}

// Menu Actions
document.getElementById('menu-import-placement-glb').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.isPlacement) {
        placementModelUpload.click();
    }
    closeContextMenu();
});

placementModelUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !contextMenuTarget) return;

    const id = contextMenuTarget.userData.id;
    const idleAnim = prompt("IDLE animation name (optional):", "idle");
    const interactedAnim = prompt("INTERACTION animation name (optional):", "interacted");

    const formData = new FormData();
    formData.append('model', file);
    if (idleAnim) formData.append('idleAnim', idleAnim);
    if (interactedAnim) formData.append('interactedAnim', interactedAnim);

    try {
        const response = await fetch(`${AUTH_API}/world/placements/${id}/model`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        if (!response.ok) throw new Error('Falha no upload do modelo');

        const data = await response.json();
        alert('Modelo importado com sucesso!');

        socket.emit('updateModulePlacementModel', {
            id: id,
            idleAnim: idleAnim,
            interactedAnim: interactedAnim,
            hasModel: true
        });

    } catch (err) {
        alert('Erro ao importar modelo: ' + err.message);
    } finally {
        e.target.value = '';
    }
});

function checkGeneralCollision(box, ignorePreview = false) {
    // Check wallBoxes (cubes and other models)
    for (const wallBox of wallBoxes) {
        if (box.intersectsBox(wallBox)) return true;
    }

    // Check active placement (preview cube)
    if (!ignorePreview && previewCube) {
        const previewBox = new THREE.Box3().setFromObject(previewCube);
        if (box.intersectsBox(previewBox)) return true;
    }

    // Check local player
    const localBox = new THREE.Box3().setFromObject(playerGroup);
    if (box.intersectsBox(localBox)) return true;

    // Check remote players
    for (const id in remotePlayers) {
        const player = remotePlayers[id];
        if (player && player.group) {
            const remoteBox = new THREE.Box3().setFromObject(player.group);
            if (box.intersectsBox(remoteBox)) return true;
        }
    }

    return false;
}

document.getElementById('menu-delete-cube').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.id && socket) {
        socket.emit('deleteObject', contextMenuTarget.userData.id);
    }
    closeContextMenu();
});

document.getElementById('menu-delete-model').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.id && socket) {
        socket.emit('deleteObject', contextMenuTarget.userData.id);
    }
    closeContextMenu();
});

// Menu Rotation 90
document.getElementById('menu-rotate-90-right').addEventListener('click', () => {
    if (contextMenuTarget) rotateObject(contextMenuTarget, Math.PI / 2);
    closeContextMenu();
});
document.getElementById('menu-rotate-90-left').addEventListener('click', () => {
    if (contextMenuTarget) rotateObject(contextMenuTarget, -Math.PI / 2);
    closeContextMenu();
});

// Menu Rotation 45
document.getElementById('menu-rotate-45-right').addEventListener('click', () => {
    if (contextMenuTarget) rotateObject(contextMenuTarget, Math.PI / 4);
    closeContextMenu();
});
document.getElementById('menu-rotate-45-left').addEventListener('click', () => {
    if (contextMenuTarget) rotateObject(contextMenuTarget, -Math.PI / 4);
    closeContextMenu();
});

function checkOverlap(box, ignoreId) {
    // 1. Check against wallBoxes (cubes/simple walls)
    for (const otherBox of wallBoxes) {
        if (otherBox.relatedId === ignoreId) continue;
        if (box.intersectsBox(otherBox)) {
            const intersection = box.clone().intersect(otherBox);
            if (intersection.max.x - intersection.min.x > 0.01 &&
                intersection.max.z - intersection.min.z > 0.01) return true;
        }
    }

    // 2. Check against ALL other models in scene (for structures)
    // We use a simple AABB check for performance during placement/rotation
    for (const key in idToUuid) {
        if (key === ignoreId) continue;
        const otherObj = scene.getObjectByProperty('uuid', idToUuid[key]);
        if (otherObj) {
            const otherBox = new THREE.Box3().setFromObject(otherObj);
            if (box.intersectsBox(otherBox)) {
                const intersection = box.clone().intersect(otherBox);
                if (intersection.max.x - intersection.min.x > 0.05 &&
                    intersection.max.z - intersection.min.z > 0.05) return true;
            }
        }
    }
    return false;
}

function rotateObject(target, angle) {
    const oldRotationY = target.rotation.y;
    target.rotation.y += angle;
    target.updateMatrixWorld(true); // Rotates root + all children (including collision meshes)

    // Check overlap after rotation
    const newBox = new THREE.Box3().setFromObject(target);
    if (checkOverlap(newBox, target.userData.id)) {
        target.rotation.y = oldRotationY;
        target.updateMatrixWorld(true);
        alert("Cannot rotate: space occupied!");
        return;
    }

    // Update AABB in wallBoxes (only for simple objects — not for those with preciseColliders)
    // For objects with preciseColliders (structures), the collision meshes follow the root
    // automatically as children — no separate update needed.
    const hasPC = preciseColliders.some(c => c.userData.id == target.userData.id);
    if (!hasPC) {
        for (const box of wallBoxes) {
            if (box.relatedId == target.userData.id) {
                box.setFromObject(target);
            }
        }
    }

    if (socket) {
        socket.emit('updateObjectRotation', {
            id: target.userData.id,
            rotation: { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }
        });
    }
}

document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
        if (contextMenuTarget && contextMenuTarget.userData.id && socket) {
            socket.emit('updateObjectColor', {
                id: contextMenuTarget.userData.id,
                color: opt.dataset.color
            });
        }
        closeContextMenu();
    });
});

function beginPrimaryPointer(event) {
    primaryPointerState = {
        clientX: event.clientX,
        clientY: event.clientY,
        dragged: false
    };
}

function consumePrimaryPointerState() {
    const state = primaryPointerState;
    primaryPointerState = null;
    return state;
}

function panCameraFromPointerDelta(deltaX, deltaY) {
    const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
    const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
    if (!viewportWidth || !viewportHeight) return;

    const worldUnitsPerPixelX = ((camera.right - camera.left) / camera.zoom) / viewportWidth;
    const worldUnitsPerPixelY = ((camera.top - camera.bottom) / camera.zoom) / viewportHeight;
    const panOffset = new THREE.Vector3();
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

    panOffset.addScaledVector(cameraRight, -deltaX * worldUnitsPerPixelX);
    panOffset.addScaledVector(cameraUp, deltaY * worldUnitsPerPixelY);

    camera.position.add(panOffset);
    controls.target.add(panOffset);
    controls.update();
}

function updatePrimaryPointerState(event) {
    if (!primaryPointerState || currentPlacementState !== PlacementState.NONE || (event.buttons & 1) !== 1) return;
    const deltaX = event.clientX - primaryPointerState.clientX;
    const deltaY = event.clientY - primaryPointerState.clientY;

    if (!primaryPointerState.dragged && Math.hypot(deltaX, deltaY) >= PRIMARY_DRAG_PAN_THRESHOLD) {
        primaryPointerState.dragged = true;
        cursorMarker.visible = false;
    }

    if (!primaryPointerState.dragged) return;

    panCameraFromPointerDelta(deltaX, deltaY);
    primaryPointerState.clientX = event.clientX;
    primaryPointerState.clientY = event.clientY;
}

function handlePrimaryWorldClick(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
        const remotePlayerHit = getRemotePlayerFromObject(hit.object);
        if (remotePlayerHit) {
            openPlayerActionMenuForId(remotePlayerHit.id, event);
            return;
        }
    }

    for (const hit of intersects) {
        let root = hit.object;
        while (root && root !== scene) {
            if (root.userData && root.userData.isPlacement) {
                if (root.userData.isLocked) {
                    alert('This module is still locked by the course path.');
                    return;
                }
                openModuleSidebar(root.userData.id, root.userData.moduleId, root.userData.courseModuleId);

                const mixerInfo = placementMixers[root.userData.id];
                if (mixerInfo && mixerInfo.actions.interacted) {
                    const action = mixerInfo.actions.interacted;
                    action.reset().setLoop(THREE.LoopOnce).play();
                    action.clampWhenFinished = false;
                }

                return;
            }
            root = root.parent;
        }
    }

    if (!intersects.length) return;

    let hitPoint = null;
    for (const hit of intersects) {
        let isPlayerOrGhost = false;
        let root = hit.object;
        while (root && root !== scene) {
            if (root === playerGroup || (root.userData && root.userData.isOptimistic)) isPlayerOrGhost = true;
            root = root.parent;
        }
        if (!isPlayerOrGhost) {
            hitPoint = hit.point;
            break;
        }
    }

    if (!hitPoint) return;

    const startPos = playerGroup.position.clone();
    try {
        const zoneData = _pathfinding.zones[_navmeshZone];
        let groupID = 0;
        if (zoneData && zoneData.groups) {
            let minDist = Infinity;
            for (let g = 0; g < zoneData.groups.length; g++) {
                const node = _pathfinding.getClosestNode(startPos, _navmeshZone, g);
                if (node) {
                    const dist = node.centroid.distanceToSquared(startPos);
                    if (dist < minDist) {
                        minDist = dist;
                        groupID = g;
                    }
                }
            }
        } else {
            groupID = _pathfinding.getGroup(_navmeshZone, startPos) || 0;
        }

        const path = _pathfinding.findPath(startPos, hitPoint, _navmeshZone, groupID);
        localPlayerPath = (path && path.length > 0) ? path : null;
    } catch (e) {
        console.error("Pathfinding error:", e);
        localPlayerPath = null;
    }
}

window.addEventListener('mousedown', (event) => {
    if (localUsername === '' || document.activeElement === chatInput || isMenuOpen || isOverUI(event)) return;

    // Feature: Cancel with RIGHT click immediately
    if (event.button === 2 && currentPlacementState !== PlacementState.NONE) {
        cancelPlacement();
        primaryPointerState = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }

    if (event.button !== 0) return; // Only left-click

    if (currentPlacementState === PlacementState.NONE) {
        beginPrimaryPointer(event);
        return;
    }

    try {
        console.log("Mousedown - Button:", event.button, "State:", currentPlacementState);
        if (currentPlacementState === PlacementState.HEIGHT) {
            // Phase 3: Finalize
            console.log("Finalizing placement...");
            const previewBox = new THREE.Box3().setFromObject(previewCube);
            if (checkGeneralCollision(previewBox, true)) {
                alert("Cannot place here: Position occupied!");
                cancelPlacement();
            } else {
                const size = {
                    w: Math.abs(previewCube.scale.x),
                    h: Math.abs(previewCube.scale.y),
                    d: Math.abs(previewCube.scale.z)
                };
                const pos = previewCube.position.clone();
                if (socket) {
                    socket.emit('placeCube', {
                        position: pos,
                        size: size,
                        color: localUserColor
                    });
                }
                triggerInteract(playerAnims, contextMenuPoint);
                didInteractThisFrame = true;
                cancelPlacement();
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        }
    } catch (err) {
        console.error("Error in mousedown:", err);
    }
});


window.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return; // ONLY LEFT CLICK
    const pointerState = consumePrimaryPointerState();
    if (isOverUI(event)) return;
    if (Date.now() - lastStateChangeTime < STATE_CHANGE_DEBOUNCE) return;

    if (currentPlacementState === PlacementState.NONE) {
        if (!pointerState?.dragged && localUsername !== '' && document.activeElement !== chatInput && !isMenuOpen) {
            try {
                handlePrimaryWorldClick(event);
            } catch (err) {
                console.error("Error in primary click:", err);
            }
        }
        return;
    }

    if (currentPlacementState === PlacementState.BASE) {
        // Phase 2: Start Height Definition
        lastStateChangeTime = Date.now();
        currentPlacementState = PlacementState.HEIGHT;
        lastMouseY = event.clientY;
    }
});

window.addEventListener('mousemove', (event) => {
    // Custom Cursor
    customCursor.style.left = event.clientX + 'px';
    customCursor.style.top = event.clientY + 'px';

    // UI Detection for cursor
    if (isOverUI(event)) {
        customCursor.classList.add('ui-hover');
    } else {
        customCursor.classList.remove('ui-hover');
    }

    updatePrimaryPointerState(event);
    const isPrimaryPanning = Boolean(primaryPointerState?.dragged && (event.buttons & 1) === 1);

    // --- 3D Cursor Projection ---
    if (currentPlacementState === PlacementState.NONE && !isPrimaryPanning) {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        let hitPoint = null;
        let hitNormal = null;
        const intersects = raycaster.intersectObjects(scene.children, true);
        for (const hit of intersects) {
            let isPlayerOrGhost = false;
            let root = hit.object;
            while (root && root !== scene) {
                if (root === playerGroup || (root.userData && root.userData.isOptimistic) || root === cursorMarker) isPlayerOrGhost = true;
                root = root.parent;
            }
            if (!isPlayerOrGhost) {
                // Check if it's a floor (normal points UP)
                let isFloor = hit.face && hit.face.normal.y > 0.5;
                if (isFloor) {
                    hitPoint = hit.point;
                    hitNormal = hit.face.normal;
                    break;
                }
            }
        }

        if (hitPoint && hitNormal) {
            cursorMarker.position.copy(hitPoint);
            cursorMarker.position.addScaledVector(hitNormal, 0.05); // Hover slightly above
            cursorMarker.lookAt(hitPoint.clone().add(hitNormal));
            cursorMarker.visible = true;
        } else {
            cursorMarker.visible = false;
        }
    } else {
        cursorMarker.visible = false;
    }

    if (currentPlacementState === PlacementState.BASE) {
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(plane);

        if (intersects.length > 0) {
            const currentPoint = snapToGrid(intersects[0].point);
            const width = currentPoint.x - placementStartPoint.x;
            const depth = currentPoint.z - placementStartPoint.z;

            previewCube.scale.set(width || 0.1, 1, depth || 0.1);
            previewCube.position.set(
                placementStartPoint.x + width / 2,
                previewCube.scale.y / 2, // Support scaled Y
                placementStartPoint.z + depth / 2
            );
        }
    } else if (currentPlacementState === PlacementState.HEIGHT) {
        const deltaY = lastMouseY - event.clientY; // Upwards move increases height
        let newHeight = Math.max(0.1, previewCube.scale.y + deltaY * 0.05);
        if (newHeight > MAX_CUBE_HEIGHT) newHeight = MAX_CUBE_HEIGHT; // Limit height
        previewCube.scale.y = newHeight;
        previewCube.position.y = newHeight / 2;
        lastMouseY = event.clientY;
    }
});

function cancelPlacement() {
    console.log("cancelPlacement called - Resetting to NONE");
    if (previewCube) {
        scene.remove(previewCube);
        previewCube = null;
    }
    // Aggressive cleanup: remove ANY orphan previews
    try {
        const toRemove = [];
        scene.traverse(child => {
            if (child.userData && child.userData.isPreview) {
                toRemove.push(child);
            }
        });
        toRemove.forEach(child => scene.remove(child));
    } catch (err) {
        console.error("Error in cancelPlacement:", err);
    }
    currentPlacementState = PlacementState.NONE;
}




function getSurfaceHeight(xzPos) {
    let maxHeight = 0;

    // 1. Box check (Cubes and static walls)
    for (const box of wallBoxes) {
        if (xzPos.x >= box.min.x && xzPos.x <= box.max.x &&
            xzPos.z >= box.min.z && xzPos.z <= box.max.z) {
            if (box.max.y > maxHeight) maxHeight = box.max.y;
        }
    }

    // 2. Precise Mesh Check (Ramps, Stairs, Slopes)
    if (preciseColliders.length > 0) {
        // Cast from Eye Level (1.8m) — ensures ray sees floor/ramp from safe height
        const originY = (playerGroup ? playerGroup.position.y : 0) + 1.8;
        const rayOrigin = new THREE.Vector3(xzPos.x, originY, xzPos.z);
        const rayDir = new THREE.Vector3(0, -1, 0);
        raycaster.set(rayOrigin, rayDir);

        // NOTE: matrixWorld is guaranteed current because animate() calls
        // scene.updateMatrixWorld(true) before any game logic runs.
        const hits = raycaster.intersectObjects(preciseColliders, true);
        if (hits.length > 0) {
            const hitY = hits[0].point.y;
            const currentFeetY = playerGroup ? playerGroup.position.y : 0;

            // STEP LIMIT: Only accept surface within [feet-0.5, feet+0.5]
            if (hitY > maxHeight && hitY <= currentFeetY + 0.5) {
                maxHeight = hitY;
            }
        }
    }

    return maxHeight;
}

window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();

    // Force renderer refresh to avoid blur, using container dimensions
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
});

// --- Movement Logic ---
let moveSpeed = 0.05;
let currentSurfaceHeight = 0;
let autoWalkStuckTimer = 0;
const lastStoredPosition = new THREE.Vector3();
let lastLogTime = 0;

function checkCollision(targetPosition) {
    // COMPACT COLLISION: Width balanced (0.45 units) to avoid falling through walls but still fit through doors (approx 1m wide)
    const playerBoxSize = new THREE.Vector3(0.45, 1.8, 0.45);
    const playerCenter = targetPosition.clone().add(new THREE.Vector3(0, 0.9, 0));
    const playerBox = new THREE.Box3().setFromCenterAndSize(playerCenter, playerBoxSize);

    // 1. Check for "wall" collision (Cubes and Legacy Models)
    for (const wallBox of wallBoxes) {
        if (playerBox.intersectsBox(wallBox)) {
            const feetY = targetPosition.y;
            if (feetY < wallBox.max.y - 0.5) return true;
        }
    }

    // 2. PRECISE MESH COLLISION (Structures)
    if (preciseColliders.length > 0) {
        const moveDir = targetPosition.clone().sub(playerGroup.position);
        const moveDist = moveDir.length();
        if (moveDist > 0.001) {
            moveDir.normalize();

            // Multiple rays to cover the player's width
            const playerRadius = 0.2;
            const rayOffsets = [
                new THREE.Vector3(0, 0.2, 0),        // Base center
                new THREE.Vector3(playerRadius, 0.2, playerRadius),
                new THREE.Vector3(-playerRadius, 0.2, playerRadius),
                new THREE.Vector3(playerRadius, 0.2, -playerRadius),
                new THREE.Vector3(-playerRadius, 0.2, -playerRadius),
                new THREE.Vector3(0, 1.0, 0),        // Waist height
                new THREE.Vector3(0, 1.7, 0)         // Head level
            ];

            for (const offset of rayOffsets) {
                const rayStart = playerGroup.position.clone().add(offset);
                raycaster.set(rayStart, moveDir);
                const hits = raycaster.intersectObjects(preciseColliders, true);

                // If we hit a collision mesh within the step distance
                if (hits.length > 0 && hits[0].distance <= moveDist + 0.05) {
                    return true;
                }
            }
        }
    }

    return false;
}

function updatePlayer(delta) {
    if (localUsername === '' || isMenuOpen) return;

    // --- Ground/Surface Logic ---
    const targetSurface = getSurfaceHeight(playerGroup.position);
    if (playerGroup.position.y < targetSurface) {
        playerGroup.position.y = targetSurface;
    } else if (playerGroup.position.y > targetSurface) {
        playerGroup.position.y = Math.max(targetSurface, playerGroup.position.y - 0.1);
    }
    currentSurfaceHeight = targetSurface;

    // Manual input interrupts auto-walk
    if (keys.w || keys.a || keys.s || keys.d) {
        localPlayerPath = null;
    }

    let moveX = 0, moveZ = 0;

    // Pathfinding logic
    if (localPlayerPath && localPlayerPath.length > 0) {
        const targetPoint = localPlayerPath[0];
        const dir = new THREE.Vector3().subVectors(targetPoint, playerGroup.position);
        dir.y = 0;

        const dist = dir.length();
        if (dist < 0.1) {
            localPlayerPath.shift();
            if (localPlayerPath.length === 0) localPlayerPath = null;
        } else {
            dir.normalize();
            moveX = dir.x * moveSpeed * 1.5;
            moveZ = dir.z * moveSpeed * 1.5;
        }
    } else {
        // WASD Movement
        if (keys.w) { moveZ -= moveSpeed; moveX -= moveSpeed; }
        if (keys.s) { moveZ += moveSpeed; moveX += moveSpeed; }
        if (keys.a) { moveX -= moveSpeed; moveZ += moveSpeed; }
        if (keys.d) { moveX += moveSpeed; moveZ -= moveSpeed; }

        if ((keys.w || keys.s) && (keys.a || keys.d)) {
            moveX *= 0.7071;
            moveZ *= 0.7071;
        }
    }

    if (moveX !== 0 || moveZ !== 0) {
        const targetPos = playerGroup.position.clone();
        targetPos.x += moveX;
        targetPos.z += moveZ;

        // Collision check with sliding
        if (!checkCollision(targetPos)) {
            playerGroup.position.copy(targetPos);
        } else if (!localPlayerPath) {
            // Slide only for WASD
            const targetPosX = playerGroup.position.clone(); targetPosX.x += moveX;
            if (!checkCollision(targetPosX)) playerGroup.position.copy(targetPosX);
            else {
                const targetPosZ = playerGroup.position.clone(); targetPosZ.z += moveZ;
                if (!checkCollision(targetPosZ)) playerGroup.position.copy(targetPosZ);
            }
        } else {
            // Pathfinding blocked
            localPlayerPath = null;
        }

        playerGroup.rotation.y = Math.atan2(moveX, moveZ);
        handleAnimationState(playerAnims, 'walk');
    } else {
        handleAnimationState(playerAnims, 'idle');
    }

    // Camera follow
    const cameraOffset = new THREE.Vector3(20, 20, 20);
    camera.position.lerp(playerGroup.position.clone().add(cameraOffset), 0.1);
    controls.target.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z);

    broadcastMovement();
}

let lastBroadcastTime = 0;
const BROADCAST_INTERVAL = 1000 / 20; // 20Hz

function broadcastMovement() {
    if (!socket) return;
    const now = Date.now();
    if (now - lastBroadcastTime < BROADCAST_INTERVAL) return;
    lastBroadcastTime = now;

    if (socket && socket.connected) {
        const moveData = {
            position: { x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z },
            rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
            animation: playerAnims.currentState,
            isJumping: isJumping,
            jumpAlpha: isJumping ? Math.sin((jumpTime / JUMP_DURATION) * Math.PI) : 0,
            didInteract: didInteractThisFrame,
            interactionPoint: interactionPointGlobal
        };

        // Intensified logging for diagnostics
        if (Math.random() < 0.01) { // 1% of frames to avoid lag
            console.log("[Replication] Sending movement sample:", moveData.position);
        }

        socket.emit('playerMovement', moveData);
    }
    didInteractThisFrame = false; // Reset for next emit
}


function updateOcclusion() {
    if (!playerGroup) return;

    // 1. Reset all transparent objects
    scene.traverse(obj => {
        if (obj.isMesh && obj.material && obj.material.transparent) {
            // Restore opacity if it was changed by occlusion
            if (obj.userData.wasOccluded) {
                obj.material.opacity = 1.0;
                obj.userData.wasOccluded = false;
            }
        }
    });

    // 2. Get player center
    const playerBox = new THREE.Box3().setFromObject(playerGroup);
    const targetPoint = playerBox.getCenter(new THREE.Vector3());

    // 3. Raycast from camera to center
    const direction = new THREE.Vector3().subVectors(targetPoint, camera.position).normalize();
    const distanceToPlayer = camera.position.distanceTo(targetPoint);

    raycaster.set(camera.position, direction);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (let i = 0; i < intersects.length; i++) {
        const hit = intersects[i];
        if (hit.distance >= distanceToPlayer - 0.5) break;

        let obj = hit.object;
        // Check if this object should be occluded (cubes or structures)
        let root = obj;
        while (root && root !== scene) {
            if (root.userData && root.userData.id && (root.userData.id.startsWith('cube_') || root.userData.isStructure)) {
                // Apply transparency to all meshes in this root
                root.traverse(child => {
                    if (child.isMesh && child.material) {
                        // Ensure material is ready for transparency
                        if (!child.material.transparent) child.material.transparent = true;
                        child.material.opacity = 0.2;
                        child.userData.wasOccluded = true;
                    }
                });
                break;
            }
            root = root.parent;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);

    try {
        const delta = clock.getDelta();

        // Update matrices first
        scene.updateMatrixWorld(true);

        // Update local mixer
        if (playerAnims && playerAnims.mixer) playerAnims.mixer.update(delta);

        // Update remote players with interpolation (lers/slerp)
        const LERP_SPEED = 0.2;
        for (const id in remotePlayers) {
            const p = remotePlayers[id];

            // Smooth Position
            p.group.position.lerp(p.targetPosition, LERP_SPEED);

            // Smooth Rotation (Simple lerp for Y axis is usually enough for characters)
            p.group.rotation.x = THREE.MathUtils.lerp(p.group.rotation.x, p.targetRotation.x, LERP_SPEED);
            p.group.rotation.y = THREE.MathUtils.lerp(p.group.rotation.y, p.targetRotation.y, LERP_SPEED);
            p.group.rotation.z = THREE.MathUtils.lerp(p.group.rotation.z, p.targetRotation.z, LERP_SPEED);

            if (p.anims && p.anims.mixer) {
                p.anims.mixer.update(delta);
            }
        }

        // Update placement mixers
        for (const id in placementMixers) {
            if (placementMixers[id] && placementMixers[id].mixer) {
                placementMixers[id].mixer.update(delta);
            }
        }

        updatePlayer(delta);
        updateOcclusion();
        updateGametags();
        updateCourseRoomContext();

        // Diagnostic & Force Fixes
        if (camera.zoom <= 0) camera.zoom = 0.1; // Guard against scene disappearance

        if (controls) {
            // Only update projection if controls actually changed (throttled)
            if (controls.update()) {
                camera.updateProjectionMatrix();
            }
        }

        renderer.render(scene, camera);
    } catch (err) {
        console.error("Error in animate loop:", err);
    }
}
animate();

// --- 6. Chat & Model Helpers ---
const loadingIndicator = document.getElementById('loading-indicator');

function addMessageToChat(data) {
    const msgElement = document.createElement('div');
    msgElement.className = 'chat-msg';
    msgElement.innerHTML = `
        <span class="time">${data.time}</span>
        <span class="name">${data.name}:</span>
        <span class="text">${data.message}</span>
    `;
    chatHistory.appendChild(msgElement);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Limit history
    while (chatHistory.children.length > 50) {
        chatHistory.removeChild(chatHistory.firstChild);
    }
    syncChatHistoryVisibility();
}

// Old model loading functions removed.

function createCube(data) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
        color: data.color,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true, // ALWAYS prepared for transparency
        opacity: 1.0
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.userData.id = data.id; // Store ID
    cube.userData.isOptimistic = data.isOptimistic || false;
    idToUuid[data.id] = cube.uuid;

    // Apply dimensions from data
    const size = data.size || { w: 1, h: 1, d: 1 };
    cube.scale.set(size.w, size.h, size.d);

    cube.position.set(data.position.x, data.position.y, data.position.z);
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);

    // Add to collision boxes
    cube.updateMatrixWorld();
    const cubeBox = new THREE.Box3().setFromObject(cube);
    cubeBox.relatedId = data.id;
    wallBoxes.push(cubeBox);

    // Minor scale animation when appearing (only if not optimistic or first create)
    const targetScale = cube.scale.clone();
    cube.scale.set(0, 0, 0);
    new Promise(res => {
        let alpha = 0;
        const intr = setInterval(() => {
            alpha += 0.1;
            cube.scale.lerpVectors(new THREE.Vector3(0, 0, 0), targetScale, alpha);
            if (alpha >= 1) {
                cube.scale.copy(targetScale);
                clearInterval(intr);
            }
        }, 16);
    });
}

function createPlacedModel(data) {
    if (abortedLoads.has(data.id)) {
        abortedLoads.delete(data.id);
        return;
    }
    activeLoads.add(data.id);

    const gltfLoader = new GLTFLoader();
    const onParsed = (gltf) => {
        activeLoads.delete(data.id);
        if (abortedLoads.has(data.id)) {
            abortedLoads.delete(data.id);
            return;
        }

        const model = gltf.scene;
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Ensure materials support transparency
                if (child.material) child.material.transparent = true;
            }
        });
        model.position.set(data.position.x, data.position.y, data.position.z);
        model.rotation.set(data.rotation ? data.rotation.x : 0, data.rotation ? data.rotation.y : 0, data.rotation ? data.rotation.z : 0);
        model.userData.id = data.id;
        model.userData.isOptimistic = data.isOptimistic || false;
        model.userData.isStructure = data.isStructure || false; // Important for occlusion
        // Springboard: If this model ALREADY exists at this ID, ignore it (prevents race condition)
        if (idToUuid[data.id]) {
            const oldObj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
            if (oldObj && !data.isOptimistic) {
                // If the real one arrived, but the optimistic one is still here, kill the optimistic one
                if (oldObj.userData.isOptimistic) scene.remove(oldObj);
            }
        }

        model.updateMatrixWorld(true);
        const placementBox = new THREE.Box3().setFromObject(model);
        if (data.isOptimistic && checkOverlap(placementBox, data.id)) {
            alert("Não é possível colocar: Espaço ocupado!");
            activeLoads.delete(data.id);
            return;
        }

        idToUuid[data.id] = model.uuid;
        scene.add(model);

        model.updateMatrixWorld(true);

        // --- Custom Collision Mesh Extraction ---
        // SAFETY: Clear any existing collisions for this ID (prevents ghosts)
        for (let i = wallBoxes.length - 1; i >= 0; i--) {
            if (wallBoxes[i].relatedId == data.id) wallBoxes.splice(i, 1);
        }
        for (let i = preciseColliders.length - 1; i >= 0; i--) {
            if (preciseColliders[i].userData && preciseColliders[i].userData.id == data.id) {
                preciseColliders.splice(i, 1);
            }
        }

        let hasCollisionMeshes = false;
        model.traverse(child => {
            // Check if name contains 'collision' (handles 'collision.001', 'collision_box', etc.)
            const isCollision = child.name.toLowerCase().includes('collision');
            if (isCollision) {
                hasCollisionMeshes = true;
                child.visible = false; // Hide collision helpers

                // Add the mesh itself to preciseColliders for raycasting
                child.traverse(c => {
                    if (c.isMesh) {
                        c.visible = false;
                        c.userData.id = data.id; // Mark for deletion cleanup
                        preciseColliders.push(c);
                    }
                });
            }
        });

        // --- IMPORTANT CHANGE ---
        // Structures ONLY use preciseColliders (Mesh) for collision.
        // We do NOT add them to wallBoxes (AABB) to avoid "Giant Square" 45° issues.
        if (!hasCollisionMeshes && !data.isStructure) {
            const modelBox = new THREE.Box3().setFromObject(model);
            modelBox.relatedId = data.id;
            wallBoxes.push(modelBox);
        }
    };

    if (data.modelBuffer) {
        gltfLoader.parse(data.modelBuffer, '', onParsed);
    } else if (data.modelPath) {
        gltfLoader.load(data.modelPath, onParsed);
    }
}

function createModulePlacement(data) {
    const existingUuid = idToUuid[data.id];
    if (existingUuid) {
        const existing = scene.getObjectByProperty('uuid', existingUuid);
        if (existing) scene.remove(existing);
        delete idToUuid[data.id];
    }

    const group = new THREE.Group();
    const modelGroup = new THREE.Group();
    group.add(modelGroup);

    // Initial state
    group.userData.id = data.id;
    group.userData.moduleId = data.moduleId;
    group.userData.courseModuleId = data.courseModuleId || null;
    group.userData.moduleTitle = data.moduleTitle || '';
    group.userData.status = data.status || 'NONE';
    group.userData.isPlacement = true;
    group.userData.isLocked = Boolean(data.isLocked);
    group.userData.isCompleted = Boolean(data.isCompleted);
    group.userData.idleAnimName = data.idleAnim || 'idle';
    group.userData.interactedAnimName = data.interactedAnim || 'interacted';

    // Helper to setup default beacon
    const setupDefaultBeacon = () => {
        modelGroup.clear();
        // Base - Cylinder
        const baseGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.8, roughness: 0.2 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.05;
        modelGroup.add(base);

        // Floating Icon - Octahedron
        const iconGeo = new THREE.OctahedronGeometry(0.3);
        const iconMat = new THREE.MeshStandardMaterial({
            color: 0x60a5fa,
            emissive: 0x3b82f6,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });
        const icon = new THREE.Mesh(iconGeo, iconMat);
        icon.position.y = 1.2;
        icon.name = "floating_icon";
        modelGroup.add(icon);

        // Light beam/Glow
        const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 32, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x60a5fa,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 0.6;
        modelGroup.add(beam);

        // Animation loop for the floating icon
        const startTime = Date.now();
        const animateIcon = () => {
            if (!group.parent || (modelGroup.children.length > 0 && modelGroup.children[0] !== base)) return;
            const time = (Date.now() - startTime) * 0.002;
            icon.position.y = 1.2 + Math.sin(time) * 0.1;
            icon.rotation.y = time;
            requestAnimationFrame(animateIcon);
        };
        animateIcon();
    };

    // Helper to load GLB model
    const loadCustomModel = () => {
        const loader = new GLTFLoader();
        loader.load(`${AUTH_API}/world/placements/${data.id}/model`, (gltf) => {
            modelGroup.clear();
            const model = gltf.scene;
            model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

            // Auto-center and ground the model
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.set(-center.x, -box.min.y, -center.z);

            modelGroup.add(model);

            // Cleanup old mixer
            if (placementMixers[data.id]) {
                placementMixers[data.id].mixer.stopAllAction();
            }

            // Setup new mixer
            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(model);
                const actions = {};

                gltf.animations.forEach(clip => {
                    const name = clip.name.toLowerCase();
                    if (name.includes(group.userData.idleAnimName.toLowerCase())) {
                        actions['idle'] = mixer.clipAction(clip);
                        actions['idle'].play();
                    }
                    if (name.includes(group.userData.interactedAnimName.toLowerCase())) {
                        actions['interacted'] = mixer.clipAction(clip);
                    }
                });

                placementMixers[data.id] = { mixer, actions };
            }
        }, undefined, (err) => {
            console.warn("Custom model load failed, using beacon:", err);
            setupDefaultBeacon();
        });
    };

    if (data.hasModel || (data.modelData !== undefined && data.modelData !== null)) {
        loadCustomModel();
    } else {
        setupDefaultBeacon();
    }

    group.position.set(data.position.x, data.position.y, data.position.z);
    group.rotation.set(data.rotation?.x || 0, data.rotation?.y || 0, data.rotation?.z || 0);

    idToUuid[data.id] = group.uuid;
    scene.add(group);

    createPlacementBadge(group);

    // Store load function for refresh
    group.userData.refreshModel = loadCustomModel;
}

// --- Module Placement Handlers ---

menuPlaceModule.addEventListener('click', async () => {
    closeContextMenu();

    // Determine if MASTER
    // (Assuming authToken verification in server/socket ensures only authorized can emit if we were doing server-side checks, 
    // but here we just follow the UI logic)

    try {
        const response = await fetch(`${AUTH_API}/world/placements`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                sceneId: 'level1',
                objectType: 'TEACHING_MODULE_BEACON',
                position: contextMenuPoint,
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            })
        });

        const newPlacement = await response.json();
        if (!response.ok) throw new Error(newPlacement.error || 'Falha ao criar placement');

        // Notify socket server
        socket.emit('placeModulePlacement', {
            id: newPlacement.id,
            position: contextMenuPoint.clone(),
            rotation: { x: 0, y: 0, z: 0 }
        });

        triggerInteract(playerAnims, contextMenuPoint);
        didInteractThisFrame = true;
    } catch (err) {
        alert('Erro ao criar módulo interativo: ' + err.message);
    }
});

document.getElementById('menu-delete-placement').addEventListener('click', async () => {
    const id = contextMenuTarget.userData.id;
    closeContextMenu();

    if (!confirm('Excluir este módulo interativo?')) return;

    try {
        const response = await fetch(`${AUTH_API}/world/placements/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Falha ao excluir');
        }

        socket.emit('deleteModulePlacement', id);
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
});

document.getElementById('menu-assign-module').addEventListener('click', async () => {
    const id = contextMenuTarget.userData.id;
    closeContextMenu();

    try {
        const response = await fetch(`${AUTH_API}/modules/my/assignable`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const modules = await response.json();

        if (modules.length === 0) {
            alert('Você não possui módulos para vincular. Crie um no Dashboard!');
            return;
        }

        // Show a simple prompt/selection for now (MVP)
        const moduleList = modules.map((m, i) => `${i + 1}. ${m.title} (${m.status})`).join('\n');
        const choice = prompt(`Escolha o módulo para vincular:\n\n${moduleList}\n\nDigite o número:`);

        const idx = parseInt(choice) - 1;
        if (isNaN(idx) || !modules[idx]) return;

        const selectedModule = modules[idx];

        const assignRes = await fetch(`${AUTH_API}/world/placements/${id}/assign-module`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ moduleId: selectedModule.id })
        });

        if (!assignRes.ok) {
            const data = await assignRes.json();
            throw new Error(data.error || 'Falha ao vincular');
        }

        socket.emit('updateModuleAssignment', {
            id,
            moduleId: selectedModule.id,
            moduleTitle: selectedModule.title,
            status: selectedModule.status
        });
        alert(`Módulo "${selectedModule.title}" vinculado com sucesso!`);
    } catch (err) {
        alert('Erro ao vincular módulo: ' + err.message);
    }
});

// --- Module Sidebar Logic ---

const moduleSidebar = document.getElementById('module-sidebar');
const btnCloseSidebar = document.getElementById('close-module-sidebar');
const moduleTitle = document.getElementById('module-sidebar-title');
const moduleDescription = document.getElementById('module-description');
const moduleGeneralShortcuts = document.getElementById('module-general-shortcuts');
const moduleGeneralAssets = document.getElementById('module-general-assets');
const moduleTabBtns = document.querySelectorAll('.module-tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

let currentModuleId = null;
let currentPlacementId = null;
let currentCourseModuleId = null;
let currentModulePayload = null;
let currentModuleRuntimeState = null;

btnCloseSidebar.onclick = () => moduleSidebar.classList.add('hidden');

function activateModuleTab(tab) {
    moduleTabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    tabPanes.forEach(pane => pane.classList.toggle('active', pane.id === `module-tab-${tab}`));
}

moduleTabBtns.forEach(btn => {
    btn.onclick = () => activateModuleTab(btn.dataset.tab);
});

async function openModuleSidebar(placementId, moduleId, courseModuleId = null) {
    const isOwner = localUserRole === 'MASTER' || localUserRole === 'ADMIN';

    if (!moduleId) {
        if (isOwner) {
            alert('Este sinalizador ainda não possui um módulo vinculado. Clique com o botão direito para vincular.');
        } else {
            alert('Este módulo ainda não foi configurado pelo professor.');
        }
        return;
    }

    currentModuleId = moduleId;
    currentPlacementId = placementId;

    // Reset UI
    moduleTitle.innerText = 'Carregando...';
    moduleDescription.innerText = '';
    if (moduleGeneralShortcuts) moduleGeneralShortcuts.innerHTML = '';
    if (moduleGeneralAssets) moduleGeneralAssets.innerHTML = '';
    document.getElementById('sidebar-preview-banner').classList.remove('active');
    moduleSidebar.classList.remove('hidden');
    // Set default tab
    activateModuleTab('general');

    try {
        const response = await fetch(`${AUTH_API}/runtime/modules/${moduleId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const module = await response.json();

        if (response.status === 403) {
            const errorMsg = module.error || 'Módulo indisponível ou em manutenção.';
            alert(errorMsg);
            moduleSidebar.classList.add('hidden');
            return;
        }

        if (!response.ok) throw new Error(module.error || 'Erro ao carregar módulo');

        moduleTitle.innerText = module.title;
        moduleDescription.innerText = module.description || 'Sem descrição.';

        if (module.isPreview) {
            document.getElementById('sidebar-preview-banner').classList.add('active');
        }

        renderModuleGeneral(module);
        renderModuleVideos(module.videos);
        renderModuleDocs(module.documents);
        renderModuleQuiz(module.quizzes);
        renderModuleForum(moduleId);
        renderModuleReports(module);

        // Analytics: Log Access
        fetch(`${AUTH_API}/modules/${moduleId}/access`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                source: 'MULTIPLAYER_WORLD',
                sceneId: 'level1',
                placementId: placementId
            })
        });

    } catch (err) {
        alert('Erro: ' + err.message);
        moduleSidebar.classList.add('hidden');
    }
}

function createPlacementBadge(parentGroup) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const updateBadge = () => {
        const { status, moduleTitle } = parentGroup.userData;
        const isMaster = localUserRole === 'MASTER' || localUserRole === 'ADMIN';

        let label = moduleTitle || (isMaster ? 'Sem Módulo' : 'Interativo');
        let color = '#3b82f6'; // Default blue

        if (status === 'DRAFT') {
            color = '#f59e0b';
            if (isMaster) label = `[Rascunho] ${moduleTitle || ''}`.trim();
        }
        else if (status === 'PUBLISHED') {
            color = '#10b981';
        }
        else if (status === 'ARCHIVED') {
            color = '#ef4444';
            if (isMaster) label = `[Arquivado] ${moduleTitle || ''}`.trim();
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background capsule
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        roundRect(ctx, 5, 10, 246, 44, 22, true);

        // Dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(25, 32, 6, 0, Math.PI * 2);
        ctx.fill();

        // Text (with basic truncation if too long)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px Inter, sans-serif';
        const displayLabel = label.length > 20 ? label.substring(0, 17) + '...' : label;
        ctx.fillText(displayLabel, 40, 40);

        texture.needsUpdate = true;
    };

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 0.375, 1);
    sprite.name = "status_badge";
    sprite.position.y = 1.8;
    parentGroup.add(sprite);

    updateBadge();

    // Listen for updates (we can wrap updateBadge in userData if we want to call it later)
    parentGroup.userData.refreshBadge = updateBadge;
}

function roundRect(ctx, x, y, width, height, radius, fill) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
}

function getModuleDocumentUrl(doc) {
    return `${AUTH_API}/api/documents/download/${doc.documentId || doc.id}`;
}

function classifyModuleDocument(doc) {
    const ext = doc.title ? doc.title.split('.').pop().toLowerCase() : '';
    const tType = (doc.type || '').toLowerCase();

    if (tType === 'application/pdf' || ext === 'pdf') {
        return { kind: 'pdf', label: 'PDF', accent: '#f87171' };
    }

    if (tType.includes('word') || tType.includes('officedocument.wordprocessingml') || ['doc', 'docx'].includes(ext)) {
        return { kind: 'word', label: 'Word', accent: '#60a5fa' };
    }

    if (tType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        return { kind: 'img', label: 'Imagem', accent: '#34d399' };
    }

    return { kind: 'file', label: 'Arquivo', accent: '#94a3b8' };
}

function trackModuleVideoProgress(videoId) {
    fetch(`${AUTH_API}/modules/${currentModuleId}/videos/${videoId}/progress`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ progress: 100, completed: true, source: 'MULTIPLAYER_WORLD' })
    }).catch(() => { });
}

function trackModuleDocumentDownload(doc) {
    fetch(`${AUTH_API}/modules/${currentModuleId}/documents/${doc.id}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ source: 'MULTIPLAYER_WORLD' })
    }).catch(() => { });
}

function previewModuleImageDocument(doc) {
    previewContent.innerHTML = '';

    const fullImg = document.createElement('img');
    fullImg.src = getModuleDocumentUrl(doc);
    fullImg.style.maxWidth = '100%';
    fullImg.style.maxHeight = '70vh';
    fullImg.style.objectFit = 'contain';
    previewContent.appendChild(fullImg);

    btnDownloadPreview.style.display = 'inline-block';
    btnDownloadPreview.onclick = () => {
        window.downloadSharedAsset(doc.documentId || doc.id, doc.title);
    };

    previewModal.classList.remove('hidden');
}

function openModuleDocumentAsset(doc) {
    const docMeta = classifyModuleDocument(doc);
    if (docMeta.kind === 'img') {
        previewModuleImageDocument(doc);
        return;
    }

    window.open(getModuleDocumentUrl(doc), '_blank', 'noopener');
    trackModuleDocumentDownload(doc);
}

function downloadModuleDocumentAsset(doc) {
    window.downloadSharedAsset(doc.documentId || doc.id, doc.title);
    trackModuleDocumentDownload(doc);
}

function openModuleVideoAsset(video) {
    playModuleVideo(video);
    trackModuleVideoProgress(video.id);
}

function openModuleForumFromSidebar() {
    window.open(`${AUTH_API.replace('api', '')}`, '_blank');
}

function openModuleReportsFromSidebar() {
    if (localUserRole === 'MASTER' || localUserRole === 'ADMIN') {
        window.open(`${AUTH_API.replace('api', '')}/dashboard`, '_blank');
        return;
    }

    activateModuleTab('reports');
}

function buildModuleGeneralShortcut(label, count, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'module-general-shortcut';
    button.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
    button.onclick = onClick;
    return button;
}

function buildModuleGeneralItem({ label, accent, title, caption, actionLabel, onClick }) {
    const item = document.createElement('div');
    item.className = 'module-general-item';

    const meta = document.createElement('div');
    meta.className = 'module-general-item-meta';

    const pill = document.createElement('span');
    pill.className = 'module-general-pill';
    pill.innerText = label;
    pill.style.color = accent;
    pill.style.borderColor = `${accent}33`;
    pill.style.background = `${accent}1a`;

    const titleEl = document.createElement('div');
    titleEl.className = 'module-general-item-title';
    titleEl.innerText = title;

    meta.appendChild(pill);
    meta.appendChild(titleEl);

    if (caption) {
        const captionEl = document.createElement('div');
        captionEl.className = 'module-general-item-caption';
        captionEl.innerText = caption;
        meta.appendChild(captionEl);
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn-open';
    action.innerText = actionLabel || 'Open';
    action.onclick = onClick;

    item.appendChild(meta);
    item.appendChild(action);
    return item;
}

function buildModuleGeneralSection(title, helperText, items, actionLabel, onAction) {
    const section = document.createElement('section');
    section.className = 'module-general-section';

    const head = document.createElement('div');
    head.className = 'module-general-section-head';

    const copy = document.createElement('div');
    const titleEl = document.createElement('h3');
    titleEl.innerText = title;
    copy.appendChild(titleEl);

    if (helperText) {
        const helper = document.createElement('span');
        helper.innerText = helperText;
        copy.appendChild(helper);
    }

    head.appendChild(copy);

    if (actionLabel && typeof onAction === 'function') {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'module-general-link';
        link.innerText = actionLabel;
        link.onclick = onAction;
        head.appendChild(link);
    }

    const list = document.createElement('div');
    list.className = 'module-general-list';
    items.forEach(item => list.appendChild(buildModuleGeneralItem(item)));

    section.appendChild(head);
    section.appendChild(list);
    return section;
}

function renderModuleGeneral(module) {
    if (!moduleGeneralShortcuts || !moduleGeneralAssets) return;

    const videos = Array.isArray(module.videos) ? module.videos : [];
    const documents = Array.isArray(module.documents) ? module.documents : [];
    const quizzes = Array.isArray(module.quizzes) ? module.quizzes : [];

    moduleGeneralShortcuts.innerHTML = '';
    moduleGeneralAssets.innerHTML = '';

    const shortcuts = [
        { label: 'Videos', count: videos.length, onClick: () => activateModuleTab('videos') },
        { label: 'Docs', count: documents.length, onClick: () => activateModuleTab('docs') },
        { label: 'Quiz', count: quizzes.length, onClick: () => activateModuleTab('quiz') },
        { label: 'Forum', count: 1, onClick: () => activateModuleTab('forum') },
        { label: 'Reports', count: 1, onClick: () => activateModuleTab('reports') }
    ];

    shortcuts
        .filter(shortcut => shortcut.count > 0)
        .forEach(shortcut => {
            moduleGeneralShortcuts.appendChild(
                buildModuleGeneralShortcut(shortcut.label, shortcut.count, shortcut.onClick)
            );
        });

    const sections = [];

    if (videos.length) {
        sections.push(buildModuleGeneralSection(
            'Videos',
            `${videos.length} item${videos.length === 1 ? '' : 's'}`,
            videos.map(video => ({
                label: 'Video',
                accent: '#f59e0b',
                title: video.title || 'Untitled video',
                caption: 'Play directly from General.',
                actionLabel: 'Open',
                onClick: () => openModuleVideoAsset(video)
            })),
            'Open tab',
            () => activateModuleTab('videos')
        ));
    }

    if (documents.length) {
        sections.push(buildModuleGeneralSection(
            'Documents',
            `${documents.length} file${documents.length === 1 ? '' : 's'}`,
            documents.map(doc => {
                const docMeta = classifyModuleDocument(doc);
                return {
                    label: docMeta.label,
                    accent: docMeta.accent,
                    title: doc.title || 'Untitled document',
                    caption: docMeta.kind === 'img' ? 'Preview image from General.' : 'Open the file directly.',
                    actionLabel: 'Open',
                    onClick: () => openModuleDocumentAsset(doc)
                };
            }),
            'Open tab',
            () => activateModuleTab('docs')
        ));
    }

    if (quizzes.length) {
        sections.push(buildModuleGeneralSection(
            'Quiz',
            `${quizzes.length} available`,
            quizzes.map(quiz => ({
                label: 'Quiz',
                accent: '#a78bfa',
                title: quiz.title || 'Module quiz',
                caption: 'Jump to the quiz tab and submit answers there.',
                actionLabel: 'Go to quiz',
                onClick: () => activateModuleTab('quiz')
            })),
            'Open tab',
            () => activateModuleTab('quiz')
        ));
    }

    sections.push(buildModuleGeneralSection(
        'Forum',
        'Discuss the module with the team.',
        [{
            label: 'Forum',
            accent: '#38bdf8',
            title: 'Module discussion',
            caption: 'Open the forum directly from General.',
            actionLabel: 'Open',
            onClick: () => openModuleForumFromSidebar()
        }],
        'Open tab',
        () => activateModuleTab('forum')
    ));

    sections.push(buildModuleGeneralSection(
        'Reports',
        localUserRole === 'MASTER' || localUserRole === 'ADMIN'
            ? 'Open the reports dashboard for this module.'
            : 'Check your progress summary.',
        [{
            label: 'Reports',
            accent: '#34d399',
            title: localUserRole === 'MASTER' || localUserRole === 'ADMIN'
                ? 'Module analytics dashboard'
                : 'Progress summary',
            caption: localUserRole === 'MASTER' || localUserRole === 'ADMIN'
                ? 'Open the dashboard in a new tab.'
                : 'View your current module progress.',
            actionLabel: 'Open',
            onClick: () => openModuleReportsFromSidebar()
        }],
        'Open tab',
        () => activateModuleTab('reports')
    ));

    if (!sections.length) {
        moduleGeneralAssets.innerHTML = '<p class="module-general-empty">No extra content available in this module yet.</p>';
        return;
    }

    sections.forEach(section => moduleGeneralAssets.appendChild(section));
}

function renderModuleVideos(videos) {
    const grid = document.getElementById('module-videos-grid');
    if (!grid) return;
    grid.innerHTML = videos.length ? '' : '<p style="padding: 20px; color: #94a3b8;">Nenhum vídeo disponível.</p>';

    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.gap = '1.5rem';

    videos.forEach(v => {
        const card = document.createElement('div');
        card.style.background = 'rgba(255,255,255,0.05)';
        card.style.borderRadius = '12px';
        card.style.padding = '15px';
        card.style.cursor = 'pointer';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '10px';

        const titleTop = document.createElement('h4');
        titleTop.innerText = v.title;
        titleTop.style.margin = '0';
        titleTop.style.fontSize = '1.1rem';
        titleTop.style.color = '#fff';

        const thumb = document.createElement('div');
        thumb.style.width = '100%';
        thumb.style.height = '180px';
        thumb.style.position = 'relative';
        thumb.style.borderRadius = '8px';
        thumb.style.overflow = 'hidden';
        thumb.style.backgroundColor = 'rgba(0,0,0,0.5)';
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';

        // Thumbnail generation
        let fullUrl = v.url;
        if (fullUrl && fullUrl.startsWith('/api/')) {
            fullUrl = `${AUTH_API}${fullUrl}`;
        }

        const ytMatch = fullUrl ? fullUrl.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/) : null;
        if (ytMatch) {
            const img = document.createElement('img');
            img.src = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            thumb.appendChild(img);
        } else {
            const videoElem = document.createElement('video');
            videoElem.src = fullUrl || '';
            videoElem.crossOrigin = 'anonymous';
            videoElem.preload = 'metadata';
            videoElem.muted = true;
            videoElem.style.width = '100%';
            videoElem.style.height = '100%';
            videoElem.style.objectFit = 'cover';
            videoElem.style.pointerEvents = 'none';
            // Force load the first frame
            videoElem.currentTime = 0.1;

            thumb.appendChild(videoElem);
        }

        const playIcon = document.createElement('div');
        playIcon.innerHTML = '▶';
        playIcon.style.cssText = 'position: absolute; color: white; font-size: 3rem; filter: drop-shadow(0 0 8px rgba(0,0,0,0.8)); top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; text-shadow: 0 0 10px rgba(0,0,0,0.5);';
        thumb.appendChild(playIcon);

        card.appendChild(titleTop);
        card.appendChild(thumb);

        card.onclick = () => {
            playModuleVideo(v);
            fetch(`${AUTH_API}/modules/${currentModuleId}/videos/${v.id}/progress`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ progress: 100, completed: true, source: 'MULTIPLAYER_WORLD' })
            });
        };
        grid.appendChild(card);
    });
}

function playModuleVideo(video) {
    previewContent.innerHTML = '';

    let url = video.url;
    if (url && url.startsWith('/api/')) {
        url = `${AUTH_API}${url}`;
    }

    if (!url) {
        alert("URL do vídeo inválido.");
        return;
    }

    if (url.includes('/api/documents/download/') || url.match(/\.(mp4|webm|ogg)$/i)) {
        const videoElement = document.createElement('video');
        videoElement.src = url;
        videoElement.controls = true;
        videoElement.autoplay = true;
        videoElement.style.width = '100%';
        videoElement.style.maxHeight = '70vh';
        previewContent.appendChild(videoElement);
        btnDownloadPreview.style.display = 'inline-block';
        btnDownloadPreview.onclick = () => {
            const parts = url.split('/');
            const id = parts[parts.length - 1];
            window.downloadSharedAsset(id, video.title || 'video');
        };
    } else {
        const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.get_video_info|youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
        if (ytMatch) {
            const iframe = document.createElement('iframe');
            iframe.src = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1`;
            iframe.width = '100%';
            iframe.height = '450px';
            iframe.frameBorder = '0';
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            iframe.allowFullscreen = true;
            previewContent.appendChild(iframe);
            btnDownloadPreview.style.display = 'none';
        } else {
            window.open(url, '_blank');
            return;
        }
    }

    previewModal.classList.remove('hidden');
}

window.switchModuleDocTab = function (type) {
    document.querySelectorAll('.module-doc-sub-tab').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = 'var(--text-muted)';
        btn.style.borderBottomColor = 'transparent';
    });

    const activeBtn = document.querySelector(`.module-doc-sub-tab[data-type="${type}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = 'var(--primary)';
        activeBtn.style.borderBottomColor = 'var(--primary)';
    }

    document.querySelectorAll('.module-doc-sub-pane').forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
        p.style.display = 'none';
        p.style.opacity = '0';
    });

    const activePane = document.getElementById(`module-doc-pane-${type}`);
    if (activePane) {
        activePane.classList.remove('hidden');
        activePane.classList.add('active');
        activePane.style.display = 'block';
        setTimeout(() => activePane.style.opacity = '1', 10);
    }
};

function renderModuleDocs(docs) {
    const pdfList = document.getElementById('module-pdf-list');
    const wordList = document.getElementById('module-word-list');
    const imgGrid = document.getElementById('module-img-grid');

    if (!pdfList || !wordList || !imgGrid) return;

    pdfList.innerHTML = '';
    wordList.innerHTML = '';
    imgGrid.innerHTML = '';

    docs.forEach(d => {
        const ext = d.title ? d.title.split('.').pop().toLowerCase() : '';
        const tType = (d.type || '').toLowerCase();

        const isPdf = tType === 'application/pdf' || ext === 'pdf';
        const isWord = tType.includes('word') || tType.includes('officedocument.wordprocessingml') || ['doc', 'docx'].includes(ext);
        const isImg = tType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

        if (isPdf) {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '0.5rem';
            li.style.background = 'rgba(255,255,255,0.05)';
            li.style.borderRadius = '8px';
            li.innerHTML = `
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="color: #ff4444; font-weight:bold;">📄 PDF</span>
                    <span>${d.title}</span>
                </div>
                <button class="btn-sm" style="background: var(--primary); color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">Download</button>
            `;
            li.querySelector('button').onclick = () => {
                window.downloadSharedAsset(d.documentId || d.id, d.title);
                fetch(`${AUTH_API}/modules/${currentModuleId}/documents/${d.id}/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ source: 'MULTIPLAYER_WORLD' })
                });
            };
            pdfList.appendChild(li);
        } else if (isWord) {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '0.5rem';
            li.style.background = 'rgba(255,255,255,0.05)';
            li.style.borderRadius = '8px';
            li.innerHTML = `
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="color: #4488ff; font-weight:bold;">📝 Word</span>
                    <span>${d.title}</span>
                </div>
                <button class="btn-sm" style="background: var(--primary); color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer;">Download</button>
            `;
            li.querySelector('button').onclick = () => {
                window.downloadSharedAsset(d.documentId || d.id, d.title);
                fetch(`${AUTH_API}/modules/${currentModuleId}/documents/${d.id}/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ source: 'MULTIPLAYER_WORLD' })
                });
            };
            wordList.appendChild(li);
        } else if (isImg) {
            const card = document.createElement('div');
            card.style.position = 'relative';
            card.style.background = 'rgba(255,255,255,0.05)';
            card.style.padding = '0.5rem';
            card.style.borderRadius = '8px';
            card.style.cursor = 'pointer';

            const thumb = document.createElement('div');
            thumb.style.width = '100%';
            thumb.style.height = '100px';
            thumb.style.backgroundColor = 'rgba(0,0,0,0.5)';
            thumb.style.borderRadius = '4px';
            thumb.style.overflow = 'hidden';
            thumb.style.display = 'flex';
            thumb.style.alignItems = 'center';
            thumb.style.justifyContent = 'center';

            const img = document.createElement('img');
            img.src = `${AUTH_API}/api/documents/download/${d.documentId || d.id}`;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
            thumb.appendChild(img);

            const name = document.createElement('span');
            name.style.display = 'block';
            name.style.marginTop = '0.5rem';
            name.style.fontSize = '0.8rem';
            name.style.textAlign = 'center';
            name.style.whiteSpace = 'nowrap';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.innerText = d.title;

            card.appendChild(thumb);
            card.appendChild(name);

            card.onclick = () => {
                previewContent.innerHTML = '';
                const fullImg = document.createElement('img');
                fullImg.src = `${AUTH_API}/api/documents/download/${d.documentId || d.id}`;
                fullImg.style.maxWidth = '100%';
                fullImg.style.maxHeight = '70vh';
                fullImg.style.objectFit = 'contain';
                previewContent.appendChild(fullImg);

                btnDownloadPreview.style.display = 'inline-block';
                btnDownloadPreview.onclick = () => {
                    window.downloadSharedAsset(d.documentId || d.id, d.title);
                };
                previewModal.classList.remove('hidden');
            };

            imgGrid.appendChild(card);
        }
    });

    if (pdfList.innerHTML === '') pdfList.innerHTML = '<div style="color: #94a3b8; padding: 10px;">Nenhum arquivo PDF.</div>';
    if (wordList.innerHTML === '') wordList.innerHTML = '<div style="color: #94a3b8; padding: 10px;">Nenhum arquivo Word.</div>';
    if (imgGrid.innerHTML === '') imgGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 10px;">Nenhuma imagem.</div>';

    if (typeof window.switchModuleDocTab === 'function') {
        window.switchModuleDocTab('pdf');
    }
}

function renderModuleQuiz(quizzes) {
    const container = document.querySelector('#module-tab-quiz .quiz-container');
    container.innerHTML = (quizzes && quizzes.length) ? '' : '<p style="padding: 20px; color: #94a3b8;">Nenhum quiz disponível.</p>';

    (quizzes || []).forEach((quiz) => {
        const quizBox = document.createElement('div');
        quizBox.className = 'quiz-box glassmorphism';
        quizBox.style.marginBottom = '20px';
        quizBox.style.padding = '15px';
        quizBox.style.borderRadius = '12px';
        quizBox.style.background = 'rgba(255,255,255,0.05)';

        quizBox.innerHTML = `<h3 style="color: var(--accent-color); margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;">${quiz.title}</h3>`;

        quiz.questions.forEach((q, qIdx) => {
            const qDiv = document.createElement('div');
            qDiv.className = 'quiz-question';
            qDiv.style.marginBottom = '15px';
            qDiv.innerHTML = `<p style="margin-bottom: 8px;"><strong>${qIdx + 1}. ${q.text}</strong></p>`;

            q.options.forEach(opt => {
                const optDiv = document.createElement('div');
                optDiv.style.marginBottom = '4px';
                optDiv.innerHTML = `
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <input type="radio" name="quiz_${quiz.id}_question_${q.id}" value="${opt.id}">
                        ${opt.text}
                    </label>
                `;
                qDiv.appendChild(optDiv);
            });
            quizBox.appendChild(qDiv);
        });

        if (quiz.questions.length) {
            const submitBtn = document.createElement('button');
            submitBtn.className = 'btn-open';
            submitBtn.style.marginTop = '10px';
            submitBtn.style.width = '100%';
            submitBtn.innerText = 'Enviar este Quiz';
            submitBtn.onclick = async () => {
                const answers = [];
                quiz.questions.forEach(q => {
                    const selected = quizBox.querySelector(`input[name="quiz_${quiz.id}_question_${q.id}"]:checked`);
                    if (selected) answers.push({ questionId: q.id, optionId: parseInt(selected.value) });
                });

                if (answers.length < quiz.questions.length) {
                    alert('Responda todas as perguntas deste quiz antes de enviar.');
                    return;
                }

                try {
                    submitBtn.disabled = true;
                    submitBtn.innerText = 'Submitting...';
                    const res = await fetch(`${AUTH_API}/modules/${currentModuleId}/quiz/submit`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`
                        },
                        body: JSON.stringify({ answers, source: 'MULTIPLAYER_WORLD', courseId: window.__courseWorldContext?.courseId || null })
                    });
                    const result = await res.json();
                    if (!res.ok) throw new Error(result.error || 'Erro ao enviar');
                    alert(`Quiz "${quiz.title}" enviado! Sua nota parcial: ${result.score.toFixed(1)}%`);
                } catch (err) {
                    alert('Erro ao enviar quiz: ' + err.message);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Enviar este Quiz';
                }
            };
            quizBox.appendChild(submitBtn);
        }
        container.appendChild(quizBox);
    });
}

function renderModuleForum(moduleId) {
    const container = document.getElementById('module-forum-container');
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <p style="color: #94a3b8; margin-bottom: 20px;">Participe das discussões deste módulo.</p>
            <button class="upload-btn" onclick="window.open('${AUTH_API.replace('api', '')}', '_blank')">Abrir Fórum</button>
        </div>
    `;
}

function renderModuleReports(module) {
    const container = document.getElementById('module-reports-container');
    if (!container) return;
    const isMaster = localUserRole === 'MASTER' || localUserRole === 'ADMIN';

    if (isMaster) {
        container.innerHTML = `
            <div style="padding: 10px;">
                <h3 style="font-size: 1rem; margin-bottom: 15px;">DesempenHO do Módulo</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                    <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8;">ACESSOS</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">--</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8;">QUIZ COMPLETOS</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">--</div>
                    </div>
                </div>
                <button class="upload-btn" style="width: 100%;" onclick="window.open('${AUTH_API.replace('api', '')}/dashboard', '_blank')">Ver Relatórios Completos</button>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: #94a3b8;">Seu progresso neste módulo será exibido aqui em breve.</p>
                <div style="margin-top: 20px; height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; overflow: hidden;">
                    <div style="width: 30%; height: 100%; background: #60a5fa;"></div>
                </div>
                <p style="font-size: 0.75rem; margin-top: 10px; color: #60a5fa;">30% Concluído</p>
            </div>
        `;
    }
}

function getActiveCourseRuntimeModule(courseModuleId = currentCourseModuleId, moduleId = currentModuleId) {
    const runtimeModules = window.__courseWorldContext?.runtime?.modules || [];
    return runtimeModules.find((entry) => {
        if (courseModuleId && entry.courseModuleId === courseModuleId) return true;
        return entry.moduleId === moduleId;
    }) || null;
}

function updateRuntimeModuleFromQuizSubmission(score) {
    const runtimeModule = getActiveCourseRuntimeModule();
    if (!runtimeModule) return null;
    const bestQuizScore = runtimeModule.bestQuizScore === null || runtimeModule.bestQuizScore === undefined
        ? score
        : Math.max(runtimeModule.bestQuizScore, score);
    runtimeModule.bestQuizScore = bestQuizScore;
    runtimeModule.latestQuizScore = score;
    runtimeModule.quizAttemptCount = Number(runtimeModule.quizAttemptCount || 0) + 1;
    if (runtimeModule.quizRequirementActive) {
        runtimeModule.quizPassed = bestQuizScore >= Number(runtimeModule.minimumQuizScore || 0);
    }
    currentModuleRuntimeState = runtimeModule;
    return runtimeModule;
}

function refreshCourseWorldRuntime() {
    if (!COURSE_ID_FROM_URL) {
        currentModuleRuntimeState = getActiveCourseRuntimeModule();
        return Promise.resolve(window.__courseWorldContext?.runtime || null);
    }

    return new Promise((resolve) => {
        let settled = false;
        const handleRuntimeUpdated = (event) => {
            settled = true;
            currentModuleRuntimeState = getActiveCourseRuntimeModule();
            resolve(event.detail || window.__courseWorldContext?.runtime || null);
        };

        window.addEventListener('course-world:runtime-updated', handleRuntimeUpdated, { once: true });
        window.dispatchEvent(new CustomEvent('course-world:refresh-runtime'));

        window.setTimeout(() => {
            if (settled) return;
            window.removeEventListener('course-world:runtime-updated', handleRuntimeUpdated);
            currentModuleRuntimeState = getActiveCourseRuntimeModule();
            resolve(window.__courseWorldContext?.runtime || null);
        }, 3000);
    });
}

async function openModuleSidebarLegacy(placementId, moduleId, courseModuleId = null) {
    const isOwner = localUserRole === 'MASTER' || localUserRole === 'ADMIN';

    if (!moduleId) {
        if (isOwner) {
            alert('Este sinalizador ainda nÃ£o possui um mÃ³dulo vinculado. Clique com o botÃ£o direito para vincular.');
        } else {
            alert('Este mÃ³dulo ainda nÃ£o foi configurado pelo professor.');
        }
        return;
    }

    currentModuleId = moduleId;
    currentPlacementId = placementId;
    currentCourseModuleId = courseModuleId || null;
    currentModulePayload = null;
    currentModuleRuntimeState = getActiveCourseRuntimeModule(courseModuleId, moduleId);

    moduleTitle.innerText = 'Carregando...';
    moduleDescription.innerText = '';
    if (moduleGeneralShortcuts) moduleGeneralShortcuts.innerHTML = '';
    if (moduleGeneralAssets) moduleGeneralAssets.innerHTML = '';
    document.getElementById('sidebar-preview-banner').classList.remove('active');
    moduleSidebar.classList.remove('hidden');
    activateModuleTab('general');

    try {
        const response = await fetch(`${AUTH_API}/runtime/modules/${moduleId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const module = await response.json();

        if (response.status === 403) {
            const errorMsg = module.error || 'MÃ³dulo indisponÃ­vel ou em manutenÃ§Ã£o.';
            alert(errorMsg);
            moduleSidebar.classList.add('hidden');
            return;
        }

        if (!response.ok) throw new Error(module.error || 'Erro ao carregar mÃ³dulo');

        currentModulePayload = module;
        currentModuleRuntimeState = getActiveCourseRuntimeModule(courseModuleId, moduleId);
        moduleTitle.innerText = module.title;
        moduleDescription.innerText = module.description || 'Sem descriÃ§Ã£o.';

        if (module.isPreview) {
            document.getElementById('sidebar-preview-banner').classList.add('active');
        }

        renderModuleGeneral(module);
        renderModuleVideos(module.videos);
        renderModuleDocs(module.documents);
        renderModuleQuiz(module.quizzes);
        renderModuleForum(moduleId);
        renderModuleReports(module);

        fetch(`${AUTH_API}/modules/${moduleId}/access`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                source: 'MULTIPLAYER_WORLD',
                sceneId: COURSE_ID_FROM_URL ? `course-${COURSE_ID_FROM_URL}` : 'level1',
                placementId
            })
        });
    } catch (err) {
        alert('Erro: ' + err.message);
        moduleSidebar.classList.add('hidden');
    }
}

function renderModuleQuizLegacy(quizzes) {
    const container = document.querySelector('#module-tab-quiz .quiz-container');
    const submitBtn = document.getElementById('btn-submit-quiz');
    if (!container || !submitBtn) return;

    currentModuleRuntimeState = getActiveCourseRuntimeModule();
    const hasQuizzes = Boolean(quizzes && quizzes.length);
    if (!hasQuizzes) {
        container.innerHTML = '<p style="padding: 20px; color: #94a3b8;">Nenhum quiz disponÃ­vel.</p>';
        submitBtn.classList.add('hidden');
        submitBtn.onclick = null;
        return;
    }

    const bestScore = currentModuleRuntimeState?.bestQuizScore;
    const minimumScore = currentModuleRuntimeState?.minimumQuizScore;
    const quizGateActive = Boolean(currentModuleRuntimeState?.quizRequirementActive);
    const quizPassed = Boolean(currentModuleRuntimeState?.quizPassed);
    const gateCopy = quizGateActive
        ? `This room only unlocks after you mark it done and score at least ${Math.round(minimumScore || 0)}% on the quiz.`
        : 'Complete the full module quiz to register your score.';
    const scoreCopy = bestScore === null || bestScore === undefined
        ? 'No graded attempt yet.'
        : `Best attempt: ${bestScore.toFixed(1)}%${quizGateActive ? (quizPassed ? ' • Requirement met' : ' • Requirement not met yet') : ''}`;

    container.innerHTML = `
        <div style="margin-bottom: 18px; padding: 14px 16px; border-radius: 14px; border: 1px solid ${quizGateActive ? 'rgba(96,165,250,0.28)' : 'rgba(255,255,255,0.08)'}; background: ${quizGateActive ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.04)'};">
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center;">
                <strong style="color:#f8fafc;">${quizGateActive ? 'Quiz gate active' : 'Module quiz'}</strong>
                ${quizGateActive ? `<span style="font-size:0.75rem; padding:0.25rem 0.55rem; border-radius:999px; color:${quizPassed ? '#d1fae5' : '#dbeafe'}; background:${quizPassed ? 'rgba(16,185,129,0.16)' : 'rgba(59,130,246,0.16)'}; border:1px solid ${quizPassed ? 'rgba(52,211,153,0.3)' : 'rgba(96,165,250,0.26)'};">${quizPassed ? 'Passed' : `Need ${Math.round(minimumScore || 0)}%`}</span>` : ''}
            </div>
            <p style="margin:10px 0 6px; color:#cbd5e1; font-size:0.88rem; line-height:1.5;">${gateCopy}</p>
            <p style="margin:0; color:${bestScore === null || bestScore === undefined ? '#94a3b8' : (quizPassed ? '#86efac' : '#93c5fd')}; font-size:0.82rem;">${scoreCopy}</p>
        </div>
    `;

    (quizzes || []).forEach((quiz, quizIndex) => {
        const questionCount = quiz.questions?.length || 0;
        const quizBox = document.createElement('div');
        quizBox.className = 'quiz-box glassmorphism';
        quizBox.style.marginBottom = '20px';
        quizBox.style.padding = '15px';
        quizBox.style.borderRadius = '12px';
        quizBox.style.background = 'rgba(255,255,255,0.05)';
        quizBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                <h3 style="color: var(--accent-color); margin: 0;">${quiz.title}</h3>
                <span style="font-size:0.76rem; color:#94a3b8;">${questionCount} question${questionCount === 1 ? '' : 's'}</span>
            </div>
        `;

        quiz.questions.forEach((q, qIdx) => {
            const qDiv = document.createElement('div');
            qDiv.className = 'quiz-question';
            qDiv.style.marginBottom = '15px';
            qDiv.innerHTML = `<p style="margin-bottom: 8px;"><strong>${quizIndex + 1}.${qIdx + 1} ${q.text}</strong></p>`;

            q.options.forEach((opt) => {
                const optDiv = document.createElement('div');
                optDiv.style.marginBottom = '4px';
                optDiv.innerHTML = `
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <input type="radio" name="quiz_${quiz.id}_question_${q.id}" value="${opt.id}">
                        ${opt.text}
                    </label>
                `;
                qDiv.appendChild(optDiv);
            });
            quizBox.appendChild(qDiv);
        });

        container.appendChild(quizBox);
    });

    submitBtn.classList.remove('hidden');
    submitBtn.innerText = 'Submit Full Quiz';
    submitBtn.disabled = false;
    submitBtn.onclick = async () => {
        const answers = [];
        let totalQuestions = 0;

        (quizzes || []).forEach((quiz) => {
            quiz.questions.forEach((question) => {
                totalQuestions += 1;
                const selected = container.querySelector(`input[name="quiz_${quiz.id}_question_${question.id}"]:checked`);
                if (selected) {
                    answers.push({ questionId: question.id, optionId: parseInt(selected.value, 10) });
                }
            });
        });

        if (answers.length < totalQuestions) {
            alert('Answer every question before submitting the full quiz.');
            return;
        }

        try {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Submitting...';
            const res = await fetch(`${AUTH_API}/modules/${currentModuleId}/quiz/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    answers,
                    source: 'MULTIPLAYER_WORLD',
                    courseId: window.__courseWorldContext?.courseId || null
                })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Erro ao enviar');

            updateRuntimeModuleFromQuizSubmission(result.score);
            await refreshCourseWorldRuntime();
            currentModuleRuntimeState = getActiveCourseRuntimeModule();
            renderModuleQuiz(quizzes);
            alert(`Quiz submitted. Score: ${result.score.toFixed(1)}%`);
        } catch (err) {
            alert('Erro ao enviar quiz: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit Full Quiz';
        }
    };
}

async function fetchModulePlacements() {
    if (COURSE_ID_FROM_URL) return;
    try {
        const response = await fetch(`${AUTH_API}/world/placements?sceneId=level1`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const placements = await response.json();
        if (response.ok) {
            placements.forEach(p => {
                // Check if already in idToUuid (managed by initialModulePlacements socket sync)
                if (!idToUuid[p.id]) {
                    createModulePlacement({
                        id: p.id,
                        moduleId: p.moduleId,
                        status: p.module ? p.module.status : 'NONE',
                        position: { x: p.positionX, y: p.positionY, z: p.positionZ },
                        rotation: { x: p.rotationX, y: p.rotationY, z: p.rotationZ }
                    });
                }
            });
        }
    } catch (err) {
        console.error("Error fetching module placements:", err);
    }
}

// --- 4. PeerJS & P2P Audio Logic ---

async function initPeer() {
    // Get media access (Try video + audio first)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { width: 640, height: 480 }
        });
        localVideo.srcObject = localStream;
        console.log('Camera and Microphone Ready');
    } catch (err) {
        console.warn('Camera failed, falling back to audio only + dummy track:', err);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

            // Dummy track for video negotiation
            const canvas = document.createElement('canvas');
            canvas.width = 1; canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, 1, 1);
            const dummyStream = canvas.captureStream();
            const dummyTrack = dummyStream.getVideoTracks()[0];
            localStream.addTrack(dummyTrack);

            console.log('Microphone Ready (Audio Only + Placeholder Video)');
        } catch (audioErr) {
            console.error('All media access denied:', audioErr);
            return;
        }
    }

    // Official audio-call-app URL on Railway
    const AUDIO_SERVER_HOST = 'audio-call-app-production.up.railway.app';

    peer = new Peer({
        host: AUDIO_SERVER_HOST,
        port: 443,
        path: '/peerjs',
        secure: true
    });

    peer.on('open', (id) => {
        console.log('PeerJS Connected, ID:', id);
        socket.emit('setPeerId', id);
    });

    peer.on('call', (call) => {
        if (currentCall) {
            call.answer();
            call.close();
            return;
        }

        const callerName = peerIdToName[call.peer] || 'Unknown';
        incomingCaller.innerText = callerName;
        incomingModal.classList.remove('hidden');

        btnAnswer.onclick = () => {
            incomingModal.classList.add('hidden');
            answerCall(call);
        };

        btnReject.onclick = () => {
            incomingModal.classList.add('hidden');
            call.answer();
            call.close();
        };
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err.type);
    });
}

function makeCall(targetPeerId, name) {
    if (!localStream) return alert('Microphone not detected.');
    callingName.innerText = name;
    audioCallLayer.classList.remove('hidden');

    currentCall = peer.call(targetPeerId, localStream);
    setupCallListeners(currentCall);
}

function answerCall(call) {
    currentCall = call;
    const callerName = peerIdToName[call.peer] || 'Connected';
    callingName.innerText = callerName;
    audioCallLayer.classList.remove('hidden');

    setupCallListeners(currentCall);
    currentCall.answer(localStream);
}

function setupCallListeners(call) {
    if (!call) return;
    call.on('stream', (remoteStream) => {
        console.log("Stream remoto recebido");
        const hasVideo = remoteStream.getVideoTracks().length > 0;

        if (hasVideo) {
            videoContainer.classList.remove('hidden');
            remoteVideo.srcObject = remoteStream;
            remoteVideo.play().catch(e => console.warn(e));
        } else {
            videoContainer.classList.add('hidden');
        }

        remoteAudio.srcObject = remoteStream;
        setupVisualizer(remoteStream);

        if (!callDurationInterval) {
            startTimer();
        }
    });

    call.on('close', () => {
        resetAudioUI();
    });
}

function setupVisualizer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    const bars = document.querySelectorAll('.bar');

    function draw() {
        if (!currentCall) {
            cancelAnimationFrame(animationFrameId);
            return;
        }
        animationFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        bars.forEach((bar, index) => {
            const val = dataArray[index] || 0;
            const height = Math.max(5, (val / 255) * 25);
            bar.style.height = `${height}px`;
            bar.style.opacity = 0.3 + (val / 255) * 0.7;
        });
    }
    draw();
}

function resetAudioUI() {
    stopTimer();
    audioCallLayer.classList.add('hidden');
    videoContainer.classList.add('hidden');

    if (currentCall) currentCall.close();
    currentCall = null;

    remoteAudio.srcObject = null;
    remoteVideo.srcObject = null;

    // Stop local video track but keep audio for future calls if needed
    // or just leave it if we want users to "stay ready"

    const bars = document.querySelectorAll('.bar');
    bars.forEach(bar => {
        bar.style.height = '5px';
        bar.style.opacity = 0.3;
    });
}

function startTimer() {
    secondsElapsed = 0;
    callTimer.innerText = '00:00';
    callDurationInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        callTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (callDurationInterval) {
        clearInterval(callDurationInterval);
        callDurationInterval = null; // CRITICAL: Reset the interval variable
    }
}

btnHangup.onclick = () => {
    if (currentCall) currentCall.close();
    resetAudioUI();
};

btnMute.onclick = () => {
    const enabled = localStream.getAudioTracks()[0].enabled;
    localStream.getAudioTracks()[0].enabled = !enabled;
    btnMute.innerText = !enabled ? '🎤' : '🔇';
    btnMute.style.background = !enabled ? 'rgba(255, 255, 255, 0.1)' : '#ef4444';
};

btnCamera.onclick = async () => {
    let videoTrack = localStream.getVideoTracks()[0];
    const isDummy = videoTrack && videoTrack.label === ''; // Canvas tracks often have empty labels

    if (!videoTrack || isDummy || !videoTrack.enabled) {
        if (!videoTrack || isDummy) {
            try {
                const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const newTrack = tempStream.getVideoTracks()[0];

                if (videoTrack) localStream.removeTrack(videoTrack);
                localStream.addTrack(newTrack);
                localVideo.srcObject = localStream;
                btnCamera.classList.add('active');
                videoContainer.classList.remove('hidden');

                if (currentCall && currentCall.peerConnection) {
                    const senders = currentCall.peerConnection.getSenders();
                    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                    if (videoSender) videoSender.replaceTrack(newTrack);
                    else currentCall.peerConnection.addTrack(newTrack, localStream);
                }
            } catch (err) {
                alert('Não foi possível acessar a câmera.');
            }
        } else {
            videoTrack.enabled = true;
            btnCamera.classList.add('active');
            videoContainer.classList.remove('hidden');
        }
    } else {
        videoTrack.enabled = false;
        btnCamera.classList.remove('active');
        const remoteHasVideo = currentCall && remoteVideo.srcObject && remoteVideo.srcObject.getVideoTracks().some(t => t.enabled);
        if (!remoteHasVideo) videoContainer.classList.add('hidden');
    }
};

// --- Player Interaction Menu & Asset Modal ---

function showPlayerActionMenu(username, event) {
    selectedPlayerForAction = username;
    actionMenuName.innerText = username;

    const point = {
        x: event?.clientX ?? event?.x ?? window.innerWidth / 2,
        y: event?.clientY ?? event?.y ?? window.innerHeight / 2
    };

    playerActionMenu.style.left = point.x + 'px';
    playerActionMenu.style.top = point.y + 'px';
    playerActionMenu.classList.remove('hidden');

    // Auto-close when clicking elsewhere
    const closeMenu = () => {
        playerActionMenu.classList.add('hidden');
        window.removeEventListener('click', closeMenu);
    };
    setTimeout(() => window.addEventListener('click', closeMenu), 10);
}

btnCallPlayer.addEventListener('click', () => {
    if (selectedPlayerPeerId) {
        makeCall(selectedPlayerPeerId, selectedPlayerForAction);
    } else {
        alert('This player has not configured a voice channel yet.');
    }
});

btnViewAssets.addEventListener('click', () => {
    showAssetModal(selectedPlayerForAction);
});

async function showAssetModal(username) {
    console.log("Attempting to fetch assets for username:", username);
    modalUsernameSpan.innerText = username;
    isSelfModal = false; // This is for other users
    currentAssetTab = 'image'; // Default to image tab

    // UI Setup
    updateTabUI();
    assetListBody.innerHTML = '<tr><td colspan="2">Loading assets...</td></tr>';
    assetGridContainer.innerHTML = 'Carregando...';
    assetModalOverlay.classList.remove('hidden');
    if (btnUploadAsset) {
        btnUploadAsset.classList.add('hidden'); // Hide upload button for other users
        btnUploadAsset.style.display = 'none'; // Ensure it's hidden
    }

    try {
        const response = await fetch(`${AUTH_API}/api/documents/user/${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error('Could not load the files.');

        const data = await response.json();
        currentLoadedAssets = data.documents || []; // Use currentLoadedAssets

        if (currentLoadedAssets.length === 0) {
            assetListBody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px;">No shared files.</td></tr>';
            assetGridContainer.innerHTML = '<div style="text-align: center; width: 100%; padding: 3rem; color: var(--text-secondary);">Nenhum arquivo nesta categoria.</div>';
        } else {
            renderCurrentTab();
        }
    } catch (err) {
        console.error("Error fetching assets:", err);
        assetListBody.innerHTML = `<tr><td colspan="2" style="color: #ef4444; text-align:center; padding:20px;">Erro: ${err.message}</td></tr>`;
        assetGridContainer.innerHTML = `<div style="color: #ef4444; padding: 2rem;">Erro: ${err.message}</div>`;
    }
}

// Global download function for the modal
window.downloadSharedAsset = async (id, name) => {
    try {
        const response = await fetch(`${AUTH_API}/api/documents/download/${id}`);
        if (!response.ok) throw new Error('Download falhou');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        alert('Erro ao baixar arquivo: ' + err.message);
    }
};

closeAssetModalBtn.addEventListener('click', () => {
    assetModalOverlay.classList.add('hidden');
});

assetModalOverlay.addEventListener('click', (e) => {
    if (e.target === assetModalOverlay) {
        assetModalOverlay.classList.add('hidden');
        btnUploadAsset.classList.add('hidden');
        assetThDate.classList.add('hidden');
    }
});

// --- Advanced Asset Management ---

let currentFilteredAssets = []; // Added for preview navigation
let currentIndex = -1; // Added for preview navigation

function updateTabUI() {
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === currentAssetTab);
    });
}

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentAssetTab = btn.dataset.tab;
        updateTabUI();
        renderCurrentTab();
    });
});

async function showSelfAssetModal() {
    modalUsernameSpan.innerText = `${localUsername} (My Profile)`;
    isSelfModal = true;
    currentAssetTab = 'image';

    updateTabUI();
    btnUploadAsset.classList.remove('hidden');
    btnUploadAsset.style.display = 'block'; // Ensure upload button is visible for self
    assetModalOverlay.classList.remove('hidden');

    loadSelfAssets();
}

async function loadSelfAssets() {
    assetListBody.innerHTML = '<tr><td colspan="3">Carregando seus arquivos...</td></tr>';
    assetGridContainer.innerHTML = 'Carregando...';

    try {
        const response = await fetch(`${AUTH_API}/api/documents`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Erro ao carregar arquivos');

        currentLoadedAssets = data.documents || [];
        renderCurrentTab();
    } catch (err) {
        assetListBody.innerHTML = `<tr><td colspan="3" style="color: #ef4444;">Erro: ${err.message}</td></tr>`;
        assetGridContainer.innerHTML = `<div style="color: #ef4444; padding: 2rem;">Erro: ${err.message}</div>`;
    }
}

function renderCurrentTab() {
    currentFilteredAssets = currentLoadedAssets.filter(doc => {
        const type = doc.type.toLowerCase();
        if (currentAssetTab === 'image') return type.startsWith('image/');
        if (currentAssetTab === 'video') return type.startsWith('video/');
        if (currentAssetTab === 'pdf') return type === 'application/pdf';
        if (currentAssetTab === 'word') return type.includes('msword') || type.includes('officedocument.wordprocessingml');
        return false;
    });

    if (currentAssetTab === 'image' || currentAssetTab === 'video') {
        assetListTable.classList.add('hidden');
        assetGridContainer.classList.remove('hidden');
        renderGrid(currentFilteredAssets);
    } else {
        assetListTable.classList.remove('hidden');
        assetGridContainer.classList.add('hidden');
        renderTable(currentFilteredAssets);
    }
}

function renderTable(assets) {
    assetListBody.innerHTML = '';
    if (assets.length === 0) {
        assetListBody.innerHTML = `<tr><td colspan="${isSelfModal ? 3 : 2}" style="text-align: center; padding: 2rem;">Nenhum arquivo nesta categoria.</td></tr>`;
        return;
    }

    assets.forEach(doc => {
        const date = new Date(doc.createdAt).toLocaleDateString();
        const tr = document.createElement('tr');
        if (isSelfModal) {
            tr.innerHTML = `
                <td><strong>${doc.name}</strong></td>
                <td>${date}</td>
                <td>
                    <button class="secondary-btn btn-sm" onclick="downloadSharedAsset(${doc.id}, '${doc.name}')">Download</button>
                    <button class="secondary-btn btn-sm btn-danger" onclick="deleteSelfAsset(${doc.id})">Deletar</button>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td><strong>${doc.name}</strong></td>
                <td>
                    <button class="secondary-btn btn-sm" onclick="downloadSharedAsset(${doc.id}, '${doc.name}')">Download</button>
                </td>
            `;
        }
        assetListBody.appendChild(tr);
    });

    // Show/hide date col
    if (isSelfModal) assetThDate.classList.remove('hidden');
    else assetThDate.classList.add('hidden');
}

async function renderGrid(assets) {
    if (assets.length === 0) {
        assetGridContainer.innerHTML = `<div style="text-align: center; width: 100%; padding: 3rem; color: var(--text-secondary);">Nenhum arquivo nesta categoria.</div>`;
        return;
    }

    assetGridContainer.innerHTML = '';
    assets.forEach(async (doc, index) => {
        const card = document.createElement('div');
        card.className = 'asset-card';
        card.onclick = () => openPreview(index); // Pass index for navigation

        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-container';

        if (doc.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = `${AUTH_API}/api/documents/download/${doc.id}`;
            img.loading = 'lazy';
            thumb.appendChild(img);
        } else if (doc.type.startsWith('video/')) {
            const videoThumb = await createVideoThumbnail(`${AUTH_API}/api/documents/download/${doc.id}`);
            thumb.appendChild(videoThumb);
            const playIcon = document.createElement('div');
            playIcon.innerHTML = '▶';
            playIcon.style.cssText = 'position: absolute; color: white; font-size: 1.5rem; text-shadow: 0 0 10px rgba(0,0,0,0.5);';
            thumb.appendChild(playIcon);
        }

        // Deletion Red X for self
        if (isSelfModal) {
            const delBtn = document.createElement('div');
            delBtn.className = 'delete-badge';
            delBtn.innerHTML = '&times;';
            delBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent card click
                deleteSelfAsset(doc.id);
            };
            card.appendChild(delBtn);
        }

        const name = document.createElement('span');
        name.className = 'name';
        name.innerText = doc.name;

        card.appendChild(thumb);
        card.appendChild(name);
        assetGridContainer.appendChild(card);
    });
}

function createVideoThumbnail(url) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.currentTime = 0.5; // Seek a bit to avoid black screen

        video.onloadeddata = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 160;
            const ctx = canvas.getContext('2d');

            // Wait slightly for seek
            setTimeout(() => {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                resolve(canvas);
                video.src = ''; // Cleanup
            }, 200);
        };
        video.onerror = () => {
            const div = document.createElement('div');
            div.innerText = '🎬';
            div.style.fontSize = '2rem';
            resolve(div);
        };
    });
}

// --- Preview Logic ---

function openPreview(index) {
    currentIndex = index;
    const doc = currentFilteredAssets[currentIndex];
    if (!doc) return;

    previewContent.innerHTML = '';
    btnDownloadPreview.onclick = () => downloadSharedAsset(doc.id, doc.name);

    if (doc.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = `${AUTH_API}/api/documents/download/${doc.id}`;
        previewContent.appendChild(img);
    } else if (doc.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = `${AUTH_API}/api/documents/download/${doc.id}`;
        video.controls = true;
        video.autoplay = true;
        previewContent.appendChild(video);
    }

    previewModal.classList.remove('hidden');
}

function nextPreview() {
    if (currentFilteredAssets.length <= 1) return;
    currentIndex = (currentIndex + 1) % currentFilteredAssets.length;
    openPreview(currentIndex);
}

function prevPreview() {
    if (currentFilteredAssets.length <= 1) return;
    currentIndex = (currentIndex - 1 + currentFilteredAssets.length) % currentFilteredAssets.length;
    openPreview(currentIndex);
}

// Arrows
document.getElementById('next-preview').onclick = (e) => { e.stopPropagation(); nextPreview(); };
document.getElementById('prev-preview').onclick = (e) => { e.stopPropagation(); prevPreview(); };

// Keyboard support
document.addEventListener('keydown', (e) => {
    if (previewModal.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') nextPreview();
    if (e.key === 'ArrowLeft') prevPreview();
    if (e.key === 'Escape') closePreviewBtn.click();
});

closePreviewBtn.onclick = () => {
    previewModal.classList.add('hidden');
    previewContent.innerHTML = '';
};

previewModal.onclick = (e) => {
    if (e.target === previewModal) {
        previewModal.classList.add('hidden');
        previewContent.innerHTML = '';
    }
};

btnUploadAsset.onclick = () => selfAssetUploadInput.click();

selfAssetUploadInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate type
    const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/');

    if (!validTypes.includes(file.type) && !isMedia) {
        alert('Tipo de arquivo não suportado. Use PDF, Word, Imagens ou Vídeos.');
        return;
    }

    const formData = new FormData();
    formData.append('document', file);

    try {
        btnUploadAsset.disabled = true;
        btnUploadAsset.innerText = 'Enviando...';

        const response = await fetch(`${AUTH_API}/api/documents/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro no upload');

        loadSelfAssets();
    } catch (err) {
        alert('Erro ao enviar: ' + err.message);
    } finally {
        btnUploadAsset.disabled = false;
        btnUploadAsset.innerText = 'Upload File';
        selfAssetUploadInput.value = ''; // Reset
    }
};

window.deleteSelfAsset = async (id) => {
    if (!confirm('Tem certeza que deseja deletar este arquivo?')) return;

    try {
        const response = await fetch(`${AUTH_API}/api/documents/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Erro ao deletar');
        }

        loadSelfAssets();
    } catch (err) {
        alert('Erro ao deletar: ' + err.message);
    }
};

// Reset modal state when closing
if (closeAssetModalBtn) {
    closeAssetModalBtn.addEventListener('click', () => {
        assetModalOverlay.classList.add('hidden');
        if (btnUploadAsset) {
            btnUploadAsset.classList.add('hidden');
            btnUploadAsset.style.display = 'none';
        }
        assetThDate.classList.add('hidden');
        assetGridContainer.classList.add('hidden');
        assetListTable.classList.remove('hidden');
    });
}

// Close when clicking outside content
assetModalOverlay.addEventListener('click', (e) => {
    if (e.target === assetModalOverlay) {
        assetModalOverlay.classList.add('hidden');
    }
});

window.__worldBridge = {
    getAuthToken: () => authToken,
    getAuthApi: () => AUTH_API,
    getCourseId: () => COURSE_ID_FROM_URL,
    getPlayerRole: () => localUserRole,
    getCourseRoomLayoutMetrics,
    getCourseRoomPlacement,
    createModulePlacement,
    openModuleSidebar,
    renderCourseRoomShells,
    getActiveCourseRoomModuleId: () => activeCourseRoomModuleId,
    teleportTo(position) {
        if (!position) return;
        playerGroup.position.set(position.x, position.y ?? playerGroup.position.y, position.z);
        controls.target.set(position.x, 0, position.z);
        controls.update();
        if (socket) {
            socket.emit('playerMovement', {
                position: { x: playerGroup.position.x, y: playerGroup.position.y, z: playerGroup.position.z },
                rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
                animation: 'idle',
                isJumping: false,
                jumpAlpha: 0,
                didInteract: false,
                interactionPoint: null
            });
        }
    }
};
