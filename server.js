const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow connections from any origin
        methods: ["GET", "POST"]
    }
});

// Helper: Scan assets catalog
function getCatalogItems(subDir) {
    const dirPath = path.join(__dirname, 'public', 'assets', subDir);
    if (!fs.existsSync(dirPath)) return [];
    
    return fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.glb'))
        .map(file => {
            const name = file.replace('.glb', '');
            const iconRelative = `assets/${subDir}/${name}.png`;
            const iconFull = path.join(__dirname, 'public', iconRelative);
            return {
                name: name,
                model: `assets/${subDir}/${file}`,
                icon: fs.existsSync(iconFull) ? iconRelative : 'assets/default.png'
            };
        });
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
const chatHistory = []; // New: Stores the last 50 messages
const MAX_CHAT_LOGS = 50;

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create a new player
    players[socket.id] = {
        id: socket.id,
        name: 'Guest_' + Math.floor(Math.random() * 1000),
        color: '#3b82f6', // Default color
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        modelData: null
    };

    // Initial sync
    socket.emit('currentPlayers', players);
    socket.emit('initialCubes', placedCubes);
    socket.emit('initialModels', placedModels);
    socket.emit('initialChatHistory', chatHistory); // Sync chat history

    // Send Catalog Data
    socket.emit('catalogData', {
        characters: getCatalogItems('characters'),
        models: getCatalogItems('models')
    });

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
            }
            io.emit('playerUpdated', players[socket.id]);
        }
    });

    // Handle movement
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].position = movementData.position;
            players[socket.id].rotation = movementData.rotation;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Handle full model update
    socket.on('modelUpdate', (modelData) => {
        if (players[socket.id]) {
            players[socket.id].modelData = modelData;
            socket.broadcast.emit('playerModelUpdated', {
                id: socket.id,
                modelData: modelData
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
            modelPath: modelData.modelPath || null
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
