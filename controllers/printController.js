const sharp = require('sharp');
const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');

const framesData = require('../data/frames.json');

const processAndPrint = async ({ mergedImageBase64, frameName, photos, userFolderPath, printCopies }) => {
    const finalCollagePath = path.join(userFolderPath, `Cetak_Frame_${Date.now()}.png`);
    let renderingDone = false;

    // 1. Coba High-Res Backend Rendering jika frameName tersedia
    if (frameName && photos && photos.length > 0) {
        const frameConfig = framesData.find(f => f.name === frameName);
        if (frameConfig) {
            const baseWidth = 1800; // Resolusi cetak ideal 4R / Kolase
            const baseHeight = 2700;

            const frameFileName = path.basename(frameConfig.asset_path);
            const frameLocalPath = path.join(config.FRAMES_FOLDER, frameFileName);

            const compositeOperations = [];

            // Looping untuk menempatkan foto satuan beresolusi tinggi ke posisi koordinat
            for (let i = 0; i < photos.length; i++) {
                if (!frameConfig.slots[i]) continue;
                const slot = frameConfig.slots[i];

                const urlPath = new URL(photos[i]).pathname;
                const relativePath = decodeURIComponent(urlPath.replace('/photos/', ''));
                const absolutePath = path.join(config.BASE_PHOTO_FOLDER, relativePath);

                const sWidth = Math.round(baseWidth * slot.w);
                const sHeight = Math.round(baseHeight * slot.h);
                const sLeft = Math.round(baseWidth * slot.l);
                const sTop = Math.round(baseHeight * slot.t);

                if (fs.existsSync(absolutePath)) {
                    const photoBuffer = await sharp(absolutePath)
                        .resize({
                            width: sWidth,
                            height: sHeight,
                            fit: 'cover'
                        })
                        .toBuffer();

                    compositeOperations.push({
                        input: photoBuffer,
                        top: sTop,
                        left: sLeft
                    });
                }
            }

            // Timpa template frame transparan di atas foto-foto tersebut
            if (fs.existsSync(frameLocalPath)) {
                compositeOperations.push({
                    input: await sharp(frameLocalPath).resize(baseWidth, baseHeight).toBuffer(),
                    top: 0,
                    left: 0
                });
            } else {
                console.log(`⚠️ Peringatan: Template frame ${frameLocalPath} tidak ditemukan!`);
            }

            // Render hasil akhir dengan canvas putih bersih
            await sharp({
                create: {
                    width: baseWidth,
                    height: baseHeight,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                }
            })
                .composite(compositeOperations)
                .withMetadata({ density: 450 }) // Set DPI tinggi untuk printer Linux CUPS
                .png()
                .toFile(finalCollagePath);

            console.log(`✅ File High-Res berhasil di-render (Backend Linux): ${finalCollagePath}`);
            renderingDone = true;
        }
    }

    if (!renderingDone && mergedImageBase64) {
        try {
            const base64Data = mergedImageBase64.replace(/^data:image\/\w+;base64,/, "");
            await fs.writeFile(finalCollagePath, Buffer.from(base64Data, 'base64'));
            console.log(`ℹ️ Render dari base64 frontend sukses: ${finalCollagePath}`);
        } catch (e) {
            console.log(`❌ Gagal merender gambar cetak:`, e.message);
        }
    }

    if (fs.existsSync(finalCollagePath)) {
        console.log(`🖨️ [LINUX CUPS PRINT] Mengirim frame ke printer ${config.PRINTER_NAME} (${printCopies} Copy)...`);
        
        // Perintah cetak natif Linux menggunakan CUPS ('lp')
        const printCommand = `lp -d "${config.PRINTER_NAME}" -n 1 "${finalCollagePath}"`;

        for (let i = 0; i < printCopies; i++) {
            setTimeout(() => {
                exec(printCommand, (error) => {
                    if (error) {
                        console.log(`⚠️ [PRINT - Copy ${i + 1}] Info CUPS: ${error.message.trim()} (Bypass jika di mode pengujian non-printer)`);
                    } else {
                        console.log(`✅ [PRINT - Copy ${i + 1}] Frame sukses dimasukkan ke antrean CUPS printer Linux!`);
                    }
                });
            }, i * 2500);
        }
    }
    return finalCollagePath;
};

module.exports = { processAndPrint };