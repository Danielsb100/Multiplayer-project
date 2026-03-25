import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Pathfinding } from 'three-pathfinding';

// Global variables for pathfinding
const _pathfinding = new Pathfinding();
const _navmeshZone = 'level1';
let localPlayerPath = null;

// --- 0. Socket & Login ---
let socket = null; 
let localUsername = '';
let authToken = '';
const loginScreen = document.getElementById('login-screen');
const joinBtn = document.getElementById('join-btn');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginError = document.getElementById('login-error');
const AUTH_API = 'https://login-system-production-84c6.up.railway.app';

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

// New Login GLB Elements
const loginGlbUpload = document.getElementById('login-glb-upload');
const loginFileName = document.getElementById('login-file-name');
let selectedModelBuffer = null;

// Advanced Cube Placement State
const PlacementState = { NONE: 0, BASE: 1, HEIGHT: 2 };
let currentPlacementState = PlacementState.NONE;
let placementStartPoint = new THREE.Vector3();
let placementBasePoint = new THREE.Vector3();
let previewCube = null;
let lastMouseY = 0;
const MAX_CUBE_HEIGHT = 8; 
console.log("GAME_LOADED: Version 1.2.6 - FIX_CONSTRUCTION_RACE");

let lastStateChangeTime = 0;
const STATE_CHANGE_DEBOUNCE = 300; // ms

// User Color Logic
const LOGIN_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff', '#94a3b8'];
let localUserColor = LOGIN_COLORS[Math.floor(Math.random() * LOGIN_COLORS.length)];
let interactionPointGlobal = null; 
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
const contextGlbUpload = document.getElementById('context-glb-upload');

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
const catalogCharBtn = document.getElementById('catalog-char-btn');
const menuCatalogModels = document.getElementById('menu-catalog-models');

// Fetch catalog data immediately via HTTP
fetch('/api/catalog')
    .then(res => res.json())
    .then(data => { catalogData = data; })
    .catch(err => console.error("Error fetching catalog:", err));

// --- Animation State ---
const playerAnims = {
    mixer: null,
    actions: {},
    currentState: null,
    currentAction: null
};
let playerState = 'idle'; 
let jumpVelocity = 0;
const GRAVITY = -0.01;
const JUMP_FORCE = 0.2;
let isGrounded = true;

// Parabolic Jump State
let isJumping = false;
let jumpTime = 0;
const JUMP_DURATION = 0.6; 
const JUMP_HEIGHT = 1.5;

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

function isOverUI(event) {
    return event.target.closest('.ui-layer') || event.target.closest('.context-menu');
}

loginGlbUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        loginFileName.innerText = file.name;
        const reader = new FileReader();
        reader.onload = (event) => {
            selectedModelBuffer = event.target.result;
        };
        reader.readAsArrayBuffer(file);
    }
});

