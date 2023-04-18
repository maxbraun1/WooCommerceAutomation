import sharp from 'sharp';
import download from 'image-downloader';
import fs from 'fs';
import * as ftp from 'basic-ftp';
import SFTPClient from 'ssh2-sftp-client';

async function generateImages(url, upc){
    return new Promise(async (resolve, reject) => {
        let options = {
            url: url,
            dest: '../../tmp/tmp.jpeg',
            timeout: 2000,
        };

        await download.image(options)
        .then( async () => {
            try{
                sharp.cache(false);

                let template = sharp("tmp/template.jpg");
                let buffer = await sharp('tmp/tmp.jpeg').resize(990, 990, { fit: sharp.fit.inside }).flatten({ background: '#FFFFFF' }).toBuffer();
                
                await sharp(buffer).toFile("tmp/tmp.jpeg");

                template.composite([
                    { input: 'tmp/tmp.jpeg' }
                ]);

                await template.toFile('tmp/thumbnail.jpeg');
                
                let client = new SFTPClient();

                try {
                    await client.connect({
                        host: "secgunsdev.sftp.wpengine.com",
                        port: '2222',
                        user: process.env.SEC_FTP_USER,
                        password: process.env.SEC_FTP_PASS
                    });
                    await client.put("tmp/thumbnail.jpeg", "wp-content/uploads/product_images/image_" + upc + ".jpeg");
                }
                catch(err) {
                    console.log(err);
                }

                resolve("wp-content/uploads/product_images/image_" + upc + ".jpeg");
            }catch (error) {
                // Catch Image Editing Errors
                reject(error);
            }
        }).catch((error) => {
            // Catch Image Download Errors
            reject(error);
        });
    });
}

export {generateImages};