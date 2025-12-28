const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
require("dotenv").config();

const port = process.env.PORT || 4000;

const app = express();
const server = createServer(app);
const io = require("socket.io")(server, {
    cors: {
        origin: "http://localhost:5173", // Update this to match your React app port
        methods: ["GET", "POST"],
        credentials: true
    },
});

app.use(cors());
app.use(express.json());

// Store connected users
const connectedUsers = new Map();

// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Send initial data to the connected client
    socket.emit("init", `data: ${Date.now()}`);
    console.log("Data sent to client:", `data: ${Date.now()}`);

    // Register user with optional userId
    socket.on("register", (userId) => {
        if (userId) {
            connectedUsers.set(userId, socket.id);
            socket.userId = userId;
            console.log(`User registered: ${userId} with socket ${socket.id}`);
        }
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
        
        // Remove from connected users
        if (socket.userId) {
            connectedUsers.delete(socket.userId);
            console.log(`User unregistered: ${socket.userId}`);
        }
    });
});

// API endpoint to send notifications to ALL users
app.post("/api/notification/send", (req, res) => {
    try {
        const { message, url, body } = req.body;
        if (!message) {
            res.status(400).send("Message is required");
            return;
        }
        if (!body) {
            res.status(400).send("Body is required");
            return;
        }
        const msgObj = {
            message,
            body: `${body} - ${Date.now()}`,
            timestamp: Date.now(),
        }
        if (url) {
            msgObj.url = url;
        }
        // Emit notification to all connected clients
        io.emit("notification", msgObj);
        console.log("Notification sent to all users:", msgObj);
        console.log("Total connected clients:", io.engine.clientsCount);

        res.status(200).send({
            success: true,
            data: msgObj,
            totalRecipients: io.engine.clientsCount
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
        return;
    }
});

// API endpoint to send notifications to SPECIFIC users
app.post("/api/notification/send-to-users", (req, res) => {
    try {
        const { message, url, body, userIds } = req.body;
        
        if (!message) {
            res.status(400).send("Message is required");
            return;
        }
        if (!body) {
            res.status(400).send("Body is required");
            return;
        }
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            res.status(400).send("userIds array is required");
            return;
        }

        const msgObj = {
            message,
            body: `${body} - ${Date.now()}`,
            timestamp: Date.now(),
        }
        if (url) {
            msgObj.url = url;
        }

        let sentCount = 0;
        let notFoundUsers = [];

        // Send to specific users
        userIds.forEach(userId => {
            const socketId = connectedUsers.get(userId);
            if (socketId) {
                io.to(socketId).emit("notification", msgObj);
                sentCount++;
                console.log(`Notification sent to user ${userId}`);
            } else {
                notFoundUsers.push(userId);
                console.log(`User ${userId} not found or not connected`);
            }
        });

        res.status(200).send({
            success: true,
            data: msgObj,
            sentCount,
            requestedCount: userIds.length,
            notFoundUsers
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
        return;
    }
});

// API endpoint to send notification to a SINGLE user
app.post("/api/notification/send-to-user", (req, res) => {
    try {
        const { message, url, body, userId } = req.body;
        
        if (!message) {
            res.status(400).send("Message is required");
            return;
        }
        if (!body) {
            res.status(400).send("Body is required");
            return;
        }
        if (!userId) {
            res.status(400).send("userId is required");
            return;
        }

        const msgObj = {
            message,
            body: `${body} - ${Date.now()}`,
            timestamp: Date.now(),
        }
        if (url) {
            msgObj.url = url;
        }

        const socketId = connectedUsers.get(userId);
        if (socketId) {
            io.to(socketId).emit("notification", msgObj);
            console.log(`Notification sent to user ${userId}`);
            
            res.status(200).send({
                success: true,
                data: msgObj,
                sent: true
            });
        } else {
            console.log(`User ${userId} not found or not connected`);
            res.status(404).send({
                success: false,
                message: "User not found or not connected"
            });
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
        return;
    }
});

// API endpoint to get connected users count
app.get("/api/users/connected", (req, res) => {
    res.status(200).send({
        success: true,
        totalConnected: io.engine.clientsCount,
        registeredUsers: Array.from(connectedUsers.keys())
    });
});

// Use server.listen() instead of app.listen()
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});