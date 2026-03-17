import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 0. Socket & Login ---
const socket = io();
let localUsername = '';
const loginScreen = document.getElementById('login-screen');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        localUsername = name;
        socket.emit('setName', name);
        loginScreen.classList.add('hidden');
        createGametag(socket.id, name, true); // Create local gametag
    }
});

// --- 1. Scene Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f172a');
scene.fog = new THREE.FogExp2('#0f172a', 0.015);

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

function createGametag(id, name, isLocal) {
    if (gametags[id]) {
        gametags[id].element.innerText = name;
        return;
    }
    const element = document.createElement('div');
    element.className = 'gametag';
    element.innerText = name;
    if (isLocal) element.style.color = '#10b981'; // Green for local
    document.body.appendChild(element);
    gametags[id] = { element, isLocal };
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
    }
});

socket.on('playerUpdated', (playerInfo) => {
    createGametag(playerInfo.id, playerInfo.name, false);
});

socket.on('playerDisconnected', (id) => {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id].group);
        delete remotePlayers[id];
    }
    removeGametag(id);
});

socket.on('playerModelUpdated', (data) => {
    if (remotePlayers[data.id]) {
        loadModelFromBuffer(data.modelData, remotePlayers[data.id]);
    }
});

function addOtherPlayer(playerInfo) {
    const avatar = createDefaultAvatar();
    avatar.group.position.copy(playerInfo.position);
    avatar.group.rotation.setFromVector3(new THREE.Vector3(playerInfo.rotation.x, playerInfo.rotation.y, playerInfo.rotation.z));
    scene.add(avatar.group);
    
    remotePlayers[playerInfo.id] = {
        group: avatar.group,
        mainMesh: avatar.bodyMesh,
        avatarContainer: avatar.group // Keep track of the inner group
    };
    
    createGametag(playerInfo.id, playerInfo.name, false);

    if (playerInfo.modelData) {
        loadModelFromBuffer(playerInfo.modelData, remotePlayers[playerInfo.id]);
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
const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('keydown', (e) => {
    if (document.activeElement === usernameInput) return; // Ignore if typing name
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
    if (document.activeElement === usernameInput) return;
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});

// --- Lighting & Environment ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(10, 15, 10);
directionalLight.castShadow = true;
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
scene.add(plane);

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
const wallBoxes = [];
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
    if (localUsername === '') return; // Wait until logged in

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
        
        // Broadcast movement
        socket.emit('playerMovement', {
            position: playerGroup.position,
            rotation: { x: playerGroup.rotation.x, y: playerGroup.rotation.y, z: playerGroup.rotation.z }
        });
    }

    const cameraOffset = new THREE.Vector3(20, 20, 20);
    const targetCamPos = playerGroup.position.clone().add(cameraOffset);
    camera.position.lerp(targetCamPos, 0.1);
    controls.target.set(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z);
}

function animate() {
    requestAnimationFrame(animate);
    updatePlayer();
    updateGametags();
    controls.update();
    renderer.render(scene, camera);
}
animate();

// --- 6. GLB File Upload ---
const uploadInput = document.getElementById('glb-upload');
const loadingIndicator = document.getElementById('loading-indicator');

uploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.glb') && !file.name.toLowerCase().endsWith('.gltf')) {
        alert('Please select a valid .glb or .gltf 3D model file.');
        return;
    }

    loadingIndicator.classList.remove('hidden');

    // Read file as ArrayBuffer for sending to server
    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        
        // Broadcast to other players
        socket.emit('modelUpdate', arrayBuffer);
        
        // Load locally
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
    };
    reader.readAsArrayBuffer(file);

    uploadInput.value = '';
});
