import {v2 as cloudinary} from 'cloudinary';
import fs from 'fs'; // file system module



cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) {
            throw new Error('Local file path is required for upload.');
        }
        //upload file to cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: 'auto', // this will automatically detect the file type
        });
        // file has been uploaded to cloudinary, now we can delete the local file
        return response;
    } catch (error) {
        fs.unlinkSync(localFilePath); // delete the local file in case of an error
        console.error('Error uploading to Cloudinary:', error);
        throw error;
    }
};

