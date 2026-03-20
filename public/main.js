import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 0. Socket & Login ---
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

// PeerJS & Audio State
let peer = null;
let localStream = null;
let currentCall = null;
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
        } else if (characterMesh && characterMesh.material) {
            // Apply chosen color to default avatar
            characterMesh.material.color.set(localUserColor);
        }

        playerGroup.visible = true;
        loginScreen.classList.add('hidden');
        createGametag(socket.id, name, localUserColor, true);

        // Initialize PeerJS for audio calls
        initPeer();
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
    catalogTitle.innerText = type === 'characters' ? 'Escolher Avatar' : 'Catálogo de Objetos';
    
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

// --- Animation Manager ---
function handleAnimationState(animObj, state, duration = 0.2, loop = true) {
    if (!animObj.mixer || animObj.currentState === state) return;
    
    const nextAction = animObj.actions[state];
    if (!nextAction) return;

    if (animObj.currentAction) {
        animObj.currentAction.fadeOut(duration);
    }

    nextAction.reset().fadeIn(duration).play();
    nextAction.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    nextAction.clampWhenFinished = !loop;

    if (!loop) {
        animObj.mixer.addEventListener('finished', function onFinished() {
            animObj.mixer.removeEventListener('finished', onFinished);
            // Return to previous state (usually idle or walk)
            const fallbackState = (keys.w || keys.a || keys.s || keys.d) ? 'walk' : 'idle';
            handleAnimationState(animObj, fallbackState);
        });
    }

    animObj.currentAction = nextAction;
    animObj.currentState = state;
}

// --- Multiplayer & Player Setup ---
const remotePlayers = {}; // Stores meshes and groups
const gametags = {}; // Stores UI elements

const playerGroup = new THREE.Group();
let characterMesh = null;
scene.add(playerGroup);

function createDefaultAvatar() {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.3, metalness: 0.2 });
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
const localAvatar = createDefaultAvatar();
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
    });
});

socket.on('newPlayer', (playerInfo) => {
    addOtherPlayer(playerInfo);
});

socket.on('playerMoved', (playerInfo) => {
    if (remotePlayers[playerInfo.id]) {
        remotePlayers[playerInfo.id].group.position.copy(playerInfo.position);
        remotePlayers[playerInfo.id].group.rotation.setFromVector3(new THREE.Vector3(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z));
        
        // Update remote animation
        if (playerInfo.animation && remotePlayers[playerInfo.id].anims) {
            handleAnimationState(remotePlayers[playerInfo.id].anims, playerInfo.animation);
        }
    }
});

socket.on('playerUpdated', (playerInfo) => {
    createGametag(playerInfo.id, playerInfo.name, playerInfo.color, false);
});

socket.on('playerDisconnected', (id) => {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id].group);
        delete remotePlayers[id];
    }
    removeGametag(id);
});

socket.on('playerPeerUpdated', (data) => {
    if (remotePlayers[data.id]) {
        remotePlayers[data.id].peerId = data.peerId;
        console.log(`Remote player ${data.id} has PeerID: ${data.peerId}`);
    }
});

