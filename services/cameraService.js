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

// --- SISTEM MUTEX LOCK ---
let isCameraBusy = false;
let isCapturingFrame = false; // Status untuk loop LiveView
let globalOnFrameCallback = null; // Menyimpan callback LiveView

const waitForCamera = async () => {
    while (isCameraBusy || isCapturingFrame) {
        await new Promise(r => setTimeout(r, 100)); // Tunggu 100ms sampai jalur USB kosong
    }
};

/**
 * Mengambil foto dari kamera dan menyimpannya di folder target.
 * Saat foto disimpan ke folder utama, watcher.js akan mendeteksi dan mengompresnya secara otomatis.
 */
async function capturePhoto(targetFolder) {
    // 1. Tunggu sampai gphoto2 sebelumnya (LiveView) selesai
    await waitForCamera();
    
    // 2. Kunci jalur USB
    isCameraBusy = true;
    
    // 3. Matikan sementara flag LiveView agar loop tidak menyerobot
    const wasLiveViewActive = isLiveViewActive;
    isLiveViewActive = false;
    
    return new Promise((resolve) => {
        fs.ensureDirSync(targetFolder);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `photo_linux_${timestamp}.jpg`;
        const filePath = path.join(targetFolder, filename);

        console.log(`📸 [LINUX CAMERA] (LOCK AKTIF) Mengeksekusi pengambilan foto utama...`);

        // Perintah CLI gphoto2 untuk jepret foto langsung ke disk Linux dengan kecepatan tinggi
        const command = `gphoto2 --capture-image-and-download --filename "${filePath}" --force-overwrite`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.log(`❌ [LINUX CAMERA] Error saat menjepret:`, error.message);
                // Coba tangkap dari webcam (/dev/video0) jika ada, atau tunggu input foto manual yang ditarik watcher
                exec(`ffmpeg -y -f video4linux2 -i /dev/video0 -vframes 1 "${filePath}"`, (errFfmpeg) => {
                    if (errFfmpeg && !fs.existsSync(filePath)) {
                        console.log(`⏳ Sistem siap menerima file foto di folder pemantauan (${targetFolder}) untuk diproses otomatis.`);
                    }
                });
            } else {
                console.log(`✅ [LINUX CAMERA] Sukses jepret & unduh foto: ${filename}`);
            }
            
            // 4. Buka Kunci USB
            isCameraBusy = false;
            
            // 5. Kembalikan mode LiveView jika sebelumnya menyala
            if (wasLiveViewActive && globalOnFrameCallback) {
                console.log(`📸 [LINUX CAMERA] Melanjutkan LiveView kembali...`);
                isLiveViewActive = true;
                // Beri jeda 1 detik agar mekanik lensa kamera rileks sebelum buka mirror lagi
                setTimeout(() => captureNextFrame(globalOnFrameCallback), 1000); 
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

function captureNextFrame(onFrameCallback) {
    // Berhenti jika dimatikan atau jika kamera sedang dijepret (Lock)
    if (!isLiveViewActive) return;
    if (isCapturingFrame || isCameraBusy) return; 
    
    isCapturingFrame = true;
    
    // Kamera DSLR butuh 3-5 detik untuk mengangkat cermin mekanik (mirror lock-up) saat pertama kali masuk LiveView.
    const previewFile = '/tmp/preview.jpg';
    const thumbFile = '/tmp/thumb_preview.jpg'; // Canon memaksa prefix thumb_
    
    exec(`gphoto2 --capture-preview --filename ${previewFile} --force-overwrite`, { timeout: 10000 }, (err) => {
        let frameData = null;
        try {
            if (fs.existsSync(thumbFile)) {
                frameData = fs.readFileSync(thumbFile);
            } else if (fs.existsSync(previewFile)) {
                frameData = fs.readFileSync(previewFile);
            }
        } catch (e) {}

        if (frameData && frameData.length > 100) {
            // Jika sukses baca file fisik
            if (isLiveViewActive && !isCameraBusy) {
                onFrameCallback(frameData.toString('base64'));
            }
        } else {
            // Hindari spam error saat sedang dijepret
            if (!isCameraBusy) {
                console.log("❌ [DEBUG] gphoto2 ERROR:", err ? err.message : "File preview gagal dibuat");
                console.log("⚠️ [DEBUG] Mengulangi permintaan frame dari kamera...");
            }
        }
        
        isCapturingFrame = false;
        
        // Jeda aman lalu ambil frame berikutnya
        if (isLiveViewActive && !isCameraBusy) {
            setTimeout(() => captureNextFrame(onFrameCallback), 100);
        }
    });
}

function startLiveView(onFrameCallback) {
    if (isLiveViewActive) return;
    isLiveViewActive = true;
    globalOnFrameCallback = onFrameCallback;
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
    const previewFile = '/tmp/preview.jpg';
    const thumbFile = '/tmp/thumb_preview.jpg';

    exec(`gphoto2 --capture-preview --filename ${previewFile} --force-overwrite`, { timeout: 2000 }, (err) => {
        let frameData = null;
        try {
            if (fs.existsSync(thumbFile)) frameData = fs.readFileSync(thumbFile);
            else if (fs.existsSync(previewFile)) frameData = fs.readFileSync(previewFile);
        } catch (e) {}

        if (frameData && frameData.length > 100) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
            res.end(frameData);
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
