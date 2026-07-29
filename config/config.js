require('dotenv').config();
const path = require('path');

// Konfigurasi Khusus LINUX (Natif Tanpa DigiCamControl & IrfanView)
module.exports = {
    PORT: process.env.PORT || 3000,
    // Di Linux, kita menggunakan path relatif berspesifikasi POSIX agar mandiri dan portabel
    BASE_PHOTO_FOLDER: process.env.BASE_PHOTO_FOLDER || path.join(__dirname, '../photos_storage'),
    FRAMES_FOLDER: path.join(__dirname, '../frames'),
    // Pencetakan menggunakan sistem standar natif CUPS Linux
    PRINTER_NAME: process.env.PRINTER_NAME || "L8050_Series_Network",
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS
};