socket.on('playerModelUpdated', (data) => {
    if (remotePlayers[data.id]) {
        const mData = data.modelData;
        if (mData) {
            if (mData.buffer) {
                loadModelFromBuffer(mData.buffer, remotePlayers[data.id]);
            } else if (mData.path) {
                updateRemotePlayerModelByUrl(data.id, mData.path, mData.animations);
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
    // Remove optimistic ghost if exists
    removeOptimisticObject(cube.id);
    createCube(cube);
});

socket.on('modelAdded', (model) => {
    // Remove optimistic ghost if exists
    removeOptimisticObject(model.id);
    createPlacedModel(model);
});

function removeOptimisticObject(id) {
    // 1. Collect all optimistic objects to remove
    const toRemove = [];
    scene.traverse(obj => {
        if (obj.userData && obj.userData.isOptimistic) {
            toRemove.push(obj);
        }
    });

    // 2. Safely remove them from scene
    toRemove.forEach(obj => {
        scene.remove(obj);
        // Also remove from mapping if it exists
        for (const key in idToUuid) {
            if (idToUuid[key] === obj.uuid) {
                delete idToUuid[key];
            }
        }
    });

    // 3. Thorough cleanup of wallBoxes: remove ALL optimistic entries
    wallBoxes = wallBoxes.filter(box => {
        const rId = box.relatedId ? box.relatedId.toString() : '';
        return !rId.startsWith('opt_') && rId !== id;
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
    wallBoxes = wallBoxes.filter(box => {
        const rId = box.relatedId ? box.relatedId.toString() : '';
        return rId !== id && !rId.startsWith('opt_' + id);
    });

    // 3. Clean up the mapping
    delete idToUuid[id];
});

socket.on('objectUpdated', (data) => {
    const obj = scene.getObjectByProperty('uuid', idToUuid[data.id]);
    if (obj) {
        if (data.color) obj.material.color.set(data.color);
        if (data.rotation) obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    }
});

socket.on('chatMessage', (data) => {
    addMessageToChat(data);
});

socket.on('initialChatHistory', (history) => {
    if (history) history.forEach(msg => addMessageToChat(msg));
});

function addOtherPlayer(playerInfo) {
    const avatar = createDefaultAvatar();
    avatar.group.position.copy(playerInfo.position);
    avatar.group.rotation.setFromVector3(new THREE.Vector3(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z));
    scene.add(avatar.group);
    
    remotePlayers[playerInfo.id] = {
        group: avatar.group,
        mainMesh: avatar.bodyMesh,
        avatarContainer: avatar.group, // Keep track of the inner group
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
            loadModelFromBuffer(playerInfo.modelData.buffer, remotePlayers[playerInfo.id]);
        } else if (playerInfo.modelData.path) {
            updateRemotePlayerModelByUrl(playerInfo.id, playerInfo.modelData.path);
        }
    }
}

function loadModelFromBuffer(arrayBuffer, targetPlayerObj) {
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

        const box = new THREE.Box3().setFromObject(newModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        newModel.position.x -= center.x;
        newModel.position.z -= center.z;
        newModel.position.y -= center.y - (size.y / 2);

        targetPlayerObj.avatarContainer.add(newModel);
        targetPlayerObj.mainMesh = newModel;
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
    
    // Jump trigger
    if (e.code === 'Space') {
        keys[' '] = true;
        handleAnimationState(playerAnims, 'jump', 0.1, false);
    }
    
    // Interact trigger
    if (key === 'e') {
        handleAnimationState(playerAnims, 'interact', 0.1, false);
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
            contextMenuPoint.copy(finalHit.point);

            // Position menu
            contextMenu.style.left = event.clientX + 'px';
            contextMenu.style.top = event.clientY + 'px';
            contextMenu.classList.remove('hidden');
            isMenuOpen = true;

            menuGroundSection.classList.add('hidden');
            menuCubeSection.classList.add('hidden');
            menuModelSection.classList.add('hidden');

            if (contextMenuTarget.name === "ground") {
                menuGroundSection.classList.remove('hidden');
            } else if (contextMenuTarget.userData && contextMenuTarget.userData.id.startsWith('cube_')) {
                menuCubeSection.classList.remove('hidden');
            } else if (contextMenuTarget.userData && contextMenuTarget.userData.id.startsWith('model_')) {
                menuModelSection.classList.remove('hidden');
            }
        }
    }
});

document.getElementById('menu-catalog-models').addEventListener('click', () => {
    openCatalog('models', (url) => {
        const tempId = 'opt_model_' + Date.now();
        socket.emit('placeModel', {
            modelPath: url,
            position: contextMenuPoint.clone()
        });
        
        // Optimistic UI for catalog model
        createPlacedModel({
            id: tempId,
            modelPath: url,
            position: contextMenuPoint.clone(),
            rotation: { x: 0, y: 0, z: 0 },
            isOptimistic: true
        });
    });
    closeContextMenu();
});

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
            const gltfLoader = new GLTFLoader();
            // Parse locally first for collision check
            gltfLoader.parse(buffer, '', (gltf) => {
                const model = gltf.scene;
                model.position.copy(contextMenuPoint);
                model.updateMatrixWorld(true);
                const tempBox = new THREE.Box3().setFromObject(model);
                
                if (checkGeneralCollision(tempBox)) {
                    alert("A posição está ocupada!");
                } else {
                    const tempId = 'opt_model_' + Date.now();
                    // Optimistic creation
                    createPlacedModel({
                        id: tempId,
                        modelBuffer: buffer,
                        position: contextMenuPoint.clone(),
                        rotation: { x: 0, y: 0, z: 0 },
                        isOptimistic: true
                    });

                    socket.emit('placeModel', {
                        modelBuffer: buffer,
                        position: contextMenuPoint.clone()
                    });
                }
            });
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

document.getElementById('menu-rotate-right').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.id) {
        contextMenuTarget.rotation.y -= Math.PI / 2;
        socket.emit('updateObjectRotation', {
            id: contextMenuTarget.userData.id,
            rotation: { x: 0, y: contextMenuTarget.rotation.y, z: 0 }
        });
    }
    closeContextMenu();
});

