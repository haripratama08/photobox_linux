const fs = require('fs-extra');
const sharp = require('sharp');
const path = require('path');
const config = require('../config/config');
const framesData = require('../data/frames.json');
const session = require('../state/session');
const { processAndPrint } = require('../controllers/printController');
const { sendWhatsappMsg } = require('../services/whatsapp');
const { sendEmailMsg } = require('../services/email');
const cameraService = require('../services/cameraService');

let CONFIG_MIRROR = false;

module.exports = (io) => {
    io.on('connection', async (socket) => {
        console.log('📱 Frontend Flutter (Linux Kiosk) Terhubung!');

        socket.emit('camera-status', await cameraService.getStatus());
        const statusInterval = setInterval(async () => {
            socket.emit('camera-status', await cameraService.getStatus());
        }, 3000);

        socket.on('set-active-user', (userName) => {
            const safeName = userName.replace(/[^a-zA-Z0-9 \-]/g, "_").trim();
            session.setActiveUserFolder(safeName || "Guest");
            console.log(`\n👤 SESI FOTO: [${session.getActiveUserFolder()}]`);
        });

        socket.on('take-photo', async () => {
            try {
                await cameraService.capturePhoto(config.BASE_PHOTO_FOLDER);
            } catch (e) {
                console.log('❌ Error take-photo Linux:', e.message);
            }
        });

        socket.on('auto-focus', () => {
            cameraService.autoFocus();
        });

        socket.on('set-iso', (val) => {
            cameraService.setIso(val);
        });

        socket.on('set-shutter', (val) => {
            cameraService.setShutter(val);
        });

        socket.on('set-mirror', (isMirror) => {
            CONFIG_MIRROR = isMirror;
            console.log(`🪞 Status Mirror Internal Node.js: ${CONFIG_MIRROR ? 'ON' : 'OFF'}`);
        });

        socket.on('get-frames', () => {
            socket.emit('frames-list', framesData);
        });

        socket.on('start-liveview', () => {
            cameraService.startLiveView((frameBase64) => {
                socket.emit('liveview-frame', frameBase64);
            });
        });

        socket.on('stop-liveview', () => {
            cameraService.stopLiveView();
        });

        socket.on('send-results', async (data) => {
            try {
                let { userName, userWA, userEmail, mergedImageBase64, photos, printCopies = 1, frameName } = data;

                console.log(`\n===========================================`);
                console.log(`📥 PROSES DATA DARI FLUTTER UNTUK: ${userName}`);
                console.log(`📝 Permintaan Cetak: ${printCopies} Lembar`);
                if (frameName) console.log(`🖼️ Menggunakan Frame: ${frameName}`);

                const activeFolder = session.getActiveUserFolder();
                const userFolderPath = path.join(config.BASE_PHOTO_FOLDER, activeFolder);
                fs.ensureDirSync(userFolderPath);

                // 1. PROSES CETAK KOLASE (Tanpa mirror ganda agar teks frame tepat)
                const finalCollagePath = await processAndPrint({
                    mergedImageBase64,
                    frameName,
                    photos,
                    userFolderPath,
                    printCopies
                });

                // 2. PROSES FOTO MENTAH (INDIVIDUAL) - BACA SEMUA FOTO DARI FOLDER
                const rawFiles = [];
                try {
                    const filesInDir = fs.readdirSync(userFolderPath);
                    for (let file of filesInDir) {
                        if (file.startsWith('Cetak_Frame_') || file.endsWith('_mirror.jpg')) {
                            continue;
                        }
                        if (!file.toLowerCase().match(/\.(jpg|jpeg|png)$/)) {
                            continue;
                        }

                        const absolutePath = path.join(userFolderPath, file);
                        if (fs.existsSync(absolutePath)) {
                            if (CONFIG_MIRROR) {
                                const flippedPath = absolutePath.replace(/\.([a-zA-Z0-9]+)$/, '_mirror.$1');
                                if (!fs.existsSync(flippedPath)) {
                                    await sharp(absolutePath).flop().toFile(flippedPath);
                                }
                                rawFiles.push({ path: flippedPath });
                                console.log(`🪞 Foto mentah di-mirror: ${path.basename(flippedPath)}`);
                            } else {
                                rawFiles.push({ path: absolutePath });
                            }
                        }
                    }
                } catch (e) {
                    console.log(`❌ Gagal membaca foto dari folder:`, e.message);
                }

                const attachments = [];
                if (fs.existsSync(finalCollagePath)) {
                    attachments.push({ filename: path.basename(finalCollagePath), path: finalCollagePath });
                }
                rawFiles.forEach(file => {
                    attachments.push({ filename: path.basename(file.path), path: file.path });
                });

                if (userEmail && attachments.length > 0) {
                    console.log(`📧 Mengirim Email ke ${userEmail}...`);
                    await sendEmailMsg(userEmail, userName, attachments);
                }
                if (userWA && attachments.length > 0) {
                    console.log(`📱 Mengirim WhatsApp ke ${userWA}...`);
                    await sendWhatsappMsg(userWA, userName, attachments);
                }

                console.log(`✅ Proses untuk ${userName} Selesai!`);
                console.log(`===========================================\n`);

            } catch (fatalError) {
                console.log(`🚨 ERROR SAAT PROSES DATA:`, fatalError.message);
            }
        });

        socket.on('disconnect', () => {
            clearInterval(statusInterval);
            cameraService.stopLiveView();
        });
    });
};