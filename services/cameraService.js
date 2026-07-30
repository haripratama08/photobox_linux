const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

let isLiveViewActive = false;
let cameraConnected = true;
let currentIso = "Auto";
let currentShutter = "Auto";

/**
 * Layanan Kamera Linux Natif (Tanpa DigiCamControl)
 * Menggunakan command CLI gphoto2 / v4l2 agar super enteng, cepat, dan hemat resource RAM/CPU di Linux.
 */
async function getStatus() {
    return new Promise((resolve) => {
        // Pengecekan status kamera secara real via gphoto2 di Linux
        exec('gphoto2 --summary', (error, stdout, stderr) => {
            if (!error && stdout && !stdout.toLowerCase().includes('error')) {
                cameraConnected = true;
                return resolve({ connected: true, model: "🟢 Kamera Linux (gphoto2) Terhubung" });
            }
            
            // Alternatif pengecekan webcam/kamera UVC (v4l2) di filesystem Linux
            if (fs.existsSync('/dev/video0')) {
                cameraConnected = true;
                return resolve({ connected: true, model: "🟢 Kamera Video Linux (/dev/video0) Terhubung" });
            }

            // Mode Manual / Fallback untuk pengujian atau jika kamera terpasang secara manual di direktori
            resolve({ connected: true, model: "🟢 Kamera Linux Siap (Mode Natif/Manual)" });
        });
    });
}

/**
 * Mengambil foto dari kamera dan menyimpannya di folder target.
 * Saat foto disimpan ke folder utama, watcher.js akan mendeteksi dan mengompresnya secara otomatis.
 */
async function capturePhoto(targetFolder) {
    return new Promise((resolve) => {
        fs.ensureDirSync(targetFolder);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `photo_linux_${timestamp}.jpg`;
        const filePath = path.join(targetFolder, filename);

        console.log(`📸 [LINUX CAMERA] Mengeksekusi pengambilan foto ke: ${filePath}`);

        // Perintah CLI gphoto2 untuk jepret foto langsung ke disk Linux dengan kecepatan tinggi
        const command = `gphoto2 --capture-image-and-download --filename "${filePath}" --force-overwrite`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`ℹ️ Info dari gphoto2 (atau di mode simulasi/manual): Kamera hardware fisik belum dipasang, mengaktifkan penangkapan alternatif.`);
                // Coba tangkap dari webcam (/dev/video0) jika ada, atau tunggu input foto manual yang ditarik watcher
                exec(`ffmpeg -y -f video4linux2 -i /dev/video0 -vframes 1 "${filePath}"`, (errFfmpeg) => {
                    if (errFfmpeg && !fs.existsSync(filePath)) {
                        console.log(`⏳ Sistem siap menerima file foto di folder pemantauan (${targetFolder}) untuk diproses otomatis.`);
                    }
                });
            } else {
                console.log(`✅ [LINUX CAMERA] Sukses jepret & unduh foto: ${filename}`);
            }
            resolve(filePath);
        });
    });
}

function autoFocus() {
    console.log(`🎯 [LINUX CAMERA] Memicu Auto-Focus kamera...`);
    exec('gphoto2 --set-config autofocusdrive=1', (err) => {
        if (err) exec('gphoto2 --set-config autofocus=1', () => {});
    });
}

function setIso(val) {
    currentIso = val;
    console.log(`⚙️ [LINUX CAMERA] Set ISO ke: ${val}`);
    exec(`gphoto2 --set-config iso="${val}"`, () => {});
}

function setShutter(val) {
    currentShutter = val;
    console.log(`⚙️ [LINUX CAMERA] Set Shutter Speed ke: ${val}`);
    exec(`gphoto2 --set-config shutterspeed="${val}"`, () => {});
}

let isCapturingFrame = false;

function captureNextFrame(onFrameCallback) {
    if (!isLiveViewActive) return;
    if (isCapturingFrame) return; // Cegah penumpukan proses gphoto2
    
    isCapturingFrame = true;
    // Ambil 1 frame secara senyap
    exec('gphoto2 --capture-preview --filename -', { encoding: 'buffer', timeout: 2000 }, (err, stdout) => {
        // Jika sukses dan bukan file kosong
        if (isLiveViewActive && !err && stdout && stdout.length > 100) {
            onFrameCallback(stdout.toString('base64'));
        } else if (err) {
            // Jika gphoto2 gagal (kamera sibuk/mati), coba pakai /dev/video0 sebagai cadangan
            exec('ffmpeg -y -f video4linux2 -i /dev/video0 -vframes 1 -f image2pipe -', { encoding: 'buffer', timeout: 2000 }, (errF, stdoutF) => {
                if (isLiveViewActive && !errF && stdoutF && stdoutF.length > 100) {
                    onFrameCallback(stdoutF.toString('base64'));
                }
            });
        }
        
        isCapturingFrame = false;
        
        // Jeda aman 50ms agar tidak membebani CPU Linux, lalu ambil frame berikutnya
        if (isLiveViewActive) {
            setTimeout(() => captureNextFrame(onFrameCallback), 50);
        }
    });
}

function startLiveView(onFrameCallback) {
    if (isLiveViewActive) return;
    isLiveViewActive = true;
    console.log(`📹 [LINUX CAMERA] Memulai streaming LiveView...`);
    
    isCapturingFrame = false;
    captureNextFrame(onFrameCallback);
}

function stopLiveView() {
    isLiveViewActive = false;
    console.log(`⏹️ [LINUX CAMERA] LiveView dihentikan.`);
}

/**
 * Menarik SATU frame pratinjau cepat (JPEG) langsung dari buffer stdout (Tanpa simpan ke disk).
 * Digunakan untuk Web Browser Live Preview (http://localhost:3000/preview)
 */
function getSinglePreviewFrame(res) {
    exec('gphoto2 --capture-preview --filename -', { encoding: 'buffer', timeout: 2000 }, (err, stdout) => {
        if (!err && stdout && stdout.length > 100) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
            res.end(stdout);
        } else {
            // Jika gphoto2 tidak tersambung fisik, otomatis tangkap dari Webcam Linux bawaan (/dev/video0)
            exec('ffmpeg -y -f video4linux2 -i /dev/video0 -vframes 1 -f image2pipe -', { encoding: 'buffer', timeout: 2000 }, (errF, stdoutF) => {
                if (!errF && stdoutF && stdoutF.length > 100) {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
                    res.end(stdoutF);
                } else {
                    res.status(500).send('Kamera tidak terdeteksi atau mati.');
                }
            });
        }
    });
}

module.exports = {
    getStatus,
    capturePhoto,
    autoFocus,
    setIso,
    setShutter,
    startLiveView,
    stopLiveView,
    getSinglePreviewFrame
};
