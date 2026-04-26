const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Setup PeerServer integrated with Express
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/'
});

// Use the peerServer middleware at /peerjs
app.use('/peerjs', peerServer);

// Helper: Scan assets catalog
function getCatalogItems(subDir) {
    const dirPath = path.join(__dirname, 'public', 'assets', subDir);
    if (!fs.existsSync(dirPath)) return [];
    
    const items = [];
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory() && subDir === 'characters') {
            // New logic for character folders
            const name = file;
            const modelPath = `assets/${subDir}/${name}/${name}.glb`;
            const iconPath = `assets/${subDir}/${name}/${name}.png`;
            const fullModelPath = path.join(__dirname, 'public', modelPath);
            const fullIconPath = path.join(__dirname, 'public', iconPath);

            if (fs.existsSync(fullModelPath)) {
                const anims = ['idle', 'walk', 'jump', 'interact'];
                const animations = {};
                anims.forEach(anim => {
                    const animPath = `assets/${subDir}/${name}/${anim}.glb`;
                    if (fs.existsSync(path.join(__dirname, 'public', animPath))) {
                        animations[anim] = animPath;
                    }
                });

                items.push({
                    name: name,
                    model: modelPath,
                    icon: fs.existsSync(fullIconPath) ? iconPath : 'assets/default.png',
                    animations: animations,
                    type: 'complex'
                });
            }
        } else if (file.endsWith('.glb')) {
            // Legacy/Model logic (flat files)
            const name = file.replace('.glb', '');
            const iconRelative = `assets/${subDir}/${name}.png`;
            const iconFull = path.join(__dirname, 'public', iconRelative);
            items.push({
                name: name,
                model: `assets/${subDir}/${file}`,
                icon: fs.existsSync(iconFull) ? iconRelative : 'assets/default.png',
                type: 'simple'
            });
        }
    });

    return items;
}

const PORT = parseInt(process.env.PORT || 3000, 10);

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Basic health check endpoint for Railway ping/status
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Store connected players, placed cubes, and placed models
const players = {};
const placedCubes = [];
const placedModels = [];
const placedModulePlacements = []; // New: Stores teaching module placements
const chatHistory = []; // New: Stores the last 50 messages
const MAX_CHAT_LOGS = 50;

// Expose catalog data via HTTP so clients can fetch avatars before connecting socket
app.get('/api/catalog', (req, res) => {
    res.json({
        characters: getCatalogItems('characters'),
        models: getCatalogItems('models'),
        structures: getCatalogItems('structures')
    });
});

// Expose configuration variables to the frontend
app.get('/api/config', (req, res) => {
    res.json({
        LOGIN_SYSTEM_URL: process.env.LOGIN_SYSTEM_URL || 'https://login-system-production-84c6.up.railway.app'
    });
});

