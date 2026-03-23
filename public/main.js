import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Pathfinding } from 'three-pathfinding';

// Global variables for pathfinding
const _pathfinding = new Pathfinding();
const _navmeshZone = 'level1';
let localPlayerPath = null;// --- 0. Socket & Login ---
const socket = io();
let localUsername = '';
const loginScreen = document.getElementById('login-screen');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');

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
const MAX_CUBE_HEIGHT = 8; // Height limit as requested

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
let catalogData = { characters: [], models: [] };
let selectedCatalogModelUrl = null;
let selectedCatalogAnims = null; // New
const catalogOverlay = document.getElementById('catalog-overlay');
const catalogGrid = document.getElementById('catalog-grid');
const catalogTitle = document.getElementById('catalog-title');
const closeCatalogBtn = document.getElementById('close-catalog');
const catalogCharBtn = document.getElementById('catalog-char-btn');
const menuCatalogModels = document.getElementById('menu-catalog-models');

// --- Animation State ---
const playerAnims = {
    mixer: null,
    actions: {},
    currentState: null,
    currentAction: null
};
let playerState = 'idle'; // idle, walk, jump, interact
let jumpVelocity = 0;
const GRAVITY = -0.01;
const JUMP_FORCE = 0.2;
let isGrounded = true;

// Parabolic Jump State
let isJumping = false;
let jumpTime = 0;
const JUMP_DURATION = 0.6; // Seconds
const JUMP_HEIGHT = 1.5;

// PeerJS & Audio State
let peer = null;
let localStream = null;
let currentCall = null;
const peerIdToName = {}; // Map peerId -> name
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
const btnHangup = document.getElementById('btn-hangup');
const btnAnswer = document.getElementById('btn-answer');
const btnReject = document.getElementById('btn-reject');

// Player List DOM
const playerListContainer = document.getElementById('player-list-container');
const playerListContent = document.getElementById('player-list-content');

function isOverUI(event) {
    return event.target.closest('.ui-layer') || event.target.closest('.context-menu');
}

socket.on('catalogData', (data) => {
    catalogData = data;
});

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

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        localUsername = name;
        socket.emit('setName', { name, color: localUserColor });
        
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
            
            // Check if it exists via a fetch (simplified check)
            fetch(defaultModelPath, { method: 'HEAD' })
                .then(res => {
                    if (res.ok) {
                        socket.emit('modelUpdate', { 
                            path: defaultModelPath,
                            animations: defaultModelAnims 
                        });
                        loadModelByUrl(defaultModelPath, defaultModelAnims);
                    } else {
                        // Fallback to cube if default.glb is not found
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
        createGametag(socket.id, name, localUserColor, true);

        // Initialize PeerJS for audio calls
        initPeer();
        
        playerListContainer.classList.remove('hidden');
        updatePlayerList();
    }
});

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
        div.onclick = () => {
            onSelect(item); // Pass full item instead of just model URL
            catalogOverlay.classList.add('hidden');
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
    meDiv.innerHTML = `
        <div class="player-info">
            <div class="player-status-dot"></div>
            <span class="player-name">${localUsername}</span>
            <span class="is-me">VOCÊ</span>
        </div>
    `;
    playerListContent.appendChild(meDiv);

    // 2. Add Others
    for (const id in remotePlayers) {
        const player = remotePlayers[id];
        const name = gametags[id] ? (gametags[id].element.innerText.replace('📞', '').trim()) : 'Carregando...';
        
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'player-info';
        infoDiv.innerHTML = `
            <div class="player-status-dot"></div>
            <span class="player-name">${name}</span>
        `;
        
        const callBtn = document.createElement('button');
        callBtn.className = 'call-icon-btn';
        callBtn.innerHTML = '📞';
        
        if (!player.peerId) {
            callBtn.classList.add('disabled');
            callBtn.title = 'Voz não disponível';
        }

        callBtn.onclick = () => {
            if (player.peerId) {
                makeCall(player.peerId, name);
            } else {
                alert('Este jogador ainda não configurou o canal de voz.');
            }
        };

        playerDiv.appendChild(infoDiv);
        playerDiv.appendChild(callBtn);
        playerListContent.appendChild(playerDiv);
    }
}

