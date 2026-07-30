const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');

// Mendeteksi letak Chromium/Chrome natif bawaan Linux (agar tidak pakai bundled puppeteer)
let chromePath = '/usr/bin/chromium-browser'; // Default Ubuntu/Raspbian
if (!fs.existsSync(chromePath)) {
    if (fs.existsSync('/usr/bin/chromium')) chromePath = '/usr/bin/chromium'; // Arch/Manjaro
    else if (fs.existsSync('/usr/bin/google-chrome')) chromePath = '/usr/bin/google-chrome'; // Ekstra
}

// Optimalisasi Super Enteng (Low RAM usage) untuk Chromium di Linux Desktop / Kiosk
const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        executablePath: chromePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--mute-audio',
            '--no-zygote',
            '--disable-accelerated-2d-canvas'
        ]
    }
});

waClient.on('qr', (qr) => {
    console.log('\n📱 SCAN QR CODE INI MENGGUNAKAN WHATSAPP ANDA:');
    qrcode.generate(qr, { small: true });
});
waClient.on('ready', () => console.log('✅ BOT WHATSAPP SUDAH AKTIF DAN SIAP MENGIRIM! (Mode Low-Memory Linux)'));
waClient.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

const sendWhatsappMsg = async (userWA, userName, attachments) => {
    if (!userWA || attachments.length === 0) return;

    let cleanWA = userWA.replace(/\D/g, '');
    if (cleanWA.startsWith('0')) cleanWA = '62' + cleanWA.substring(1);
    else if (!cleanWA.startsWith('62')) cleanWA = '62' + cleanWA;

    const chatId = cleanWA + "@c.us";
    console.log(`⏳ Mengirim WA ke: ${cleanWA}...`);
    
    try {
        const isRegistered = await waClient.isRegisteredUser(chatId);
        if (isRegistered) {
            await waClient.sendMessage(chatId, `Halo *${userName}*! 👋\nIni hasil jepretan kamu dari Photobox hari ini (Frame + Mentahan). Terima kasih ya sudah mampir! 📸✨`);
            await delay(2000); // Jeda 2 detik setelah teks pembuka
            
            // Loop File dengan Try-Catch dan Delay Anti-Spam
            for (let file of attachments) {
                try {
                    console.log(`⏳ Sedang mengirim file: ${file.path}`);
                    const media = MessageMedia.fromFilePath(file.path);
                    await waClient.sendMessage(chatId, media, { sendMediaAsDocument: true });
                    console.log(`✅ File ${file.filename} terkirim (sebagai Dokumen)!`);
                    
                    // Jeda acak antara 2 hingga 4 detik sebelum mengirim file berikutnya
                    const randomDelay = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
                    await delay(randomDelay);
                } catch (mediaError) {
                    console.log(`❌ Gagal mengirim file ${file.filename}. Error:`, mediaError.message);
                }
            }
            console.log(`✅ [WA] Sukses terkirim seluruhnya!`);
        } else {
            console.log(`⚠️ [WA] Gagal: Nomor tidak terdaftar di WA!`);
        }
    } catch (err) {
        console.log(`❌ [WA] Gagal terkirim:`, err.message);
    }
};

module.exports = { sendWhatsappMsg };