joinBtn.addEventListener('click', async () => {
    if (socket && socket.connected) {
        console.warn("Socket already connected, skipping join logic.");
        return;
    }
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
        const response = await fetch('https://login-system-production-84c6.up.railway.app/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Login failed");
        }

        const token = result.token;
        authToken = token; // Store globally
        localUsername = result.user?.username || email.split('@')[0];

        // Initialize socket with the received token
        // @ts-ignore
        socket = io({
            auth: { token }
        });

        // Setup socket listeners
        setupSocketListeners();

        // Emit initial user data
        socket.emit('setName', { name: localUsername, color: localUserColor });
        
        if (selectedModelBuffer) {
            socket.emit('modelUpdate', { buffer: selectedModelBuffer });
            loadLocalModel(selectedModelBuffer);
        } else if (selectedCatalogModelUrl) {
            socket.emit('modelUpdate', { 
                path: selectedCatalogModelUrl,
                animations: selectedCatalogAnims 
            });
            loadModelByUrl(selectedCatalogModelUrl, selectedCatalogAnims);
        } else {
            // Try loading the default GLB character
            const defaultModelPath = 'assets/characters/default/default.glb';
            const defaultModelAnims = {
                idle: 'assets/characters/default/idle.glb',
                walk: 'assets/characters/default/walk.glb',
                jump: 'assets/characters/default/jump.glb',
                interact: 'assets/characters/default/interact.glb'
            };
            
            fetch(defaultModelPath, { method: 'HEAD' })
                .then(res => {
                    if (res.ok) {
                        socket.emit('modelUpdate', { 
                            path: defaultModelPath,
                            animations: defaultModelAnims 
                        });
                        loadModelByUrl(defaultModelPath, defaultModelAnims);
                    } else {
                        if (characterMesh && characterMesh.material) {
                            characterMesh.material.color.set(localUserColor);
                        }
                    }
                })
                .catch(() => {
                    if (characterMesh && characterMesh.material) {
                        characterMesh.material.color.set(localUserColor);
                    }
                });
        }

        playerGroup.visible = true;
        loginScreen.classList.add('hidden');
        createGametag(socket.id, localUsername, localUserColor, true);

        // Initialize PeerJS for audio calls
        initPeer();
        
        playerListContainer.classList.remove('hidden');
        updatePlayerList();

    } catch (err) {
        console.error("Login error:", err);
        loginError.innerText = err.message;
        loginError.classList.remove('hidden');
        joinBtn.disabled = false;
        joinBtn.innerText = "Entrar no Mundo";
    }
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
        alert('Conta criada com sucesso! Faça login para entrar.');
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
    socket.on('connect_error', (err) => {
        console.error("Socket connection error:", err.message);
        loginError.innerText = "Connection failed: " + err.message;
        loginError.classList.remove('hidden');
        
        // Show login screen again if connection was rejected
        loginScreen.classList.remove('hidden');
        playerGroup.visible = false;
        joinBtn.disabled = false;
        joinBtn.innerText = "Entrar no Mundo";
    });

    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id) return;
            addOtherPlayer(players[id]);
            if (players[id].peerId) peerIdToName[players[id].peerId] = players[id].name;
        });
        updatePlayerList();
    });

    socket.on('newPlayer', (playerInfo) => {
        addOtherPlayer(playerInfo);
        updatePlayerList();
    });

    socket.on('playerMoved', (playerInfo) => {
        if (remotePlayers[playerInfo.id]) {
            const p = remotePlayers[playerInfo.id];
            
            // Set targets instead of immediate position
            p.targetPosition.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
            p.targetRotation.set(
                playerInfo.rotation.x,
                playerInfo.rotation.y,
                playerInfo.rotation.z
            );

            if (playerInfo.animation && p.anims) {
                handleAnimationState(p.anims, playerInfo.animation);
            }

            if (remotePlayers[playerInfo.id].anims) {
                const rAnims = remotePlayers[playerInfo.id].anims;
                if (playerInfo.isJumping) {
                    if (rAnims.actions['jump']) {
                        rAnims.actions['jump'].setEffectiveWeight(playerInfo.jumpAlpha || 0);
                        rAnims.actions['jump'].play();
                    }
                } else {
                    if (rAnims.actions['jump']) {
                        if (rAnims.actions['jump'].isRunning()) rAnims.actions['jump'].fadeOut(0.2);
                    }
                }

                if (playerInfo.didInteract) {
                    triggerInteract(rAnims, playerInfo.interactionPoint);
                }
            }
        }
    });

    socket.on('playerUpdated', (playerInfo) => {
        createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false);
        if (remotePlayers[playerInfo.id]) {
            remotePlayers[playerInfo.id].name = playerInfo.name; // Keep name sync
            remotePlayers[playerInfo.id].color = playerInfo.color;
            if (remotePlayers[playerInfo.id].mainMesh) {
                applyCharacterColor(remotePlayers[playerInfo.id].mainMesh, playerInfo.color);
            }
        }
        updatePlayerList();
    });

    socket.on('playerDisconnected', (id) => {
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
        if (remotePlayers[data.id]) {
            const mData = data.modelData;
            if (mData) {
                if (mData.buffer) {
                    loadModelFromBuffer(mData.buffer, remotePlayers[data.id], data.color);
                } else if (mData.path) {
                    updateRemotePlayerModelByUrl(data.id, mData.path, mData.animations, data.color);
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
}

catalogCharBtn.addEventListener('click', () => {
    openCatalog('characters', (item) => {
        selectedCatalogModelUrl = item.model;
        selectedCatalogAnims = item.animations;
        selectedModelBuffer = null;
        loginFileName.innerText = item.name;
    });
});

closeCatalogBtn.addEventListener('click', () => catalogOverlay.classList.add('hidden'));

function renderCatalog(type, onSelect) {
    catalogGrid.innerHTML = '';
    
    if (type === 'characters') catalogTitle.innerText = 'Escolher Avatar';
    else if (type === 'structures') catalogTitle.innerText = 'Elementos de Estrutura';
    else catalogTitle.innerText = 'Catálogo de Objetos';
    
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
scene.background = new THREE.Color('#0f172a');
scene.fog = new THREE.FogExp2('#0f172a', 0.015);

const clock = new THREE.Clock(); // For animations

const frustumSize = 15;
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
    frustumSize * aspect / -2, frustumSize * aspect / 2,
    frustumSize / 2, frustumSize / -2, -100, 1000
);
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minZoom = 0.001; // Guard against scene disappearance
controls.target.set(0, 0, 0);
controls.enableRotate = false; // Keep isometric view

// --- Environment Map Loading ---
const mapLoader = new GLTFLoader();
mapLoader.load('assets/maps/map/map.glb', (gltf) => {
    const environmentMap = gltf.scene;
    scene.add(environmentMap);

    environmentMap.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const name = child.name ? child.name.toLowerCase() : '';
            
            // NavMesh Extraction
            if (name.includes('navmesh')) {
                child.visible = false;
                child.updateMatrixWorld(true);
                const geo = child.geometry.clone();
                geo.applyMatrix4(child.matrixWorld);
                _pathfinding.setZoneData(_navmeshZone, Pathfinding.createZone(geo));
                return; // Skip collision and render for navmesh
            }
            
            if (name.includes('collision')) {
                child.visible = false;
            } else if (name.includes('wall')) {
                // Important for Occlusion Logic (makes walls transparent)
                child.userData.isStructure = true; 
                // Clone material so fading one wall doesn't fade all walls sharing the same material
                if (child.material) {
                    child.material = child.material.clone();
                    child.material.transparent = true;
                }
            }
            
            // ALL map geometry is now used for precise physical collisions
            child.userData.id = 'env_mesh_' + child.uuid;
            preciseColliders.push(child);
        }
    });
    console.log("Environment map loaded successfully.");
}, undefined, (error) => {
    console.warn("Notice: No default map found or error loading map.glb");
});

// --- Animation Manager ---
function applyCharacterColor(model, color) {
    if (!model) return;
    model.traverse((child) => {
        if (child.isMesh) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.name && mat.name.toLowerCase().includes('clothes')) {
                    if (mat.color) mat.color.set(color);
                }
            });
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

function createGametag(id, name, color, isLocal) {
    if (gametags[id]) {
        gametags[id].element.innerText = name;
        if (color) gametags[id].element.style.color = color;
        return;
    }
    const element = document.createElement('div');
    element.className = 'gametag';
    element.innerHTML = `<span>${name}</span>`;
    
    if (!isLocal) {
        const callBtn = document.createElement('button');
        callBtn.innerText = '📞';
        callBtn.className = 'gametag-call-btn';
        callBtn.style.marginLeft = '8px';
        callBtn.style.background = 'none';
        callBtn.style.border = 'none';
        callBtn.style.cursor = 'pointer';
        callBtn.onclick = (e) => {
            e.stopPropagation();
            const player = remotePlayers[id];
            if (player && player.peerId) {
                makeCall(player.peerId, name);
            } else {
                alert('Jogador ainda não configurou canal de voz.');
            }
        };
        element.appendChild(callBtn);
    }

    if (color) element.style.color = color;
    document.body.appendChild(element);
    gametags[id] = { element, isLocal, color };
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
        <span class="is-me">VOCÊ</span>
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
        let name = player.name || 'Desconhecido';
        
        // Final fallback: if state name is Guest or Desconhecido, check gametag
        if ((!player.name || player.name.includes('Guest')) && gametags[id]) {
            const tagText = gametags[id].element.innerText.replace('📞', '').replace('(sem voz)', '').trim();
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
            ${!player.peerId ? '<span style="font-size: 0.7rem; color: #94a3b8; margin-left: 5px;">(sem voz)</span>' : ''}
        `;
        
        infoDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedPlayerPeerId = player.peerId; // Track peerId for the menu
            showPlayerActionMenu(name, e);
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
        tempV.y += 2.5; // Above head
        tempV.project(camera);
        const x = (tempV.x *  .5 + .5) * window.innerWidth;
        const y = (tempV.y * -.5 + .5) * window.innerHeight;
        gametags[socket.id].element.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;
        gametags[socket.id].element.style.display = 'block';
    }

    // Update remotes
    for (const id in remotePlayers) {
        if (gametags[id]) {
            remotePlayers[id].group.getWorldPosition(tempV);
            tempV.y += 2.5;
            tempV.project(camera);
            const x = (tempV.x *  .5 + .5) * window.innerWidth;
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
function syncChatHistory(history) {}

function addOtherPlayer(playerInfo) {
    // Anchor group: holds only network position/rotation — never touched visually
    const anchorGroup = new THREE.Group();
    anchorGroup.position.set(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z);
    anchorGroup.rotation.set(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z);
    scene.add(anchorGroup);

    // Avatar container: child of anchor — all visual mesh loading/centering goes here
    const avatarContainer = new THREE.Group();
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
    
    createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false);

    if (playerInfo.modelData) {
        if (playerInfo.modelData.buffer) {
            loadModelFromBuffer(playerInfo.modelData.buffer, remotePlayers[playerInfo.id], playerInfo.color);
        } else if (playerInfo.modelData.path) {
            updateRemotePlayerModelByUrl(playerInfo.id, playerInfo.modelData.path, playerInfo.modelData.animations, playerInfo.color);
        }
    } else {
        // Try loading default model for remote player if no specific model selected
        const defaultModelPath = 'assets/characters/default/default.glb';
        fetch(defaultModelPath, { method: 'HEAD' }).then(res => {
            if (res.ok) {
                const defaultModelAnims = {
                    idle: 'assets/characters/default/idle.glb',
                    walk: 'assets/characters/default/walk.glb',
                    jump: 'assets/characters/default/jump.glb',
                    interact: 'assets/characters/default/interact.glb'
                };
                updateRemotePlayerModelByUrl(playerInfo.id, defaultModelPath, defaultModelAnims, playerInfo.color);
            }
        });
    }
}

function loadModelFromBuffer(arrayBuffer, targetPlayerObj, color = '#3b82f6') {
    const gltfLoader = new GLTFLoader();
    gltfLoader.parse(arrayBuffer, '', (gltf) => {
        // Clear previous meshes inside the inner group
        while(targetPlayerObj.avatarContainer.children.length > 0){ 
            targetPlayerObj.avatarContainer.remove(targetPlayerObj.avatarContainer.children[0]); 
        }

        const newModel = gltf.scene;
        newModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Center BEFORE parenting so Box3 is in local (model) space, not world space
        newModel.position.set(0, 0, 0);
        newModel.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(newModel);
        const center = box.getCenter(new THREE.Vector3());
        newModel.position.x = -center.x;
        newModel.position.z = -center.z;
        newModel.position.y = -box.min.y;

        targetPlayerObj.avatarContainer.add(newModel);
        targetPlayerObj.mainMesh = newModel;
        
        // Apply character color to 'clothes' material
        applyCharacterColor(newModel, color);

        // Setup Mixer for remote player with buffer model
        targetPlayerObj.anims.mixer = new THREE.AnimationMixer(newModel);
        targetPlayerObj.anims.actions = {};
        targetPlayerObj.anims.currentState = null;

        if (gltf.animations && gltf.animations.length > 0) {
            const states = ['idle', 'walk', 'jump', 'interact'];
            gltf.animations.forEach(clip => {
                const lowerName = clip.name.toLowerCase();
                states.forEach(state => {
                    if (lowerName.includes(state)) {
                        targetPlayerObj.anims.actions[state] = targetPlayerObj.anims.mixer.clipAction(clip);
                        if (state === 'idle') handleAnimationState(targetPlayerObj.anims, 'idle');
                    }
                });
            });
        }
    }, (error) => {
        console.error('Error parsing remote model', error);
    });
}

// --- Input Handling ---
const keys = { w: false, a: false, s: false, d: false, ' ': false, e: false };
const chatInput = document.getElementById('chat-input');
const chatHistory = document.getElementById('chat-history');

window.addEventListener('keydown', (e) => {
    if (document.activeElement === emailInput || document.activeElement === passwordInput) return;
    if (document.activeElement === chatInput) {
        if (e.key === 'Enter') {
            const msg = chatInput.value.trim();
            if (msg) {
                socket.emit('chatMessage', msg);
                chatInput.value = '';
            }
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
    
    // Jump trigger (Parabolic)
    if (e.code === 'Space' && !isJumping) {
        keys[' '] = true;
        isJumping = true;
        jumpTime = 0;
        // Start jump animation at 0 weight (it will be modulated in updatePlayer)
        if (playerAnims.actions['jump']) {
            playerAnims.actions['jump'].reset().setEffectiveWeight(0).play();
        }
    }
    
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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
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

const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

const planeGeometry = new THREE.PlaneGeometry(200, 200);
const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.4 });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
plane.name = "ground";
scene.add(plane);

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

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
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

            // Ground name check must be exact OR an environment mesh
            const isEnv = contextMenuTarget.userData && contextMenuTarget.userData.id && contextMenuTarget.userData.id.toString().includes('env_');
            if (contextMenuTarget.name === "ground" || (contextMenuTarget.object && contextMenuTarget.object.name === "ground") || isEnv) {
                menuGroundSection.classList.remove('hidden');
            } else if (contextMenuTarget.userData && contextMenuTarget.userData.id) {
                const id = contextMenuTarget.userData.id.toString().toLowerCase();
                if (id.includes('cube')) {
                    menuCubeSection.classList.remove('hidden');
                } else if (id.includes('model') || id.includes('struct')) {
                    menuModelSection.classList.remove('hidden');
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
document.getElementById('menu-import-glb').addEventListener('click', () => {
    contextGlbUpload.click();
    closeContextMenu();
});
contextGlbUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const buffer = event.target.result;
            if (socket) {
                socket.emit('placeModel', {
                    modelBuffer: buffer,
                    position: contextMenuPoint.clone()
                });
            }
            // Object will appear when server confirms via 'modelAdded'
            triggerInteract(playerAnims, contextMenuPoint);
            didInteractThisFrame = true;
        };
        reader.readAsArrayBuffer(file);
        e.target.value = ''; // Reset input to allow re-importing same file
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
        alert("Não é possível girar: Espaço ocupado!");
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

window.addEventListener('mousedown', (event) => {
    if (localUsername === '' || document.activeElement === chatInput || isMenuOpen || isOverUI(event)) return;
    
    // Feature: Cancel with RIGHT click immediately
    if (event.button === 2 && currentPlacementState !== PlacementState.NONE) {
        cancelPlacement();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }

    if (event.button !== 0) return; // Only left-click

    try {
        console.log("Mousedown - Button:", event.button, "State:", currentPlacementState);
        if (currentPlacementState === PlacementState.NONE) {
            // --- Pathfinding Interaction ---
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            
            const intersects = raycaster.intersectObjects(scene.children, true);
            if (intersects.length > 0) {
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
                if (hitPoint) {
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
                        localPlayerPath = (path && path.length > 0) ? path : [hitPoint];
                    } catch(e) {
                        console.error("Pathfinding error:", e);
                        localPlayerPath = [hitPoint];
                    }
                }
            }
        } else if (currentPlacementState === PlacementState.HEIGHT) {
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
    if (isOverUI(event)) return;
    if (Date.now() - lastStateChangeTime < STATE_CHANGE_DEBOUNCE) return;

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

    // --- 3D Cursor Projection ---
    if (currentPlacementState === PlacementState.NONE) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
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
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
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
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
});

// --- Movement Logic ---
let moveSpeed = 0.05; 
let currentSurfaceHeight = 0;
let autoWalkStuckTimer = 0;
const lastStoredPosition = new THREE.Vector3();

function checkCollision(targetPosition) {
    // COMPACT COLLISION: Use a fixed small box for the player (0.4 units wide)
    const playerBoxSize = new THREE.Vector3(0.4, 1.8, 0.4);
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
    
    // Smooth step-up or gravity
    if (!isJumping) {
        // If we are on a platform, snap to it or fall towards it
        if (playerGroup.position.y < targetSurface) {
            playerGroup.position.y = targetSurface; // Instant step-up for now
        } else if (playerGroup.position.y > targetSurface) {
            playerGroup.position.y = Math.max(targetSurface, playerGroup.position.y - 0.1); // Gravity fall
        }
        currentSurfaceHeight = targetSurface;
    }

    // --- Parabolic Jump Handling ---
    if (isJumping) {
        jumpTime += delta;
        let progress = Math.min(jumpTime / JUMP_DURATION, 1);
        let parabola = Math.sin(progress * Math.PI);
        
        // Jump starts relative to the surface height at the start of the jump
        playerGroup.position.y = currentSurfaceHeight + (parabola * JUMP_HEIGHT);
        
        // Modulate animation weight
        if (playerAnims.actions['jump']) {
            playerAnims.actions['jump'].setEffectiveWeight(parabola);
        }
        
        if (progress >= 1) {
            isJumping = false;
            playerGroup.position.y = targetSurface; // Land on current surface
            currentSurfaceHeight = targetSurface;
            if (playerAnims.actions['jump']) {
                playerAnims.actions['jump'].fadeOut(0.2);
            }
        }
        
        // CRITICAL: Emit even if not moving horizontally during jump
        broadcastMovement();
    }

    // --- Manual input interrupts auto-walk ---
    if (keys.w || keys.a || keys.s || keys.d) {
        localPlayerPath = null;
    }

    let moveX = 0, moveZ = 0;
    
    // Pathfinding logic override
    if (localPlayerPath && localPlayerPath.length > 0) {
        const targetPoint = localPlayerPath[0];
        const dir = new THREE.Vector3().subVectors(targetPoint, playerGroup.position);
        dir.y = 0; // Move ONLY on XZ plane
        
        const dist = dir.length();
        if (dist < 0.1) {
            // Reached waypoint
            localPlayerPath.shift();
            if (localPlayerPath.length === 0) localPlayerPath = null;
        } else {
            dir.normalize();
            moveX = dir.x * moveSpeed;
            moveZ = dir.z * moveSpeed;
            
            // Stuck detection (dynamic objects blocking navmesh path)
            if (lastStoredPosition.distanceToSquared(playerGroup.position) < 0.0001) {
                autoWalkStuckTimer += delta;
                if (autoWalkStuckTimer > 0.5) { 
                    localPlayerPath = null;
                    autoWalkStuckTimer = 0;
                }
            } else {
                autoWalkStuckTimer = 0;
                lastStoredPosition.copy(playerGroup.position);
            }
        }
    } else {
        // Traditional WASD
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
        handleAnimationState(playerAnims, 'walk');
        const targetPos = playerGroup.position.clone();
        targetPos.x += moveX;
        targetPos.z += moveZ;

        if (!checkCollision(targetPos)) {
            playerGroup.position.copy(targetPos);
        } else {
            const targetPosX = playerGroup.position.clone(); targetPosX.x += moveX;
            if (!checkCollision(targetPosX)) playerGroup.position.copy(targetPosX);
            else {
                const targetPosZ = playerGroup.position.clone(); targetPosZ.z += moveZ;
                if (!checkCollision(targetPosZ)) playerGroup.position.copy(targetPosZ);
            }
        }
        playerGroup.rotation.y = Math.atan2(moveX, moveZ);
        broadcastMovement();
    } else {
        handleAnimationState(playerAnims, 'idle');
        broadcastMovement();
    }
    
    // Camera follow logic (moved back inside updatePlayer)
    const cameraOffset = new THREE.Vector3(20, 20, 20);
    const targetCamPos = playerGroup.position.clone().add(cameraOffset);
    camera.position.lerp(targetCamPos, 0.1);
    controls.target.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z);
}

let lastBroadcastTime = 0;
const BROADCAST_INTERVAL = 1000 / 20; // 20Hz

function broadcastMovement() {
    if (!socket) return;
    const now = Date.now();
    if (now - lastBroadcastTime < BROADCAST_INTERVAL) return;
    lastBroadcastTime = now;

    if (socket) {
        socket.emit('playerMovement', {
            position: playerGroup.position,
            rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
            animation: playerAnims.currentState,
            isJumping: isJumping,
            jumpAlpha: isJumping ? Math.sin((jumpTime / JUMP_DURATION) * Math.PI) : 0,
            didInteract: didInteractThisFrame,
            interactionPoint: interactionPointGlobal
        });
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
                        child.material.transparent = true;
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

        updatePlayer(delta);
        updateOcclusion();
        updateGametags();
        
        if (controls) {
            controls.update();
            camera.updateProjectionMatrix(); // Ensure zoom is reflected to prevent disappearance
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
}

function loadLocalModel(arrayBuffer) {
    loadingIndicator.classList.remove('hidden');
    const gltfLoader = new GLTFLoader();
    gltfLoader.parse(arrayBuffer, '', (gltf) => {
        while(playerGroup.children.length > 0) playerGroup.remove(playerGroup.children[0]);

        characterMesh = gltf.scene;
        characterMesh.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
        
        // Apply local character color to 'clothes' material
        applyCharacterColor(characterMesh, localUserColor);

        // Center BEFORE parenting so Box3 is in local (model) space, not world space
        characterMesh.position.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(characterMesh);
        const center = box.getCenter(new THREE.Vector3());
        characterMesh.position.x = -center.x;
        characterMesh.position.z = -center.z;
        characterMesh.position.y = -box.min.y;

        playerGroup.add(characterMesh);

        // Setup Mixer for local player with buffer model
        playerAnims.mixer = new THREE.AnimationMixer(characterMesh);
        playerAnims.actions = {};
        playerAnims.currentState = null;

        if (gltf.animations && gltf.animations.length > 0) {
            const states = ['idle', 'walk', 'jump', 'interact'];
            gltf.animations.forEach(clip => {
                const lowerName = clip.name.toLowerCase();
                states.forEach(state => {
                    if (lowerName.includes(state)) {
                        playerAnims.actions[state] = playerAnims.mixer.clipAction(clip);
                        if (state === 'idle') handleAnimationState(playerAnims, 'idle');
                    }
                });
            });
        }

        loadingIndicator.classList.add('hidden');
    }, (error) => {
        console.error('Error parsing local model', error);
        loadingIndicator.classList.add('hidden');
    });
}

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
            cube.scale.lerpVectors(new THREE.Vector3(0,0,0), targetScale, alpha);
            if (alpha >= 1) {
                cube.scale.copy(targetScale);
                clearInterval(intr);
            }
        }, 16);
    });
}

function loadModelByUrl(url, animPaths = null) {
    loadingIndicator.classList.remove('hidden');
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(url, (gltf) => {
        while(playerGroup.children.length > 0) playerGroup.remove(playerGroup.children[0]);

        characterMesh = gltf.scene;
        characterMesh.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });

        // Apply character color to 'clothes' material
        applyCharacterColor(characterMesh, localUserColor);

        // Center BEFORE parenting so Box3 is in local (model) space, not world space
        characterMesh.position.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(characterMesh);
        const center = box.getCenter(new THREE.Vector3());
        characterMesh.position.x = -center.x;
        characterMesh.position.z = -center.z;
        characterMesh.position.y = -box.min.y;

        playerGroup.add(characterMesh);

        // Setup Mixer
        playerAnims.mixer = new THREE.AnimationMixer(characterMesh);
        playerAnims.actions = {};
        playerAnims.currentState = null;

        // 1. Auto-detect embedded animations (actions from Blender)
        if (gltf.animations && gltf.animations.length > 0) {
            const states = ['idle', 'walk', 'jump', 'interact'];
            gltf.animations.forEach(clip => {
                const lowerName = clip.name.toLowerCase();
                states.forEach(state => {
                    if (lowerName.includes(state)) {
                        playerAnims.actions[state] = playerAnims.mixer.clipAction(clip);
                        if (state === 'idle') handleAnimationState(playerAnims, 'idle');
                    }
                });
            });
        }

        // 2. Load external animations (as overrides if provided)
        if (animPaths) {
            Object.entries(animPaths).forEach(([name, path]) => {
                gltfLoader.load(path, (animGltf) => {
                    const clip = animGltf.animations[0];
                    if (clip) {
                        const action = playerAnims.mixer.clipAction(clip);
                        playerAnims.actions[name] = action;
                        if (name === 'idle') handleAnimationState(playerAnims, 'idle');
                    }
                });
            });
        }

        loadingIndicator.classList.add('hidden');
    });
}

function updateRemotePlayerModelByUrl(id, url, animPaths = null, color = '#3b82f6') {
    const player = remotePlayers[id];
    if (!player) return;
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(url, (gltf) => {
        // Use avatarContainer (visual child) — NOT group (network anchor)
        const container = player.avatarContainer || player.group;
        while(container.children.length > 0) container.remove(container.children[0]);
        const mesh = gltf.scene;
        mesh.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });

        // Center BEFORE parenting so Box3 is in local (model) space, not world space
        mesh.position.set(0, 0, 0);
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        mesh.position.x = -center.x;
        mesh.position.z = -center.z;
        mesh.position.y = -box.min.y;

        container.add(mesh);
        
        // Apply character color to 'clothes' material
        applyCharacterColor(mesh, color);

        // Setup Mixer for remote
        player.anims.mixer = new THREE.AnimationMixer(mesh);
        player.anims.actions = {};
        player.anims.currentState = null;

        // 1. Embedded Animations
        if (gltf.animations && gltf.animations.length > 0) {
            const states = ['idle', 'walk', 'jump', 'interact'];
            gltf.animations.forEach(clip => {
                const lowerName = clip.name.toLowerCase();
                states.forEach(state => {
                    if (lowerName.includes(state)) {
                        player.anims.actions[state] = player.anims.mixer.clipAction(clip);
                        if (state === 'idle') handleAnimationState(player.anims, 'idle');
                    }
                });
            });
        }

        // 2. External Animations
        if (animPaths) {
            Object.entries(animPaths).forEach(([name, path]) => {
                gltfLoader.load(path, (animGltf) => {
                    const clip = animGltf.animations[0];
                    if (clip) {
                        player.anims.actions[name] = player.anims.mixer.clipAction(clip);
                        if (name === 'idle') handleAnimationState(player.anims, 'idle');
                    }
                });
            });
        }
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
        console.warn('Camera failed, falling back to audio only:', err);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            console.log('Microphone Ready (Audio Only)');
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

        const callerName = peerIdToName[call.peer] || 'Desconhecido';
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
    if (!localStream) return alert('Microfone não detectado.');

    callingName.innerText = name;
    audioCallLayer.classList.remove('hidden');

    currentCall = peer.call(targetPeerId, localStream);
    setupCallListeners(currentCall);
    startTimer();
}

function answerCall(call) {
    currentCall = call;
    currentCall.answer(localStream);
    callingName.innerText = call.peer;
    audioCallLayer.classList.remove('hidden');

    setupCallListeners(currentCall);
    startTimer();
}

function setupCallListeners(call) {
    call.on('stream', (remoteStream) => {
        const hasVideo = remoteStream.getVideoTracks().length > 0;
        
        if (hasVideo) {
            videoContainer.classList.remove('hidden');
            remoteVideo.srcObject = remoteStream;
            remoteVideo.play();
        } else {
            videoContainer.classList.add('hidden');
        }

        remoteAudio.srcObject = remoteStream;
        setupVisualizer(remoteStream);
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
    clearInterval(callDurationInterval);
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
    const videoTrack = localStream.getVideoTracks()[0];
    
    if (!videoTrack) {
        // Try to get video if we didn't have it
        try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newTrack = tempStream.getVideoTracks()[0];
            localStream.addTrack(newTrack);
            localVideo.srcObject = localStream;
            btnCamera.classList.add('active');
            videoContainer.classList.remove('hidden');
            
            // If in a call, we need to replace the track or restart the stream
            if (currentCall && currentCall.peerConnection) {
                const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(newTrack);
                else currentCall.peerConnection.addTrack(newTrack, localStream);
            }
        } catch (err) {
            alert('Não foi possível acessar a câmera.');
        }
    } else {
        const enabled = videoTrack.enabled;
        videoTrack.enabled = !enabled;
        btnCamera.classList.toggle('active', !enabled);
        videoContainer.classList.toggle('hidden', enabled);
        
        if (enabled) {
            localVideo.pause();
        } else {
            localVideo.play();
        }
    }
};

// --- Player Interaction Menu & Asset Modal ---

function showPlayerActionMenu(username, event) {
    selectedPlayerForAction = username;
    actionMenuName.innerText = username;
    
    playerActionMenu.style.left = event.clientX + 'px';
    playerActionMenu.style.top = event.clientY + 'px';
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
        alert('Este jogador ainda não configurou o canal de voz.');
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
    assetListBody.innerHTML = '<tr><td colspan="2">Carregando assets...</td></tr>';
    assetGridContainer.innerHTML = 'Carregando...';
    assetModalOverlay.classList.remove('hidden');
    if (btnUploadAsset) {
        btnUploadAsset.classList.add('hidden'); // Hide upload button for other users
        btnUploadAsset.style.display = 'none'; // Ensure it's hidden
    }

    try {
        const response = await fetch(`${AUTH_API}/api/documents/user/${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error('Não foi possível carregar os arquivos.');
        
        const data = await response.json();
        currentLoadedAssets = data.documents || []; // Use currentLoadedAssets

        if (currentLoadedAssets.length === 0) {
            assetListBody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px;">Nenhum arquivo compartilhado.</td></tr>';
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
    modalUsernameSpan.innerText = `${localUsername} (Meu Perfil)`;
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
