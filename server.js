const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow connections from any origin
        methods: ["GET", "POST"]
    }
});

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
const placedModels = []; // New: Stores { id, position, modelData, rotation }

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create a new player
    players[socket.id] = {
        id: socket.id,
        name: 'Guest_' + Math.floor(Math.random() * 1000),
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        modelData: null
    };

    // Initial sync
    socket.emit('currentPlayers', players);
    socket.emit('initialCubes', placedCubes);
    socket.emit('initialModels', placedModels); // Sync models

    // Broadcast the new player
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Handle name change
    socket.on('setName', (name) => {
        if (players[socket.id]) {
            players[socket.id].name = name;
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
            io.emit('chatMessage', {
                id: socket.id,
                name: players[socket.id].name,
                message: message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
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
            modelBuffer: modelData.modelBuffer
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
