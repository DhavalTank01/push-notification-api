const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const webpush = require('web-push');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({
    origin: ["http://localhost:3000", "http://localhost:5173"],
    credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ["http://localhost:3000", "http://localhost:5173"],
        methods: ["GET", "POST"]
    }
});

// Store connected users and their subscriptions
const users = new Map();
const socketUsers = new Map();
const pushSubscriptions = new Map();

// VAPID keys for web push (generate these once and save them)
// Run: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables are required');
}

if (!process.env.VAPID_EMAIL) {
    throw new Error('VAPID_EMAIL environment variable is required');
}

webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    if (socket.id && !socketUsers.has(socket.id)) {
        socketUsers.set(socket.id, socket);
    }

    socket.on('register', (userId) => {
        users.set(userId, socket.id);
        socket.userId = userId;
        console.log(`User ${userId} registered with socket ${socket.id}`);

        socket.emit('init', { message: 'Connected successfully', userId });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Note: We keep push subscriptions even after disconnect
        // so we can send notifications when app is closed
        if (socket.userId) {
            users.delete(socket.userId);
            socketUsers.delete(socket.id);
        }
    });
});

// API endpoint to get VAPID public key
app.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.get("/api/users/connected", (req, res) => {
    return res.status(200).json({
        users: Array.from(users.keys()),
        socketUsers: Array.from(socketUsers.keys()),
        pushSubscriptions: Array.from(pushSubscriptions.keys()),
        message: "Users fetched successfully"
    });
});

// API endpoint to store push subscription
app.post('/api/subscribe', (req, res) => {
    const { userId, subscription } = req.body;

    if (!userId || !subscription) {
        return res.status(400).json({ error: 'userId and subscription are required' });
    }

    pushSubscriptions.set(userId, subscription);
    console.log(`Push subscription stored for user ${userId}`);

    res.json({ success: true, message: 'Subscription stored successfully' });
});

// API endpoint to send notification to a specific user
app.post('/api/send-notification', async (req, res) => {
    const { userId, message, body, url } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ error: 'userId and message are required' });
    }

    try {
        // Try to send via Socket.IO first (if user is connected)
        const socketId = users.get(userId);
        if (socketId) {
            io.to(socketId).emit('notification', { message, body, url });
            console.log(`Notification sent via Socket.IO to user ${userId}`);
        }

        // Also send via Web Push (works even if app is closed)
        const subscription = pushSubscriptions.get(userId);
        if (subscription) {
            const payload = JSON.stringify({ message, body, url });

            await webpush.sendNotification(subscription, payload);
            console.log(`Push notification sent to user ${userId}`);
        }

        res.json({
            success: true,
            socketSent: !!socketId,
            pushSent: !!subscription
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

// API endpoint to send notification to all users
app.post('/api/broadcast-notification', async (req, res) => {
    const { message, body, url } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'message is required' });
    }

    try {
        // Send via Socket.IO to all connected users
        io.emit('notification', { message, body, url });

        // Send via Web Push to all subscribed users
        const pushPromises = [];
        for (const [userId, subscription] of pushSubscriptions.entries()) {
            const payload = JSON.stringify({ message, body, url });
            pushPromises.push(
                webpush.sendNotification(subscription, payload)
                    .catch(err => console.error(`Failed to send to ${userId}:`, err))
            );
        }

        await Promise.all(pushPromises);

        res.json({
            success: true,
            socketsSent: users.size,
            pushSent: pushSubscriptions.size
        });
    } catch (error) {
        console.error('Error broadcasting notification:', error);
        res.status(500).json({ error: 'Failed to broadcast notification' });
    }
});

try {
    const PORT = process.env.PORT || 4001;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
} catch (error) {
    console.error(message);
    console.log('Gracefully shutting down...');
    process.exit(1);
}