document.getElementById('menu-rotate-left').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.userData.id) {
        contextMenuTarget.rotation.y += Math.PI / 2;
        socket.emit('updateObjectRotation', {
            id: contextMenuTarget.userData.id,
            rotation: { x: 0, y: contextMenuTarget.rotation.y, z: 0 }
        });
    }
    closeContextMenu();
});

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
        // ... (existing base logic) ...
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(plane);

        if (intersects.length > 0) {
            currentPlacementState = PlacementState.BASE;
            placementStartPoint.copy(intersects[0].point);
            
            // Create preview cube
            const geo = new THREE.BoxGeometry(1, 1, 1);
            const mat = new THREE.MeshStandardMaterial({ color: localUserColor, transparent: true, opacity: 0.5 });
            previewCube = new THREE.Mesh(geo, mat);
            previewCube.position.set(placementStartPoint.x, 0.5, placementStartPoint.z);
            scene.add(previewCube);
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

            // Optimistic creation
            const tempId = 'opt_cube_' + Date.now();
            createCube({
                id: tempId,
                position: pos,
                size: size,
                color: localUserColor,
                isOptimistic: true
            });

            socket.emit('placeCube', {
                position: pos,
                size: size,
                color: localUserColor
            });
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

    if (currentPlacementState === PlacementState.BASE) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(plane);

        if (intersects.length > 0) {
            const currentPoint = intersects[0].point;
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

const wallsGroup = new THREE.Group();
scene.add(wallsGroup);

const wallMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.8 });
const wall1 = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 10), wallMat);
wall1.position.set(-5, 2, 0); wall1.castShadow = true; wall1.receiveShadow = true;
const wall2 = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 1), wallMat);
wall2.position.set(0, 2, -5); wall2.castShadow = true; wall2.receiveShadow = true;
const wall3 = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 10), wallMat);
wall3.position.set(5, 2, -2.5); wall3.scale.set(1, 1, 0.5); wall3.castShadow = true; wall3.receiveShadow = true;

wallsGroup.add(wall1, wall2, wall3);
let wallBoxes = [];
wallsGroup.children.forEach(wall => {
    wall.updateMatrixWorld();
    wallBoxes.push(new THREE.Box3().setFromObject(wall));
});

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
let moveSpeed = 0.05; // Slightly faster

function checkCollision(targetPosition) {
    const playerBox = new THREE.Box3().setFromObject(playerGroup);
    const offset = targetPosition.clone().sub(playerGroup.position);
    playerBox.translate(offset);
    for (const wallBox of wallBoxes) if (playerBox.intersectsBox(wallBox)) return true;
    return false;
}

