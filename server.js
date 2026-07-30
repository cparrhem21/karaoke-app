const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// If someone visits the main URL, redirect them to the display screen
app.get('/', (req, res) => {
    res.redirect('/display.html');
});

// This object will store the state for every active TV session
// Format: { "A7X2": { queue: [{videoId, title}], isPlaying: false } }
const rooms = {};

io.on('connection', (socket) => {
    console.log('A device connected:', socket.id);

    // --- 1. DISPLAY CREATES ROOM ---
    socket.on('create_room', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        // Initialize the empty state for this room
        rooms[roomCode] = {
            queue: [],
            isPlaying: false
        };

        socket.join(roomCode);
        socket.emit('room_created', roomCode);
    });

    // --- 2. MOBILE JOINS ROOM ---
    socket.on('join_room', (roomCode) => {
        if (!rooms[roomCode]) {
            socket.emit('error', 'Room does not exist');
            return;
        }
        
        socket.join(roomCode);
        io.to(roomCode).emit('mobile_connected', { message: 'Phone paired successfully!' });
        
        // Send the current queue to the phone that just joined
        socket.emit('queue_updated', rooms[roomCode].queue);
    });

    // --- 3. MOBILE ADDS SONG TO QUEUE ---
    socket.on('add_to_queue', (data) => {
        const { roomCode, videoId, title } = data;
        
        if (!rooms[roomCode]) return;

        // Push the new song to the server's memory
        rooms[roomCode].queue.push({ videoId, title });
        
        console.log(`Added "${title}" to room ${roomCode}. Queue length: ${rooms[roomCode].queue.length}`);

        // Broadcast the new queue list to everyone (TV and phones)
        io.to(roomCode).emit('queue_updated', rooms[roomCode].queue);

        // If the TV is sitting idle, start playing immediately
        if (!rooms[roomCode].isPlaying) {
            playNextSong(roomCode);
        }
    });

    // --- 5. MOBILE REQUESTS SKIP ---
socket.on('skip_song', (roomCode) => {
    if (!rooms[roomCode]) return;
    console.log(`Skipping current song in room ${roomCode}`);
    
    // Force the server to immediately play the next song
    playNextSong(roomCode);
});

    // --- 4. DISPLAY SAYS SONG FINISHED ---
    socket.on('song_ended', (roomCode) => {
        if (!rooms[roomCode]) return;
        
        // Mark the TV as idle, then try to play the next song
        rooms[roomCode].isPlaying = false;
        playNextSong(roomCode);
    });

    socket.on('disconnect', () => {
        console.log('Device disconnected:', socket.id);
        // Note: In a production app, you'd want logic here to delete the room from 
        // the `rooms` object if the TV disconnects, to prevent memory leaks.
    });
});


// --- HELPER FUNCTION ---
function playNextSong(roomCode) {
    const room = rooms[roomCode];
    
    // If there are songs in the queue, pop the first one off and play it
    if (room.queue.length > 0) {
        const nextSong = room.queue.shift(); // Removes and returns the first item
        room.isPlaying = true;
        
        console.log(`Playing "${nextSong.title}" in room ${roomCode}`);
        
        // Tell the TV to play it
        io.to(roomCode).emit('play_video', nextSong.videoId);
        
        // Update everyone's screens to show the song was removed from the queue
        io.to(roomCode).emit('queue_updated', room.queue);
    } else {
        // UPDATED: Make sure we mark it as false, and tell the TV to stop
        room.isPlaying = false;
        io.to(roomCode).emit('queue_empty');
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Karaoke server running on http://localhost:${PORT}`);
});