// Update gametags screen positions
function updateGametags() {
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
        // Copy full position (x, y, z) to the anchor group — Y is always replicated
        remotePlayers[playerInfo.id].group.position.copy(playerInfo.position);
        remotePlayers[playerInfo.id].group.rotation.set(
            playerInfo.rotation.x,
            playerInfo.rotation.y,
            playerInfo.rotation.z
        );

        // Update remote base animation
        if (playerInfo.animation && remotePlayers[playerInfo.id].anims) {
            handleAnimationState(remotePlayers[playerInfo.id].anims, playerInfo.animation);
        }

        // Handle remote jump/interact overlays
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

let didInteractThisFrame = false; // New flag

socket.on('playerUpdated', (playerInfo) => {
    createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false);
    if (remotePlayers[playerInfo.id]) {
        if (remotePlayers[playerInfo.id].mainMesh) {
            // Apply color to material if it's the default cube or has 'clothes' material
            if (remotePlayers[playerInfo.id].mainMesh.material) {
                remotePlayers[playerInfo.id].mainMesh.material.color.set(playerInfo.color);
            }
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
        console.log(`Remote player ${data.id} has PeerID: ${data.peerId}`);
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

socket.on('objectDeleted', (id) => {
    // 1. Remove from scene using ID-to-UUID map
    const uuid = idToUuid[id];
    if (uuid) {
        const obj = scene.getObjectByProperty('uuid', uuid);
        if (obj) scene.remove(obj);
    }
    
    // 2. THOROUGH cleanup: remove the specific box from collisions
    for (let i = wallBoxes.length - 1; i >= 0; i--) {
        if (wallBoxes[i].relatedId == id) wallBoxes.splice(i, 1);
    }

    // 3. Cleanup preciseColliders
    for (let i = preciseColliders.length - 1; i >= 0; i--) {
        if (preciseColliders[i].userData && preciseColliders[i].userData.id == id) {
            preciseColliders.splice(i, 1);
        }
    }
    
    // 4. Clean up the mapping
    delete idToUuid[id];
});

socket.on('objectUpdated', (data) => {
    const obj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
    if (obj) {
        if (data.color) {
            // Support both cubes (simple mat) and models (traversal)
            if (obj.material) {
                obj.material.color.set(data.color);
            } else {
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
            
            // Sync wallBoxes for the remote object too
            for (const box of wallBoxes) {
                if (box.relatedId == data.id) {
                    box.setFromObject(obj);
                }
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
        group: anchorGroup,          // anchor: use this for position/rotation from network
        avatarContainer: avatarContainer, // visual container: use this for model loading
        mainMesh: avatar.bodyMesh,
        color: playerInfo.color,
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
    if (document.activeElement === usernameInput) return;
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
    if (document.activeElement === usernameInput || document.activeElement === chatInput) return;
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
    currentPlacementState = PlacementState.BASE;
    placementStartPoint.copy(contextMenuPoint);
    
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: localUserColor, transparent: true, opacity: 0.5 });
    previewCube = new THREE.Mesh(geo, mat);
    previewCube.position.set(placementStartPoint.x, 0.5, placementStartPoint.z);
    scene.add(previewCube);
    
    closeContextMenu();
});

document.getElementById('menu-catalog-models').addEventListener('click', () => {
    openCatalog('models', (item) => {
        socket.emit('placeModel', {
            modelPath: item.model,
            position: contextMenuPoint.clone(),
            isStructure: false
        });
        
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
        socket.emit('placeModel', {
            modelPath: item.model,
            position: contextMenuPoint.clone(),
            isStructure: true
        });
        
        triggerInteract(playerAnims, contextMenuPoint);
        didInteractThisFrame = true;
        // Object will appear when server confirms via 'modelAdded'
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
            socket.emit('placeModel', {
                modelBuffer: buffer,
                position: contextMenuPoint.clone()
            });
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
    if (contextMenuTarget && contextMenuTarget.userData.id) {
        socket.emit('deleteObject', contextMenuTarget.userData.id);
    }
    closeContextMenu();
});

document.getElementById('menu-delete-model').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.id) {
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
    
    socket.emit('updateObjectRotation', {
        id: target.userData.id,
        rotation: { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }
    });
}

document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
        if (contextMenuTarget && contextMenuTarget.userData.id) {
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
    if (event.button !== 0) return; // Only left click

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
                    let groupID = _pathfinding.getGroup(_navmeshZone, startPos);
                    if (groupID === null) groupID = _pathfinding.getGroup(_navmeshZone, hitPoint);
                    if (groupID === null) groupID = 0; // Fallback to main island

                    const closestStart = _pathfinding.getClosestNode(startPos, _navmeshZone, groupID);
                    const closestEnd = _pathfinding.getClosestNode(hitPoint, _navmeshZone, groupID);

                    if (closestStart && closestEnd) {
                        const path = _pathfinding.findPath(closestStart.centroid, closestEnd.centroid, _navmeshZone, groupID);
                        if (path && path.length > 0) {
                            // Force exact end position instead of snapping to centroid
                            path[path.length - 1] = hitPoint.clone();

                            // Remove the starting centroid to avoid walking backwards slightly
                            if (path.length > 1) {
                                path.shift(); 
                            }

                            localPlayerPath = path;
                        } else { 
                            localPlayerPath = [hitPoint];
                        }
                    } else {
                        localPlayerPath = [hitPoint];
                    }
                } catch(e) {
                    console.error("Pathfinding error:", e);
                    localPlayerPath = [hitPoint];
                }
            }
        }
    } else if (currentPlacementState === PlacementState.HEIGHT) {
        // Phase 3: Finalize
        const previewBox = new THREE.Box3().setFromObject(previewCube);
        // Important: Ignore previewCube itself during this check to avoid self-collision
        if (checkGeneralCollision(previewBox, true)) {
            alert("Cannot place cube here: Position occupied by player or object!");
            cancelPlacement();
        } else {
            const size = {
                w: Math.abs(previewCube.scale.x),
                h: Math.abs(previewCube.scale.y),
                d: Math.abs(previewCube.scale.z)
            };
            const pos = previewCube.position.clone();

            socket.emit('placeCube', {
                position: pos,
                size: size,
                color: localUserColor
            });
            // Cube will appear when server confirms via 'cubeAdded'
            
            // Trigger interact animation
            triggerInteract(playerAnims, contextMenuPoint);
            didInteractThisFrame = true;
            interactionPointGlobal = contextMenuPoint.clone();
            
            cancelPlacement();
        }
    }
});

window.addEventListener('mouseup', (event) => {
    if (currentPlacementState === PlacementState.BASE) {
        // Phase 2: Start Height Definition
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
    if (previewCube) {
        scene.remove(previewCube);
        previewCube = null;
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
});

// --- Movement Logic ---
let moveSpeed = 0.05; 
let currentSurfaceHeight = 0;

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

function broadcastMovement() {
    socket.emit('playerMovement', {
        position: playerGroup.position,
        rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
        animation: playerAnims.currentState,
        isJumping: isJumping,
        jumpAlpha: isJumping ? Math.sin((jumpTime / JUMP_DURATION) * Math.PI) : 0,
        didInteract: didInteractThisFrame,
        interactionPoint: interactionPointGlobal
    });
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
    const delta = clock.getDelta();
    
    // CRITICAL: Update ALL world matrices FIRST, before any collision/game logic.
    // renderer.render() would do this later, but checkCollision and getSurfaceHeight
    // need current matrices. Without this, rotated collision meshes appear stale.
    scene.updateMatrixWorld(true);
    
    // Update local mixer
    if (playerAnims.mixer) playerAnims.mixer.update(delta);
    
    // Update remote mixers
    for (const id in remotePlayers) {
        if (remotePlayers[id].anims && remotePlayers[id].anims.mixer) {
            remotePlayers[id].anims.mixer.update(delta);
        }
    }

    updatePlayer(delta);
    updateOcclusion(); // Check for blocked view
    updateGametags();
    controls.update();
    renderer.render(scene, camera);
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
    // Get microphone access
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log('Microphone Ready');
    } catch (err) {
        console.error('Microphone access denied:', err);
        return;
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
    if (currentCall) currentCall = null;
    remoteAudio.srcObject = null;
    
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
    if (enabled) {
        localStream.getAudioTracks()[0].enabled = false;
        btnMute.innerText = '🔇';
    } else {
        localStream.getAudioTracks()[0].enabled = true;
        btnMute.innerText = '🎤';
    }
};