function updatePlayer() {
    if (localUsername === '' || isMenuOpen) return; // Wait until logged in or menu closed

    let moveX = 0, moveZ = 0;
    if (keys.w) { moveZ -= moveSpeed; moveX -= moveSpeed; }
    if (keys.s) { moveZ += moveSpeed; moveX += moveSpeed; }
    if (keys.a) { moveX -= moveSpeed; moveZ += moveSpeed; }
    if (keys.d) { moveX += moveSpeed; moveZ -= moveSpeed; }

    if ((keys.w || keys.s) && (keys.a || keys.d)) {
        moveX *= 0.7071;
        moveZ *= 0.7071;
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
        
        // Broadcast movement with animation state
        socket.emit('playerMovement', {
            position: playerGroup.position,
            rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
            animation: playerAnims.currentState
        });
    } else {
        handleAnimationState(playerAnims, 'idle');
        // Still broadcast idle state periodically or when it changes
        if (playerAnims.currentState === 'idle') {
             socket.emit('playerMovement', {
                position: playerGroup.position,
                rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z },
                animation: 'idle'
            });
        }
    }

    const cameraOffset = new THREE.Vector3(20, 20, 20);
    const targetCamPos = playerGroup.position.clone().add(cameraOffset);
    camera.position.lerp(targetCamPos, 0.1);
    controls.target.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z);
}

function updateOcclusion() {
    if (!playerGroup) return;

    // 1. Reset all cubes to opaque
    scene.traverse(obj => {
        if (obj.isMesh && obj.userData && obj.userData.id && obj.userData.id.startsWith('cube_')) {
            obj.material.opacity = 1.0;
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
        while (obj && obj !== scene) {
            if (obj.userData && obj.userData.id && obj.userData.id.startsWith('cube_')) {
                obj.material.opacity = 0.2;
                break; 
            }
            obj = obj.parent;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    
    // Update local mixer
    if (playerAnims.mixer) playerAnims.mixer.update(delta);
    
    // Update remote mixers
    for (const id in remotePlayers) {
        if (remotePlayers[id].anims && remotePlayers[id].anims.mixer) {
            remotePlayers[id].anims.mixer.update(delta);
        }
    }

    updatePlayer();
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
        // Remove old character container contents
        while(playerGroup.children.length > 0){
            playerGroup.remove(playerGroup.children[0]);
        }

        characterMesh = gltf.scene;
        characterMesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        playerGroup.add(characterMesh);

        const box = new THREE.Box3().setFromObject(characterMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        characterMesh.position.x -= center.x;
        characterMesh.position.z -= center.z;
        characterMesh.position.y -= center.y - (size.y / 2);

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
        playerGroup.add(characterMesh);

        // Setup Mixer if animations are provided
        if (animPaths) {
            playerAnims.mixer = new THREE.AnimationMixer(characterMesh);
            playerAnims.actions = {};
            playerAnims.currentState = null;

            // Load each animation
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
        } else {
            playerAnims.mixer = null;
        }

        const box = new THREE.Box3().setFromObject(characterMesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        characterMesh.position.x -= center.x;
        characterMesh.position.z -= center.z;
        characterMesh.position.y -= center.y - (size.y / 2);

        loadingIndicator.classList.add('hidden');
    });
}

function updateRemotePlayerModelByUrl(id, url, animPaths = null) {
    const player = remotePlayers[id];
    if (!player) return;
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(url, (gltf) => {
        while(player.group.children.length > 0) player.group.remove(player.group.children[0]);
        const mesh = gltf.scene;
        mesh.traverse(child => { if(child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
        player.group.add(mesh);

        // Setup Mixer for remote
        if (animPaths) {
            player.anims.mixer = new THREE.AnimationMixer(mesh);
            player.anims.actions = {};
            player.anims.currentState = null;

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

        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        mesh.position.x -= center.x;
        mesh.position.z -= center.z;
        mesh.position.y -= center.y - (size.y / 2);
    });
}

function createPlacedModel(data) {
    const gltfLoader = new GLTFLoader();
    const onParsed = (gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        model.position.set(data.position.x, data.position.y, data.position.z);
        model.rotation.set(data.rotation ? data.rotation.x : 0, data.rotation ? data.rotation.y : 0, data.rotation ? data.rotation.z : 0);
        model.userData.id = data.id;
        model.userData.isOptimistic = data.isOptimistic || false;
        idToUuid[data.id] = model.uuid;
        scene.add(model);

        // Add to collision
        model.updateMatrixWorld();
        const modelBox = new THREE.Box3().setFromObject(model);
        modelBox.relatedId = data.id;
        wallBoxes.push(modelBox);
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

        incomingCaller.innerText = call.peer;
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

