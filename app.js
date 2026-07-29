const express = require('express');
const app = express();
const http = require('http').createServer(app);
const fs = require('fs-extra');

const config = require('./config/config');

const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8
});
const socketHandler = require('./sockets/socketHandler');
const watcherService = require('./services/watcher');

fs.ensureDirSync(config.BASE_PHOTO_FOLDER);
fs.ensureDirSync(config.FRAMES_FOLDER);
app.use('/photos', express.static(config.BASE_PHOTO_FOLDER));
app.use('/frames', express.static(config.FRAMES_FOLDER));

socketHandler(io);
watcherService.initWatcher(io);

http.listen(config.PORT, () => {
    console.log(`================================================`);
    console.log(`🚀 NODE.JS PHOTOBOX AKTIF DI PORT: ${config.PORT}`);
    console.log(`================================================`);
});