// Setup socket authentication middleware
// --- Auth Caching ---
const tokenCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    socket.decoded = cached.data;
    return next();
  }

  try {
    const loginSystemUrl = process.env.LOGIN_SYSTEM_URL || 'https://login-system-production-84c6.up.railway.app';
    const response = await fetch(`${loginSystemUrl}/auth/verify`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const result = await response.json();

    if (!response.ok) {
      return next(new Error('Invalid token'));
    }

    // Cache the result
    tokenCache.set(token, {
      data: result,
      timestamp: Date.now()
    });

    socket.decoded = result;
    next();
  } catch (err) {
    console.error('Auth verification error:', err);
    next(new Error('Authentication service unreachable'));
  }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create a new player
    players[socket.id] = {
        id: socket.id,
        name: 'Guest_' + Math.floor(Math.random() * 1000),
        color: '#3b82f6', // Default color
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        animation: 'idle', // New: Track animation state
        modelData: null,
        peerId: null // New: Store PeerJS ID for audio calls
    };

    // Initial sync
    socket.emit('currentPlayers', players);
    socket.emit('initialCubes', placedCubes);
    socket.emit('initialModels', placedModels);
    socket.emit('initialModulePlacements', placedModulePlacements); // Sync module placements
    socket.emit('initialChatHistory', chatHistory); // Sync chat history

    // Broadcast the new player
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Handle name/color update (updated)
    socket.on('setName', (data) => {
        if (players[socket.id]) {
            if (typeof data === 'string') {
                players[socket.id].name = data;
            } else {
                players[socket.id].name = data.name;
                players[socket.id].color = data.color;
                if (data.profilePicture) players[socket.id].profilePicture = data.profilePicture;
            }
            io.emit('playerUpdated', players[socket.id]);
        }
    });

    // Handle peerId sync (New)
    socket.on('setPeerId', (peerId) => {
        if (players[socket.id]) {
            players[socket.id].peerId = peerId;
            console.log(`Player ${players[socket.id].name} set PeerID: ${peerId}`);
            socket.broadcast.emit('playerPeerUpdated', {
                id: socket.id,
                peerId: peerId
            });
        }
    });

    // Handle movement
    let movementLogCounter = 0;
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            if (movementData && movementData.position) {
                players[socket.id].position = movementData.position;
                players[socket.id].rotation = movementData.rotation;
                players[socket.id].animation = movementData.animation || 'idle';
                
                movementLogCounter++;
                if (movementLogCounter % 100 === 0) {
                    console.log(`[Movement Sync] Player ${players[socket.id].name} (${socket.id}) at:`, movementData.position);
                }

                // Use io.emit for movement to ensure maximum availability, then filter on client
                io.emit('playerMoved', {
                    id: socket.id,
                    position: movementData.position,
                    rotation: movementData.rotation,
                    animation: movementData.animation,
                    isJumping: movementData.isJumping,
                    jumpAlpha: movementData.jumpAlpha,
                    didInteract: movementData.didInteract,
                    interactionPoint: movementData.interactionPoint
                });
            } else {
                console.warn(`[Movement] Invalid data from ${socket.id}:`, movementData);
            }
        }
    });

    // Handle full model update
    socket.on('modelUpdate', (modelData) => {
        if (players[socket.id]) {
            players[socket.id].modelData = modelData;
            socket.broadcast.emit('playerModelUpdated', {
                id: socket.id,
                modelData: modelData,
                color: players[socket.id].color // Include color for replication
            });
        }
    });

    // Handle chat messages
    socket.on('chatMessage', (message) => {
        if (players[socket.id]) {
            const chatData = {
                id: socket.id,
                name: players[socket.id].name,
                message: message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            
            // Save to history
            chatHistory.push(chatData);
            if (chatHistory.length > MAX_CHAT_LOGS) chatHistory.shift();
            
            io.emit('chatMessage', chatData);
        }
    });
    
    // --- Object Management ---

    // Handle cube placement (updated)
    socket.on('placeCube', (cubeData) => {
        const newCube = {
            id: 'cube_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            position: cubeData.position,
            size: cubeData.size || { w: 1, h: 1, d: 1 },
            color: cubeData.color || '#ef4444'
        };
        placedCubes.push(newCube);
        io.emit('cubeAdded', newCube);
    });

    // Handle model placement
    socket.on('placeModel', (modelData) => {
        const newModel = {
            id: 'model_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            position: modelData.position,
            rotation: modelData.rotation || { x: 0, y: 0, z: 0 },
            modelBuffer: modelData.modelBuffer || null,
            modelPath: modelData.modelPath || null,
            isStructure: modelData.isStructure || false
        };
        placedModels.push(newModel);
        io.emit('modelAdded', newModel);
    });

    // Handle object deletion
    socket.on('deleteObject', (id) => {
        if (id.startsWith('cube_')) {
            const index = placedCubes.findIndex(c => c.id === id);
            if (index !== -1) placedCubes.splice(index, 1);
        } else if (id.startsWith('model_')) {
            const index = placedModels.findIndex(m => m.id === id);
            if (index !== -1) placedModels.splice(index, 1);
        }
        io.emit('objectDeleted', id);
    });

    // Handle cube color update
    socket.on('updateObjectColor', (data) => {
        const cube = placedCubes.find(c => c.id === data.id);
        if (cube) {
            cube.color = data.color;
            io.emit('objectUpdated', { id: data.id, color: data.color });
        }
    });

    // Handle model rotation update
    socket.on('updateObjectRotation', (data) => {
        const model = placedModels.find(m => m.id === data.id);
        if (model) {
            model.rotation = data.rotation;
            io.emit('objectUpdated', { id: data.id, rotation: data.rotation });
        }
    });

    // Handle module placement
    socket.on('placeModulePlacement', (data) => {
        const newPlacement = {
            id: data.id, // ID from Login-System
            moduleId: data.moduleId,
            moduleTitle: data.moduleTitle || '', // New: Store title
            status: data.status || 'NONE',
            position: data.position,
            rotation: data.rotation || { x: 0, y: 0, z: 0 },
            ownerMasterId: socket.decoded?.id,
            ownerUsername: socket.decoded?.username
        };
        placedModulePlacements.push(newPlacement);
        io.emit('modulePlacementAdded', newPlacement);
    });

    socket.on('updateModuleAssignment', (data) => {
        const placement = placedModulePlacements.find(p => p.id === data.id);
        if (placement) {
            placement.moduleId = data.moduleId;
            placement.moduleTitle = data.moduleTitle || ''; // Update title
            placement.status = data.status || 'NONE';
            io.emit('modulePlacementUpdated', { 
                id: data.id, 
                moduleId: data.moduleId, 
                moduleTitle: data.moduleTitle, 
                status: data.status 
            });
        }
    });

    // Handle module placement deletion
    socket.on('deleteModulePlacement', (id) => {
        const index = placedModulePlacements.findIndex(p => p.id === id);
        if (index !== -1) {
            placedModulePlacements.splice(index, 1);
            io.emit('modulePlacementDeleted', id);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Fallback to serve index.html for any unknown routes (useful for SPAs)
app.use((req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`SERVER STARTING UP`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log(`Port: ${PORT}`);
    console.log(`Binding: 0.0.0.0`);
    console.log(`========================================`);
});
