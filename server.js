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

// Store connected players and placed cubes
const players = {};
const placedCubes = [];

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create a new player
    players[socket.id] = {
        id: socket.id,
        name: 'Guest_' + Math.floor(Math.random() * 1000),
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        modelData: null // Will hold the array buffer or base64 of the model
    };

    // Send existing players to the new client
    socket.emit('currentPlayers', players);
    
    // Send existing cubes to the new client
    socket.emit('initialCubes', placedCubes);

    // Broadcast the new player to everyone else
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
            // Broadcast movement to all OTHER clients
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Handle full model update
    socket.on('modelUpdate', (modelData) => {
        if (players[socket.id]) {
            // Broadcast the new model data to everyone else
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

    // Handle cube placement
    socket.on('placeCube', (cubeData) => {
        const newCube = {
            id: 'cube_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            position: cubeData.position,
            color: cubeData.color || '#ef4444' // Default red
        };
        placedCubes.push(newCube);
        io.emit('cubeAdded', newCube);
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
